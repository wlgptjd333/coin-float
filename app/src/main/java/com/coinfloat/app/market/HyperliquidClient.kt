package com.coinfloat.app.market

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.coroutineScope
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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/**
 * Hyperliquid perpetuals: the main crypto market and the builder-deployed (HIP-3) markets, where stocks, indices and
 * commodities trade ("xyz:TSLA", "xyz:GOLD"). Public API only, no account. Prices come from each coin's asset-context
 * stream (mid price about once a second, plus the price 24 h ago).
 */
class HyperliquidClient(
    private val scope: CoroutineScope
) : PriceFeed {
    companion object {
        private const val TAG = "HyperliquidClient"
        private const val WS_URL = "wss://api.hyperliquid.xyz/ws"
        private const val INFO_URL = "https://api.hyperliquid.xyz/info"

        private val BACKOFF_DELAYS_MS = longArrayOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L)
        // The server drops a socket that says nothing for a minute; quiet markets (stocks at night) may send nothing
        // for that long, so the client pings and treats a missing pong as a dead socket.
        private const val PING_MS = 30_000L
        private const val SILENCE_LIMIT_MS = 75_000L
        private const val CTX_MAX_AGE_MS = 15_000L
        private val JSON_TYPE = "application/json".toMediaType()

        /** Candle intervals Hyperliquid serves. */
        val INTERVALS = setOf("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M")

        /** The interval to ask Hyperliquid for: the same one, or the nearest it has (it has no 6 h candles). */
        fun supportedInterval(interval: String): String = when {
            interval in INTERVALS -> interval
            interval == "6h" -> "4h"
            else -> "15m"
        }

        fun intervalMs(interval: String): Long {
            val n = interval.dropLast(1).toLongOrNull() ?: 15L
            return when (interval.last()) {
                'm' -> n * 60_000L
                'h' -> n * 3_600_000L
                'd' -> n * 86_400_000L
                'w' -> n * 7 * 86_400_000L
                'M' -> n * 30 * 86_400_000L
                else -> 15 * 60_000L
            }
        }

        /** Price decimals Hyperliquid allows for a perpetual: 6 minus the size decimals. */
        fun tickSizeFor(szDecimals: Int): String {
            val d = (6 - szDecimals).coerceIn(0, 8)
            return if (d == 0) "1" else "0." + "0".repeat(d - 1) + "1"
        }

        /** Coin for a key when the listing is not at hand: "HL-XYZ-TSLA" -> "xyz:TSLA", "HL-BTC" -> "BTC". */
        fun guessCoin(key: String): String {
            val parts = key.uppercase().removePrefix(Exchange.HYPERLIQUID.prefix).split('-')
            return if (parts.size >= 2) parts[0].lowercase() + ":" + parts.drop(1).joinToString("-") else parts[0]
        }

        /** The market group (HIP-3 deployer) a coin belongs to; "" for the main market. */
        fun dexOf(coin: String): String = if (':' in coin) coin.substringBefore(':') else ""

        fun parseMeta(json: String, dexLabel: String): List<SymbolInfo> {
            val universe = JSONObject(json).optJSONArray("universe") ?: return emptyList()
            val out = ArrayList<SymbolInfo>(universe.length())
            for (i in 0 until universe.length()) {
                val a = universe.optJSONObject(i) ?: continue
                if (a.optBoolean("isDelisted", false)) continue
                val coin = a.optString("name").takeIf { it.isNotEmpty() } ?: continue
                val sz = a.optInt("szDecimals", 2)
                out.add(
                    SymbolInfo(
                        symbol = Exchange.hyperliquidKey(coin),
                        pair = coin,
                        baseAsset = coin.substringAfter(':'),
                        quoteAsset = "USD",
                        tickSize = tickSizeFor(sz),
                        pricePrecision = (6 - sz).coerceIn(0, 8),
                        exchange = Exchange.HYPERLIQUID,
                        group = dexLabel
                    )
                )
            }
            return out
        }

        /** candleSnapshot rows as [open time, open, high, low, close, volume]. */
        fun parseCandles(json: String): List<DoubleArray> {
            val a = JSONArray(json)
            val out = ArrayList<DoubleArray>(a.length())
            for (i in 0 until a.length()) {
                val c = a.optJSONObject(i) ?: continue
                out.add(
                    doubleArrayOf(
                        c.optLong("t").toDouble(), c.optString("o").toDouble(), c.optString("h").toDouble(),
                        c.optString("l").toDouble(), c.optString("c").toDouble(), c.optString("v").toDouble()
                    )
                )
            }
            return out.sortedBy { it[0] }
        }

        fun candleSnapshotBody(coin: String, interval: String, startTime: Long, endTime: Long): String =
            JSONObject().put("type", "candleSnapshot").put(
                "req", JSONObject().put("coin", coin).put("interval", interval).put("startTime", startTime).put("endTime", endTime)
            ).toString()

        private val restClient: OkHttpClient by lazy {
            OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
        }

        /** One info request (blocking; call off the main thread). */
        fun post(body: String, http: OkHttpClient = restClient): String {
            val req = Request.Builder().url(INFO_URL).post(body.toRequestBody(JSON_TYPE)).build()
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) throw Exception("Hyperliquid HTTP ${r.code}")
                return r.body?.string() ?: throw Exception("Empty body")
            }
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Exact coin name of a key ("HL-KPEPE" -> "kPEPE"), from the loaded listing; set by the repository. */
    var coinOf: (String) -> String? = { null }
    private fun coin(key: String) = coinOf(key) ?: guessCoin(key)

    @Volatile
    private var webSocket: WebSocket? = null
    private val socketGeneration = AtomicInteger(0)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    override val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _tradeEvents = MutableSharedFlow<AggTradeEvent>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val tradeEvents: SharedFlow<AggTradeEvent> = _tradeEvents.asSharedFlow()

    private val _dayEvents = MutableSharedFlow<DayTickerEvent>(extraBufferCapacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val dayEvents: SharedFlow<DayTickerEvent> = _dayEvents.asSharedFlow()

    private val _klineEvents = MutableSharedFlow<KlineEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val klineEvents: SharedFlow<KlineEvent> = _klineEvents.asSharedFlow()

    private val lock = Any()
    private val activeSymbols = linkedSetOf<String>()
    private var isPaused = false

    // The open mini chart's candles: key, the interval it asked for, the interval Hyperliquid streams.
    private data class CandleStream(val key: String, val interval: String, val hlInterval: String)
    private var candleStream: CandleStream? = null

    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    @Volatile
    private var reconnectAttempt = 0
    @Volatile
    private var lastMessageAt = 0L

    override fun connect(symbols: List<String>) {
        synchronized(lock) {
            isPaused = false
            activeSymbols.clear()
            activeSymbols.addAll(symbols.map { it.uppercase() })
        }
        reconnectAttempt = 0
        cancelReconnectJob()
        initiateConnection()
    }

    override fun updateSubscriptions(newSymbols: List<String>) {
        val next = newSymbols.map { it.uppercase() }.toSet()
        val toAdd: List<String>
        val toRemove: List<String>
        synchronized(lock) {
            toAdd = (next - activeSymbols).toList()
            toRemove = (activeSymbols - next).toList()
            activeSymbols.clear()
            activeSymbols.addAll(next)
        }
        toRemove.forEach { send("unsubscribe", ctxSubscription(it)) }
        toAdd.forEach { send("subscribe", ctxSubscription(it)) }
    }

    override fun pause() {
        synchronized(lock) { isPaused = true }
        cancelReconnectJob()
        closeWebSocket()
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    override fun reconnectNow() {
        val allowed = synchronized(lock) { !isPaused && activeSymbols.isNotEmpty() }
        if (!allowed) return
        cancelReconnectJob()
        closeWebSocket()
        _connectionState.value = ConnectionState.RECONNECTING
        reconnectAttempt = 0
        initiateConnection()
    }

    /** The mini chart that is open on a Hyperliquid coin (or null): its candles stream only while it is on screen. */
    fun setCandleStream(symbol: String?, interval: String?) {
        val next = if (symbol != null && interval != null) CandleStream(symbol.uppercase(), interval, supportedInterval(interval)) else null
        val old: CandleStream?
        synchronized(lock) {
            old = candleStream
            if (old == next) return
            candleStream = next
        }
        old?.let { send("unsubscribe", candleSubscription(it)) }
        next?.let { send("subscribe", candleSubscription(it)) }
    }

    private fun ctxSubscription(key: String) = JSONObject().put("type", "activeAssetCtx").put("coin", coin(key))
    private fun candleSubscription(s: CandleStream) = JSONObject().put("type", "candle").put("coin", coin(s.key)).put("interval", s.hlInterval)

    private fun send(method: String, subscription: JSONObject) {
        val ws = webSocket ?: return              // not connected: onOpen subscribes everything
        ws.send(JSONObject().put("method", method).put("subscription", subscription).toString())
    }

    private fun initiateConnection() {
        if (_connectionState.value == ConnectionState.CONNECTING) return
        closeWebSocket()
        _connectionState.value = if (reconnectAttempt > 0) ConnectionState.RECONNECTING else ConnectionState.CONNECTING

        val generation = socketGeneration.get()
        fun isCurrent() = generation == socketGeneration.get()

        webSocket = httpClient.newWebSocket(Request.Builder().url(WS_URL).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (!isCurrent()) return
                _connectionState.value = ConnectionState.CONNECTED
                reconnectAttempt = 0
                lastMessageAt = System.currentTimeMillis()
                val (keys, candles) = synchronized(lock) { activeSymbols.toList() to candleStream }
                for (key in keys) {
                    webSocket.send(JSONObject().put("method", "subscribe").put("subscription", ctxSubscription(key)).toString())
                }
                candles?.let { webSocket.send(JSONObject().put("method", "subscribe").put("subscription", candleSubscription(it)).toString()) }
                startPing(generation)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!isCurrent()) return
                lastMessageAt = System.currentTimeMillis()
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (isCurrent()) handleDisconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                if (isCurrent()) handleDisconnect()
            }
        })
    }

    private fun handleDisconnect() {
        val shouldReconnect = synchronized(lock) { !isPaused && activeSymbols.isNotEmpty() }
        if (!shouldReconnect) {
            _connectionState.value = ConnectionState.DISCONNECTED
            return
        }
        _connectionState.value = ConnectionState.RECONNECTING
        cancelReconnectJob()
        reconnectJob = scope.launch {
            delay(BACKOFF_DELAYS_MS[reconnectAttempt.coerceIn(0, BACKOFF_DELAYS_MS.size - 1)] + Random.nextLong(0, 500))
            reconnectAttempt++
            val allowed = synchronized(lock) { !isPaused && activeSymbols.isNotEmpty() }
            if (isActive && allowed) initiateConnection()
        }
    }

    private fun startPing(generation: Int) {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (isActive && generation == socketGeneration.get()) {
                delay(PING_MS)
                if (generation != socketGeneration.get()) break
                if (System.currentTimeMillis() - lastMessageAt > SILENCE_LIMIT_MS) {
                    Log.w(TAG, "No answer from Hyperliquid: reconnecting")
                    reconnectNow()
                    break
                }
                webSocket?.send("{\"method\":\"ping\"}")
            }
        }
    }

    private fun cancelReconnectJob() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    private fun closeWebSocket() {
        socketGeneration.incrementAndGet()
        pingJob?.cancel()
        runCatching { webSocket?.close(1000, "Normal closure") }
        webSocket = null
    }

    private fun handleMessage(text: String) {
        val o = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (o.optString("channel")) {
            "activeAssetCtx" -> {
                val d = o.optJSONObject("data") ?: return
                val ctx = d.optJSONObject("ctx") ?: return
                val key = Exchange.hyperliquidKey(d.optString("coin"))
                val price = num(ctx, "midPx") ?: num(ctx, "markPx")
                val now = System.currentTimeMillis()
                if (price != null) _tradeEvents.tryEmit(AggTradeEvent("ctx", now, key, price, now))
                num(ctx, "prevDayPx")?.let { _dayEvents.tryEmit(DayTickerEvent(key, it)) }
            }
            "candle" -> {
                val c = o.optJSONObject("data") ?: return
                val stream = synchronized(lock) { candleStream } ?: return
                val key = Exchange.hyperliquidKey(c.optString("s"))
                if (key != stream.key || c.optString("i") != stream.hlInterval) return
                val close = c.optString("c")
                val item = runCatching {
                    KlineItem(
                        openTime = c.getLong("t"),
                        open = c.getString("o").toFloat(),
                        high = c.getString("h").toFloat(),
                        low = c.getString("l").toFloat(),
                        close = close.toFloat(),
                        volume = c.getString("v").toFloat()
                    )
                }.getOrNull() ?: return
                _klineEvents.tryEmit(KlineEvent(stream.key, stream.interval, item, close))
            }
        }
    }

    private fun num(o: JSONObject, key: String): String? =
        if (o.isNull(key)) null else o.optString(key).takeIf { it.isNotEmpty() && it.toDoubleOrNull() != null }

    // ---- REST -------------------------------------------------------------------------------------------------------

    /** Every listed perpetual: the main market and each HIP-3 market. A market group that fails is left out. */
    suspend fun fetchUniverse(): List<SymbolInfo> = withContext(Dispatchers.IO) {
        val dexes = JSONArray(post("{\"type\":\"perpDexs\"}", httpClient))
        val named = (0 until dexes.length()).mapNotNull { dexes.optJSONObject(it) }.filter { it.optString("name").isNotEmpty() }
        val main = parseMeta(post("{\"type\":\"meta\"}", httpClient), "")
        val others = coroutineScope {
            named.map { d ->
                async {
                    runCatching {
                        val name = d.optString("name")
                        parseMeta(post(JSONObject().put("type", "meta").put("dex", name).toString(), httpClient), d.optString("fullName", name).ifEmpty { name })
                    }.getOrElse { emptyList() }
                }
            }.awaitAll().flatten()
        }
        main + others
    }

    suspend fun fetchKlines(symbol: String, interval: String, limit: Int): List<KlineItem> = withContext(Dispatchers.IO) {
        val iv = supportedInterval(interval)
        val end = System.currentTimeMillis()
        val rows = parseCandles(post(candleSnapshotBody(coin(symbol), iv, end - intervalMs(iv) * limit, end), httpClient))
        rows.takeLast(limit).map {
            KlineItem(it[0].toLong(), it[1].toFloat(), it[2].toFloat(), it[3].toFloat(), it[4].toFloat(), it[5].toFloat())
        }
    }

    // Asset contexts of one market group, shared for a few seconds (the chart asks for 24 h stats and funding together).
    private val ctxCache = ConcurrentHashMap<String, Pair<Long, Map<String, JSONObject>>>()

    private suspend fun assetCtx(symbol: String): JSONObject? = withContext(Dispatchers.IO) {
        val c = coin(symbol)
        val dex = dexOf(c)
        val cached = ctxCache[dex]
        if (cached != null && System.currentTimeMillis() - cached.first < CTX_MAX_AGE_MS) return@withContext cached.second[c]
        val body = JSONObject().put("type", "metaAndAssetCtxs").apply { if (dex.isNotEmpty()) put("dex", dex) }.toString()
        val arr = JSONArray(post(body, httpClient))
        val universe = arr.getJSONObject(0).getJSONArray("universe")
        val ctxs = arr.getJSONArray(1)
        val map = HashMap<String, JSONObject>()
        for (i in 0 until minOf(universe.length(), ctxs.length())) {
            val name = universe.optJSONObject(i)?.optString("name") ?: continue
            ctxs.optJSONObject(i)?.let { map[name] = it }
        }
        ctxCache[dex] = System.currentTimeMillis() to map
        map[c]
    }

    suspend fun fetch24hTicker(symbol: String): Ticker24h? = runCatching {
        val ctx = assetCtx(symbol) ?: return null
        val mark = (num(ctx, "midPx") ?: num(ctx, "markPx"))?.toFloat() ?: return null
        val prev = num(ctx, "prevDayPx")?.toFloat() ?: 0f
        Ticker24h(
            symbol = symbol.uppercase(),
            priceChange = if (prev > 0f) mark - prev else 0f,
            priceChangePercent = if (prev > 0f) (mark - prev) / prev * 100f else 0f,
            volume = num(ctx, "dayBaseVlm")?.toFloat() ?: 0f,
            quoteVolume = num(ctx, "dayNtlVlm")?.toFloat() ?: 0f
        )
    }.getOrElse { Log.e(TAG, "24h stats failed for $symbol: ${it.message}"); null }

    /** Hyperliquid pays funding every hour, on the hour. */
    suspend fun fetchFundingInfo(symbol: String): FundingInfo? = runCatching {
        val ctx = assetCtx(symbol) ?: return null
        val now = System.currentTimeMillis()
        FundingInfo(
            symbol = symbol.uppercase(),
            fundingRate = num(ctx, "funding")?.toFloat() ?: 0f,
            nextFundingTime = (now / 3_600_000L + 1) * 3_600_000L,
            markPrice = num(ctx, "markPx")?.toFloat() ?: 0f,
            indexPrice = num(ctx, "oraclePx")?.toFloat() ?: 0f
        )
    }.getOrElse { Log.e(TAG, "Funding failed for $symbol: ${it.message}"); null }
}
