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
        private const val WATCHDOG_CHECK_MS = 5_000L
        private const val SILENCE_LIMIT_MS = 15_000L

        /** Binance answers 451 from the countries it does not serve (the United States, for one). */
        fun isRegionBlock(code: Int?) = code == 451
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var webSocket: WebSocket? = null
    private val requestId = AtomicInteger(1)

    // Identifies the live socket. Every close/reconnect bumps it, so late callbacks from a socket we
    // already replaced (onClosed/onFailure arrive asynchronously) cannot tear down its successor or
    // schedule a spurious reconnect.
    private val socketGeneration = AtomicInteger(0)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    // Binance refuses this network's location: no retry can help, and the empty prices need an explanation.
    private val _regionBlocked = MutableStateFlow(false)
    val regionBlocked: StateFlow<Boolean> = _regionBlocked.asStateFlow()

    private fun noteHttp(code: Int) {
        if (isRegionBlock(code)) _regionBlocked.value = true else if (code in 200..299) _regionBlocked.value = false
    }

    private val _tradeEvents = MutableSharedFlow<AggTradeEvent>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val tradeEvents: SharedFlow<AggTradeEvent> = _tradeEvents.asSharedFlow()

    private val _dayEvents = MutableSharedFlow<DayTickerEvent>(
        replay = 0,
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val dayEvents: SharedFlow<DayTickerEvent> = _dayEvents.asSharedFlow()

    private val _klineEvents = MutableSharedFlow<KlineEvent>(
        replay = 0,
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val klineEvents: SharedFlow<KlineEvent> = _klineEvents.asSharedFlow()

    // One extra stream on top of the per-symbol ones: the candle stream of the open mini chart (null when none).
    private var extraStream: String? = null

    fun setExtraStream(stream: String?) {
        val old: String?
        synchronized(lock) {
            old = extraStream
            if (old == stream) return
            extraStream = stream
        }
        val base = synchronized(lock) { activeSymbols.map { priceStream(it) }.toSet() }
        if (old != null && old !in base) sendStreams("UNSUBSCRIBE", listOf(old))
        if (stream != null && stream !in base) sendStreams("SUBSCRIBE", listOf(stream))
    }

    private fun sendStreams(method: String, streams: List<String>) {
        val ws = webSocket ?: return               // not connected: onOpen subscribes the current extra stream
        val json = JSONObject()
        json.put("method", method)
        json.put("params", JSONArray(streams))
        json.put("id", requestId.getAndIncrement())
        ws.send(json.toString())
    }

    private val activeSymbols = mutableSetOf<String>()
    private val lock = Any()

    private var reconnectJob: Job? = null

    @Volatile
    private var reconnectAttempt = 0
    private var isExplicitDisconnect = false
    private var isPaused = false

    fun getActiveSymbols(): Set<String> = synchronized(lock) { activeSymbols.toSet() }

    fun connect(symbols: List<String>) {
        synchronized(lock) {
            isExplicitDisconnect = false
            isPaused = false
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
            isPaused = false
            activeSymbols.clear()
        }
        cancelReconnectJob()
        closeWebSocket()
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    fun pause() {
        synchronized(lock) {
            isPaused = true
        }
        cancelReconnectJob()
        closeWebSocket()
        _connectionState.value = ConnectionState.DISCONNECTED
        Log.d(TAG, "BinanceFuturesClient paused (screen off/conserving battery)")
    }

    fun resume() {
        val symbols: List<String>
        synchronized(lock) {
            if (!isPaused) return
            isPaused = false
            symbols = activeSymbols.toList()
        }
        Log.d(TAG, "BinanceFuturesClient resumed with symbols: $symbols")
        if (symbols.isNotEmpty()) {
            reconnectAttempt = 0
            initiateConnection()
        }
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

        closeWebSocket() // also invalidates callbacks of the previous socket
        _connectionState.value = if (reconnectAttempt > 0) ConnectionState.RECONNECTING else ConnectionState.CONNECTING

        Log.d(TAG, "Initiating WebSocket connection to $WS_URL")
        val request = Request.Builder().url(WS_URL).build()
        val generation = socketGeneration.get()
        fun isCurrent() = generation == socketGeneration.get()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (!isCurrent()) return
                Log.d(TAG, "WebSocket connected successfully")
                _connectionState.value = ConnectionState.CONNECTED
                _regionBlocked.value = false
                reconnectAttempt = 0
                lastMessageAt = System.currentTimeMillis()
                startWatchdog(generation)

                val currentSymbols = synchronized(lock) { activeSymbols.toList() }
                if (currentSymbols.isNotEmpty()) {
                    sendSubscriptionCommand("SUBSCRIBE", currentSymbols)
                }
                synchronized(lock) { extraStream }?.let { extra ->
                    if (extra !in synchronized(lock) { activeSymbols.map { priceStream(it) } }) sendStreams("SUBSCRIBE", listOf(extra))
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!isCurrent()) return
                lastMessageAt = System.currentTimeMillis()
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code / $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code / $reason")
                if (isCurrent()) handleDisconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                if (isCurrent()) {
                    if (isRegionBlock(response?.code)) _regionBlocked.value = true
                    handleDisconnect()
                }
            }
        })
    }

    private fun handleDisconnect() {
        val shouldReconnect = synchronized(lock) { !isExplicitDisconnect && !isPaused }
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
            val allowed = synchronized(lock) { !isExplicitDisconnect && !isPaused }
            if (isActive && allowed) {
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

    // Every subscribed coin sends a mini-ticker each second, so a long silence means the socket is dead even though it
    // looks open (half-open TCP after a network switch, a dropped subscription): replace it instead of showing
    // frozen prices as live.
    @Volatile
    private var lastMessageAt = 0L
    private var watchdogJob: Job? = null

    private fun startWatchdog(generation: Int) {
        watchdogJob?.cancel()
        watchdogJob = scope.launch {
            while (isActive && generation == socketGeneration.get()) {
                delay(WATCHDOG_CHECK_MS)
                if (generation != socketGeneration.get()) break
                val hasSubscriptions = synchronized(lock) { activeSymbols.isNotEmpty() && !isPaused && !isExplicitDisconnect }
                if (hasSubscriptions && System.currentTimeMillis() - lastMessageAt > SILENCE_LIMIT_MS) {
                    Log.w(TAG, "No market data for ${SILENCE_LIMIT_MS / 1000}s: reconnecting")
                    reconnectNow()
                    break
                }
            }
        }
    }

    /** Replaces the socket right away (keeps the subscriptions). Ignored while paused or disconnected on purpose. */
    fun reconnectNow() {
        val allowed = synchronized(lock) { !isPaused && !isExplicitDisconnect && activeSymbols.isNotEmpty() }
        if (!allowed) return
        cancelReconnectJob()
        closeWebSocket()
        _connectionState.value = ConnectionState.RECONNECTING
        reconnectAttempt = 0
        initiateConnection()
    }

    private fun closeWebSocket() {
        socketGeneration.incrementAndGet()
        try {
            webSocket?.close(1000, "Normal closure")
        } catch (_: Exception) {}
        webSocket = null
    }

    // Price source. Every trade (aggTrade) arrives as its own message: a handful per second when the market is calm,
    // dozens to hundreds when it moves, while the floating window only redraws a few times a second. The 1m candle
    // stream carries the latest price at most every 250 ms whatever the activity, so it is used unless the user picked
    // the fastest (10 FPS) refresh.
    @Volatile
    var fastTrades = false
        private set

    private fun priceStream(symbol: String) = symbol.lowercase() + if (fastTrades) "@aggTrade" else "@kline_1m"

    fun setFastTrades(fast: Boolean) {
        if (fast == fastTrades) return
        fastTrades = fast
        reconnectNow()                 // resubscribe with the other stream; harmless when not connected
    }

    fun buildSubscriptionPayload(method: String, symbols: List<String>, id: Int): String {
        val json = JSONObject()
        json.put("method", method)
        val params = JSONArray()
        for (symbol in symbols) {
            params.put(priceStream(symbol))
            // one message per second with the rolling 24 h open: live 24 h change for the floating window and home
            params.put("${symbol.lowercase()}@miniTicker")
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

    fun parseDayTicker(text: String): DayTickerEvent? {
        return try {
            val json = JSONObject(text)
            val data = json.optJSONObject("data") ?: json
            if (data.optString("e", "") != "24hrMiniTicker") return null
            DayTickerEvent(symbol = data.getString("s"), open = data.getString("o"))
        } catch (_: Exception) {
            null
        }
    }

    fun parseKline(text: String): KlineEvent? {
        return try {
            val json = JSONObject(text)
            val data = json.optJSONObject("data") ?: json
            if (data.optString("e", "") != "kline") return null
            val k = data.getJSONObject("k")
            KlineEvent(
                symbol = k.getString("s"),
                interval = k.getString("i"),
                closeText = k.getString("c"),
                item = KlineItem(
                    openTime = k.getLong("t"),
                    open = k.getString("o").toFloat(),
                    high = k.getString("h").toFloat(),
                    low = k.getString("l").toFloat(),
                    close = k.getString("c").toFloat(),
                    volume = k.getString("v").toFloat()
                )
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun handleMessage(text: String) {
        if (text.contains("\"e\":\"kline\"")) {
            val k = parseKline(text) ?: return
            _klineEvents.tryEmit(k)
            if (!fastTrades && k.interval == "1m" && k.closeText.isNotEmpty()) {
                val now = System.currentTimeMillis()
                _tradeEvents.tryEmit(AggTradeEvent("kline", now, k.symbol, k.closeText, now))
            }
            return
        }
        // cheap pre-check instead of parsing every message twice
        if (text.contains("\"24hrMiniTicker\"")) {
            parseDayTicker(text)?.let { _dayEvents.tryEmit(it) }
            return
        }
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
            noteHttp(response.code)
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

    suspend fun fetchKlines(
        symbol: String,
        interval: String = "15m",
        limit: Int = 30
    ): List<KlineItem> = withContext(Dispatchers.IO) {
        val url = "https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.uppercase()}&interval=$interval&limit=$limit"
        val request = Request.Builder().url(url).get().build()
        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Failed to fetch klines: HTTP ${response.code}")
            }
            val body = response.body?.string() ?: throw Exception("Empty klines response")
            parseKlines(body)
        }
    }

    fun parseKlines(jsonStr: String): List<KlineItem> {
        val root = JSONArray(jsonStr)
        val list = ArrayList<KlineItem>(root.length())
        for (i in 0 until root.length()) {
            val item = root.getJSONArray(i)
            list.add(
                KlineItem(
                    openTime = item.getLong(0),
                    open = item.getString(1).toFloatOrNull() ?: 0f,
                    high = item.getString(2).toFloatOrNull() ?: 0f,
                    low = item.getString(3).toFloatOrNull() ?: 0f,
                    close = item.getString(4).toFloatOrNull() ?: 0f,
                    volume = item.getString(5).toFloatOrNull() ?: 0f
                )
            )
        }
        return list
    }

    suspend fun fetch24hTicker(symbol: String): Ticker24h? = withContext(Dispatchers.IO) {
        val url = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol.uppercase()}"
        val request = Request.Builder().url(url).get().build()
        try {
            httpClient.newCall(request).execute().use { response ->
                noteHttp(response.code)
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                parse24hTicker(body)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch 24h ticker for $symbol: ${e.message}")
            null
        }
    }

    fun parse24hTicker(jsonStr: String): Ticker24h? {
        return try {
            val obj = JSONObject(jsonStr)
            val symbol = obj.getString("symbol")
            val priceChange = obj.optString("priceChange", "0").toFloatOrNull() ?: 0f
            val priceChangePercent = obj.optString("priceChangePercent", "0").toFloatOrNull() ?: 0f
            val highPrice = obj.optString("highPrice", "0").toFloatOrNull() ?: 0f
            val lowPrice = obj.optString("lowPrice", "0").toFloatOrNull() ?: 0f
            val volume = obj.optString("volume", "0").toFloatOrNull() ?: 0f
            val quoteVolume = obj.optString("quoteVolume", "0").toFloatOrNull() ?: 0f
            Ticker24h(
                symbol = symbol,
                priceChange = priceChange,
                priceChangePercent = priceChangePercent,
                highPrice = highPrice,
                lowPrice = lowPrice,
                volume = volume,
                quoteVolume = quoteVolume
            )
        } catch (_: Exception) {
            null
        }
    }

    suspend fun fetchFundingInfo(symbol: String): FundingInfo? = withContext(Dispatchers.IO) {
        val url = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol.uppercase()}"
        val request = Request.Builder().url(url).get().build()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                parseFundingInfo(body)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch funding info for $symbol: ${e.message}")
            null
        }
    }

    fun parseFundingInfo(jsonStr: String): FundingInfo? {
        return try {
            val obj = JSONObject(jsonStr)
            val symbol = obj.getString("symbol")
            val fundingRate = obj.optString("lastFundingRate", "0").toFloatOrNull() ?: 0f
            val nextFundingTime = obj.optLong("nextFundingTime", 0L)
            val markPrice = obj.optString("markPrice", "0").toFloatOrNull() ?: 0f
            val indexPrice = obj.optString("indexPrice", "0").toFloatOrNull() ?: 0f
            FundingInfo(
                symbol = symbol,
                fundingRate = fundingRate,
                nextFundingTime = nextFundingTime,
                markPrice = markPrice,
                indexPrice = indexPrice
            )
        } catch (_: Exception) {
            null
        }
    }
}
