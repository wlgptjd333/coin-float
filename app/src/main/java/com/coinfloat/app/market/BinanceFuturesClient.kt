package com.coinfloat.app.market

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

class BinanceFuturesClient(
    private val scope: CoroutineScope
) {
    companion object {
        private const val TAG = "BinanceFuturesClient"
        private const val WS_URL = "wss://fstream.binance.com/market/stream"
        private const val EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo"

        private val BACKOFF_DELAYS_MS = longArrayOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L)
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private val requestId = AtomicInteger(1)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _tradeEvents = MutableSharedFlow<AggTradeEvent>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val tradeEvents: SharedFlow<AggTradeEvent> = _tradeEvents.asSharedFlow()

    private val activeSymbols = mutableSetOf<String>()
    private val lock = Any()

    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0
    private var isExplicitDisconnect = false

    fun getActiveSymbols(): Set<String> = synchronized(lock) { activeSymbols.toSet() }

    fun connect(symbols: List<String>) {
        synchronized(lock) {
            isExplicitDisconnect = false
            activeSymbols.clear()
            activeSymbols.addAll(symbols.map { it.uppercase() })
        }
        reconnectAttempt = 0
        cancelReconnectJob()
        initiateConnection()
    }

    fun disconnect() {
        synchronized(lock) {
            isExplicitDisconnect = true
            activeSymbols.clear()
        }
        cancelReconnectJob()
        closeWebSocket()
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    fun updateSubscriptions(newSymbols: List<String>) {
        val uppercaseNew = newSymbols.map { it.uppercase() }.toSet()
        val toSubscribe: List<String>
        val toUnsubscribe: List<String>

        synchronized(lock) {
            toSubscribe = (uppercaseNew - activeSymbols).toList()
            toUnsubscribe = (activeSymbols - uppercaseNew).toList()

            activeSymbols.clear()
            activeSymbols.addAll(uppercaseNew)
        }

        if (toUnsubscribe.isNotEmpty()) {
            sendSubscriptionCommand("UNSUBSCRIBE", toUnsubscribe)
        }
        if (toSubscribe.isNotEmpty()) {
            sendSubscriptionCommand("SUBSCRIBE", toSubscribe)
        }
    }

    private fun initiateConnection() {
        if (_connectionState.value == ConnectionState.CONNECTING) return

        closeWebSocket()
        _connectionState.value = if (reconnectAttempt > 0) ConnectionState.RECONNECTING else ConnectionState.CONNECTING

        Log.d(TAG, "Initiating WebSocket connection to $WS_URL")
        val request = Request.Builder().url(WS_URL).build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected successfully")
                _connectionState.value = ConnectionState.CONNECTED
                reconnectAttempt = 0

                val currentSymbols = synchronized(lock) { activeSymbols.toList() }
                if (currentSymbols.isNotEmpty()) {
                    sendSubscriptionCommand("SUBSCRIBE", currentSymbols)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code / $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code / $reason")
                handleDisconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                handleDisconnect()
            }
        })
    }

    private fun handleDisconnect() {
        val shouldReconnect = synchronized(lock) { !isExplicitDisconnect }
        if (shouldReconnect) {
            _connectionState.value = ConnectionState.RECONNECTING
            scheduleReconnect()
        } else {
            _connectionState.value = ConnectionState.DISCONNECTED
        }
    }

    private fun scheduleReconnect() {
        cancelReconnectJob()
        reconnectJob = scope.launch {
            val baseDelay = calculateBackoff(reconnectAttempt)
            val jitter = Random.nextLong(0, 500)
            val totalDelay = baseDelay + jitter
            Log.d(TAG, "Reconnecting in ${totalDelay}ms (attempt $reconnectAttempt)")
            delay(totalDelay)
            reconnectAttempt++
            if (isActive && !isExplicitDisconnect) {
                initiateConnection()
            }
        }
    }

    fun calculateBackoff(attempt: Int): Long {
        val index = attempt.coerceIn(0, BACKOFF_DELAYS_MS.size - 1)
        return BACKOFF_DELAYS_MS[index]
    }

    private fun cancelReconnectJob() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    private fun closeWebSocket() {
        try {
            webSocket?.close(1000, "Normal closure")
        } catch (_: Exception) {}
        webSocket = null
    }

    fun buildSubscriptionPayload(method: String, symbols: List<String>, id: Int): String {
        val json = JSONObject()
        json.put("method", method)
        val params = JSONArray()
        for (symbol in symbols) {
            params.put("${symbol.lowercase()}@aggTrade")
        }
        json.put("params", params)
        json.put("id", id)
        return json.toString()
    }

    private fun sendSubscriptionCommand(method: String, symbols: List<String>) {
        if (symbols.isEmpty()) return
        val ws = webSocket ?: return
        val id = requestId.getAndIncrement()
        val payload = buildSubscriptionPayload(method, symbols, id)
        Log.d(TAG, "Sending WS command: $payload")
        ws.send(payload)
    }

    fun parseAggTrade(text: String): AggTradeEvent? {
        return try {
            val json = JSONObject(text)
            val targetJson = if (json.has("data") && json.optJSONObject("data") != null) {
                json.getJSONObject("data")
            } else {
                json
            }
            val eventType = targetJson.optString("e", "")
            if (eventType == "aggTrade") {
                val symbol = targetJson.getString("s")
                val price = targetJson.getString("p")
                val eventTime = targetJson.optLong("E", 0L)
                val tradeTime = targetJson.optLong("T", 0L)
                AggTradeEvent(
                    eventType = eventType,
                    eventTime = eventTime,
                    symbol = symbol,
                    price = price,
                    tradeTime = tradeTime
                )
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun handleMessage(text: String) {
        val event = parseAggTrade(text)
        if (event != null) {
            _tradeEvents.tryEmit(event)
        }
    }

    suspend fun fetchExchangeInfo(): List<SymbolInfo> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(EXCHANGE_INFO_URL)
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Failed to fetch exchangeInfo: HTTP ${response.code}")
            }
            val body = response.body?.string() ?: throw Exception("Empty body")
            parseExchangeInfo(body)
        }
    }

    fun parseExchangeInfo(jsonStr: String): List<SymbolInfo> {
        val root = JSONObject(jsonStr)
        val symbolsArray = root.getJSONArray("symbols")
        val result = mutableListOf<SymbolInfo>()

        for (i in 0 until symbolsArray.length()) {
            val symObj = symbolsArray.getJSONObject(i)
            val contractType = symObj.optString("contractType", "")
            val quoteAsset = symObj.optString("quoteAsset", "")
            val status = symObj.optString("status", "")

            // Requirements: contractType == PERPETUAL && quoteAsset == USDT && status == TRADING
            if (contractType == "PERPETUAL" && quoteAsset == "USDT" && status == "TRADING") {
                val symbol = symObj.getString("symbol")
                val pair = symObj.optString("pair", symbol)
                val baseAsset = symObj.optString("baseAsset", "")
                val pricePrecision = symObj.optInt("pricePrecision", 2)

                var tickSize = "0.01"
                val filtersArray = symObj.optJSONArray("filters")
                if (filtersArray != null) {
                    for (f in 0 until filtersArray.length()) {
                        val filter = filtersArray.getJSONObject(f)
                        if (filter.optString("filterType") == "PRICE_FILTER") {
                            tickSize = filter.optString("tickSize", "0.01")
                            break
                        }
                    }
                }

                result.add(
                    SymbolInfo(
                        symbol = symbol,
                        pair = pair,
                        baseAsset = baseAsset,
                        quoteAsset = quoteAsset,
                        tickSize = tickSize,
                        pricePrecision = pricePrecision
                    )
                )
            }
        }
        return result
    }
}
