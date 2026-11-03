package com.coinfloat.app.market

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.math.BigDecimal

class MarketDataRepository(
    private val clientScope: CoroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
) {
    companion object {
        private const val TAG = "MarketDataRepository"
        private const val PUBLISH_INTERVAL_MS = 100L

        @Volatile
        private var instance: MarketDataRepository? = null

        fun getInstance(): MarketDataRepository {
            return instance ?: synchronized(this) {
                instance ?: MarketDataRepository().also { instance = it }
            }
        }

        /** Overall state of the feeds in use: live only when every one of them is. */
        fun combinedState(states: List<ConnectionState>): ConnectionState = when {
            states.isEmpty() -> ConnectionState.DISCONNECTED
            states.all { it == ConnectionState.CONNECTED } -> ConnectionState.CONNECTED
            states.any { it == ConnectionState.RECONNECTING } -> ConnectionState.RECONNECTING
            states.any { it == ConnectionState.CONNECTING } -> ConnectionState.CONNECTING
            else -> ConnectionState.DISCONNECTED
        }
    }

    private val binanceClient = BinanceFuturesClient(clientScope)
    private val hyperliquidClient = HyperliquidClient(clientScope).also { hl ->
        hl.coinOf = { key -> _symbolInfoCache.value[key.uppercase()]?.pair }
    }
    private val variationalClient = VariationalClient(clientScope)
    private val feeds: Map<Exchange, PriceFeed> = mapOf(
        Exchange.BINANCE to binanceClient,
        Exchange.HYPERLIQUID to hyperliquidClient,
        Exchange.VARIATIONAL to variationalClient
    )

    // Venues that have symbols subscribed right now; only those count for the connection state.
    private val activeFeeds = MutableStateFlow<Set<Exchange>>(emptySet())

    val connectionState: StateFlow<ConnectionState> = combine(
        binanceClient.connectionState, hyperliquidClient.connectionState, variationalClient.connectionState, activeFeeds
    ) { b, h, v, active ->
        combinedState(active.map { when (it) { Exchange.BINANCE -> b; Exchange.HYPERLIQUID -> h; Exchange.VARIATIONAL -> v } })
    }.stateIn(clientScope, SharingStarted.Eagerly, ConnectionState.DISCONNECTED)

    val regionBlocked: StateFlow<Boolean> = binanceClient.regionBlocked

    /** Live candles of the floating mini chart's symbol/interval (see [setMiniChartStream]). */
    val klineEvents: Flow<KlineEvent> = merge(binanceClient.klineEvents, hyperliquidClient.klineEvents)

    /** true: every trade (fastest, most messages); false: latest price every 250 ms (default, far fewer messages). */
    fun setFastTrades(fast: Boolean) = binanceClient.setFastTrades(fast)

    /** Drops the current sockets and connects again right away (network changed). No-op while paused/stopped. */
    fun reconnectNow() = feeds.values.forEach { it.reconnectNow() }

    /** The mini chart that is open (or null): its candle stream is subscribed only while it is on screen. */
    fun setMiniChartStream(symbol: String?, interval: String?) {
        val exchange = symbol?.let { Exchange.of(it) }
        binanceClient.setExtraStream(if (symbol != null && exchange == Exchange.BINANCE && interval != null) "${symbol.lowercase()}@kline_$interval" else null)
        hyperliquidClient.setCandleStream(if (exchange == Exchange.HYPERLIQUID) symbol else null, interval)
    }

    private val priceCache = java.util.concurrent.ConcurrentHashMap<String, MarketPrice>()
    private val dayOpenCache = java.util.concurrent.ConcurrentHashMap<String, BigDecimal>()

    private val _marketPrices = MutableStateFlow<Map<String, MarketPrice>>(emptyMap())
    val marketPrices: StateFlow<Map<String, MarketPrice>> = _marketPrices.asStateFlow()

    private val _symbolInfoCache = MutableStateFlow<Map<String, SymbolInfo>>(emptyMap())
    val symbolInfoCache: StateFlow<Map<String, SymbolInfo>> = _symbolInfoCache.asStateFlow()

    private val _isLoadingSymbols = MutableStateFlow(false)
    val isLoadingSymbols: StateFlow<Boolean> = _isLoadingSymbols.asStateFlow()

    private val _ticker24hMap = MutableStateFlow<Map<String, Ticker24h>>(emptyMap())
    val ticker24hMap: StateFlow<Map<String, Ticker24h>> = _ticker24hMap.asStateFlow()

    private val _fundingInfoMap = MutableStateFlow<Map<String, FundingInfo>>(emptyMap())
    val fundingInfoMap: StateFlow<Map<String, FundingInfo>> = _fundingInfoMap.asStateFlow()

    // Multi-consumer state
    private val lock = Any()
    private val overlaySymbols = mutableSetOf<String>()
    private val appSymbols = mutableSetOf<String>()
    private var isOverlayRunning = false
    private var isOverlayPaused = false
    private var isAppActive = false

    init {
        // Trade events update the cache immediately; UI listeners get at most one snapshot per PUBLISH_INTERVAL_MS.
        // The publisher is event driven: with no trades (screen off, feed paused) nothing is scheduled, so the process
        // does not wake up every 100 ms for nothing (the previous fixed-rate loop did exactly that, around the clock).
        clientScope.launch {
            val publishPending = Channel<Unit>(Channel.CONFLATED)
            launch {
                merge(binanceClient.tradeEvents, hyperliquidClient.tradeEvents, variationalClient.tradeEvents).collect { event ->
                    val bdPrice = try {
                        BigDecimal(event.price)
                    } catch (_: Exception) {
                        null
                    }

                    priceCache[event.symbol] = MarketPrice(
                        symbol = event.symbol,
                        price = bdPrice,
                        eventTime = event.eventTime,
                        isStale = false,
                        dayOpen = dayOpenCache[event.symbol]
                    )
                    publishPending.trySend(Unit)
                }
            }
            launch {
                merge(binanceClient.dayEvents, hyperliquidClient.dayEvents).collect { event ->
                    val open = event.open.toBigDecimalOrNull() ?: return@collect
                    if (dayOpenCache.put(event.symbol, open) == open) return@collect     // unchanged: nothing to redraw
                    val current = priceCache[event.symbol]
                    if (current != null) {
                        priceCache[event.symbol] = current.copy(dayOpen = open)
                        publishPending.trySend(Unit)
                    }
                }
            }

            for (signal in publishPending) {
                _marketPrices.value = priceCache.toMap()
                delay(PUBLISH_INTERVAL_MS)      // events arriving meanwhile collapse into the next single publish
            }
        }
    }

    // --- Coordinated Subscription Management ---

    private fun reconcileSubscriptions() {
        val neededSymbols: List<String>

        synchronized(lock) {
            val set = mutableSetOf<String>()
            if (isOverlayRunning && !isOverlayPaused) {
                set.addAll(overlaySymbols)
            }
            if (isAppActive) {
                set.addAll(overlaySymbols)
                set.addAll(appSymbols)
            }
            neededSymbols = set.toList()
        }

        if (neededSymbols.isEmpty()) {
            Log.d(TAG, "No active consumers; pausing every feed to conserve battery")
            activeFeeds.value = emptySet()
            feeds.values.forEach { it.pause() }
            return
        }

        for (sym in neededSymbols) {
            priceCache.putIfAbsent(sym, MarketPrice(symbol = sym, price = null))
        }
        _marketPrices.value = priceCache.toMap()

        val byExchange = neededSymbols.groupBy { Exchange.of(it) }
        activeFeeds.value = byExchange.keys
        for ((exchange, feed) in feeds) {
            val symbols = byExchange[exchange].orEmpty()
            when {
                symbols.isEmpty() -> feed.pause()
                feed.connectionState.value == ConnectionState.DISCONNECTED -> {
                    Log.d(TAG, "Connecting ${exchange.label} for symbols: $symbols")
                    feed.connect(symbols)
                }
                else -> feed.updateSubscriptions(symbols)
            }
        }
    }

    // Called by FloatingOverlayService
    fun setOverlayRunning(running: Boolean, symbols: List<String>) {
        synchronized(lock) {
            isOverlayRunning = running
            isOverlayPaused = false
            overlaySymbols.clear()
            overlaySymbols.addAll(symbols.map { it.uppercase() })
        }
        reconcileSubscriptions()
    }

    fun updateOverlaySymbols(symbols: List<String>) {
        synchronized(lock) {
            overlaySymbols.clear()
            overlaySymbols.addAll(symbols.map { it.uppercase() })
        }
        reconcileSubscriptions()
    }

    fun pauseOverlay() {
        synchronized(lock) {
            isOverlayPaused = true
        }
        reconcileSubscriptions()
    }

    fun resumeOverlay() {
        synchronized(lock) {
            isOverlayPaused = false
        }
        reconcileSubscriptions()
    }

    // Called by the app's screens: [appSymbols] are the symbols the visible screen shows live (chart symbol, watchlist);
    // empty when the visible screen needs none, so nothing is subscribed needlessly.
    fun setAppActive(active: Boolean, appSymbols: Collection<String> = emptyList()) {
        val changed: Boolean
        synchronized(lock) {
            val next = appSymbols.map { it.uppercase() }.toSet()
            changed = isAppActive != active || appSymbols.size != this.appSymbols.size || next != this.appSymbols
            isAppActive = active
            this.appSymbols.clear()
            this.appSymbols.addAll(next)
        }
        if (changed) reconcileSubscriptions()
    }

    // Legacy / direct methods
    fun start(symbols: List<String>) {
        setOverlayRunning(true, symbols)
    }

    fun stop() {
        setOverlayRunning(false, emptyList())
    }

    fun pause() {
        pauseOverlay()
    }

    fun resume() {
        resumeOverlay()
    }

    fun updateSymbols(symbols: List<String>) {
        updateOverlaySymbols(symbols)
    }

    /** Candles for the mini chart. Variational publishes none: an empty list. */
    suspend fun fetchKlines(symbol: String, interval: String = "15m", limit: Int = 30): List<KlineItem> = when (Exchange.of(symbol)) {
        Exchange.BINANCE -> binanceClient.fetchKlines(symbol, interval, limit)
        Exchange.HYPERLIQUID -> hyperliquidClient.fetchKlines(symbol, interval, limit)
        Exchange.VARIATIONAL -> emptyList()
    }

    suspend fun load24hTicker(symbol: String): Ticker24h? {
        val ticker = when (Exchange.of(symbol)) {
            Exchange.BINANCE -> binanceClient.fetch24hTicker(symbol)
            Exchange.HYPERLIQUID -> hyperliquidClient.fetch24hTicker(symbol)
            Exchange.VARIATIONAL -> null
        }
        if (ticker != null) {
            val current = _ticker24hMap.value.toMutableMap()
            current[symbol.uppercase()] = ticker
            _ticker24hMap.value = current
        }
        return ticker
    }

    suspend fun loadFundingInfo(symbol: String): FundingInfo? {
        val info = when (Exchange.of(symbol)) {
            Exchange.BINANCE -> binanceClient.fetchFundingInfo(symbol)
            Exchange.HYPERLIQUID -> hyperliquidClient.fetchFundingInfo(symbol)
            Exchange.VARIATIONAL -> null
        }
        if (info != null) {
            val current = _fundingInfoMap.value.toMutableMap()
            current[symbol.uppercase()] = info
            _fundingInfoMap.value = current
        }
        return info
    }

    /** Where the compact Binance symbol list is kept between app starts (set by the Application); the other venues'
     *  lists sit next to it. */
    @Volatile
    var symbolCacheFile: java.io.File? = null

    private fun cacheFileFor(exchange: Exchange): java.io.File? {
        val f = symbolCacheFile ?: return null
        return if (exchange == Exchange.BINANCE) f else java.io.File(f.parentFile, f.nameWithoutExtension + "-" + exchange.name.lowercase() + ".tsv")
    }

    // App, service and screens all ask for the symbol list at start-up; without the lock each of them downloaded and
    // parsed the full 1.1 MB exchangeInfo at the same time.
    private val exchangeInfoMutex = kotlinx.coroutines.sync.Mutex()
    private val loadedVenues = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<Exchange, Boolean>())

    /** Loads every venue's symbol list (disk copy first, then the network once a day). True when Binance's is there. */
    suspend fun loadExchangeInfoIfNeeded(): Boolean = exchangeInfoMutex.withLock {
        if (loadedVenues.size == Exchange.entries.size) return@withLock true
        val missing = Exchange.entries.filter { it !in loadedVenues }
        if (_symbolInfoCache.value.isEmpty()) _isLoadingSymbols.value = true
        try {
            coroutineScope {
                missing.map { exchange -> async { exchange to loadVenue(exchange) } }.forEach { job ->
                    val (exchange, ok) = job.await()
                    if (ok) loadedVenues.add(exchange)
                }
            }
        } finally {
            _isLoadingSymbols.value = false
        }
        Exchange.BINANCE in loadedVenues
    }

    private suspend fun loadVenue(exchange: Exchange): Boolean {
        // 1) the copy saved on disk (fresh for a day)
        val file = cacheFileFor(exchange)
        val cached = file?.let { f ->
            withContext(Dispatchers.IO) { runCatching { if (f.exists()) SymbolInfoCache.decode(f.readText()) else null }.getOrNull() }
        }
        if (cached != null) {
            publishVenue(exchange, cached.symbols)
            if (System.currentTimeMillis() - cached.savedAt < SymbolInfoCache.MAX_AGE_MS) return true
        }

        // 2) download (also refreshes a day-old copy; on failure the old copy keeps working)
        return try {
            val list = when (exchange) {
                Exchange.BINANCE -> binanceClient.fetchExchangeInfo()
                Exchange.HYPERLIQUID -> hyperliquidClient.fetchUniverse()
                Exchange.VARIATIONAL -> variationalClient.fetchUniverse()
            }
            if (list.isEmpty()) return cached != null
            publishVenue(exchange, list)
            Log.d(TAG, "Loaded ${list.size} ${exchange.label} symbols")
            if (file != null) withContext(Dispatchers.IO) {
                runCatching { file.writeText(SymbolInfoCache.encode(list, System.currentTimeMillis())) }
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load ${exchange.label} symbols: ${e.message}")
            cached != null
        }
    }

    private fun publishVenue(exchange: Exchange, list: List<SymbolInfo>) {
        synchronized(lock) {
            _symbolInfoCache.value = _symbolInfoCache.value.filterValues { it.exchange != exchange } + list.associateBy { it.symbol }
        }
        // Hyperliquid subscriptions made before the list was in may have guessed a coin's name wrongly ("kPEPE")
        if (exchange == Exchange.HYPERLIQUID) hyperliquidClient.reconnectNow()
    }

    /**
     * Symbols matching [query], best matches first: exact name, then names starting with it, then the rest; Binance
     * before Hyperliquid before Variational within each rank. Matches names too ("gold", "strategy").
     */
    fun searchSymbols(query: String): List<SymbolInfo> = rankSymbols(_symbolInfoCache.value.values, query)

    fun getSymbolInfo(symbol: String): SymbolInfo? {
        return _symbolInfoCache.value[symbol.uppercase()]
    }
}

fun rankSymbols(all: Collection<SymbolInfo>, query: String, limit: Int = 80): List<SymbolInfo> {
    val q = query.trim().uppercase()
    if (q.isEmpty()) return emptyList()
    val qKey = q.filter { it in 'A'..'Z' || it in '0'..'9' }
    fun rank(s: SymbolInfo): Int {
        val base = s.baseAsset.uppercase()
        return when {
            base == q || s.symbol == q -> 0
            base.startsWith(q) || s.symbol.startsWith(q) -> 1
            qKey.isNotEmpty() && (base.contains(qKey) || s.symbol.contains(qKey)) -> 2
            s.name.uppercase().contains(q) || s.group.uppercase().contains(q) -> 3
            else -> -1
        }
    }
    return all.asSequence()
        .map { it to rank(it) }
        .filter { it.second >= 0 }
        .sortedWith(compareBy<Pair<SymbolInfo, Int>>({ it.second }, { it.first.exchange.ordinal }, { it.first.symbol.length }, { it.first.symbol }))
        .take(limit)
        .map { it.first }
        .toList()
}
