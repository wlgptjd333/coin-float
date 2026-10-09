package com.coinfloat.app.market

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
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
    }

    private val binanceClient = BinanceFuturesClient(clientScope)

    val connectionState: StateFlow<ConnectionState> = binanceClient.connectionState

    private val priceCache = java.util.concurrent.ConcurrentHashMap<String, MarketPrice>()

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
    private var appActiveSymbol: String? = null
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
                binanceClient.tradeEvents.collect { event ->
                    val bdPrice = try {
                        BigDecimal(event.price)
                    } catch (_: Exception) {
                        null
                    }

                    priceCache[event.symbol] = MarketPrice(
                        symbol = event.symbol,
                        price = bdPrice,
                        eventTime = event.eventTime,
                        isStale = false
                    )
                    publishPending.trySend(Unit)
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
        val shouldBeConnected: Boolean

        synchronized(lock) {
            val set = mutableSetOf<String>()
            if (isOverlayRunning && !isOverlayPaused) {
                set.addAll(overlaySymbols)
            }
            if (isAppActive) {
                set.addAll(overlaySymbols)
                appActiveSymbol?.let { set.add(it.uppercase()) }
            }
            neededSymbols = set.toList()
            shouldBeConnected = neededSymbols.isNotEmpty()
        }

        if (!shouldBeConnected) {
            Log.d(TAG, "No active consumers; pausing WebSocket to conserve 100% battery")
            binanceClient.pause()
        } else {
            for (sym in neededSymbols) {
                priceCache.putIfAbsent(sym, MarketPrice(symbol = sym, price = null))
            }
            _marketPrices.value = priceCache.toMap()

            if (binanceClient.connectionState.value == ConnectionState.DISCONNECTED) {
                Log.d(TAG, "Connecting WebSocket for symbols: $neededSymbols")
                binanceClient.connect(neededSymbols)
            } else {
                Log.d(TAG, "Updating WebSocket subscriptions for symbols: $neededSymbols")
                binanceClient.updateSubscriptions(neededSymbols)
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

    // Called by in-app screens (TradingViewChartScreen / SettingsViewModel).
    // [currentChartSymbol] is the symbol the app itself needs a live feed for; null when no in-app
    // screen is showing one (so it is not subscribed needlessly).
    fun setAppActive(active: Boolean, currentChartSymbol: String? = null) {
        synchronized(lock) {
            isAppActive = active
            appActiveSymbol = currentChartSymbol?.uppercase()
        }
        reconcileSubscriptions()
    }

    fun setAppActiveSymbol(symbol: String) {
        val changed: Boolean
        synchronized(lock) {
            val upper = symbol.uppercase()
            changed = appActiveSymbol != upper
            appActiveSymbol = upper
        }
        if (changed) {
            reconcileSubscriptions()
        }
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

    suspend fun fetchKlines(symbol: String, interval: String = "15m", limit: Int = 30): List<KlineItem> {
        return binanceClient.fetchKlines(symbol, interval, limit)
    }

    suspend fun load24hTicker(symbol: String): Ticker24h? {
        val ticker = binanceClient.fetch24hTicker(symbol)
        if (ticker != null) {
            val current = _ticker24hMap.value.toMutableMap()
            current[symbol.uppercase()] = ticker
            _ticker24hMap.value = current
        }
        return ticker
    }

    suspend fun loadFundingInfo(symbol: String): FundingInfo? {
        val info = binanceClient.fetchFundingInfo(symbol)
        if (info != null) {
            val current = _fundingInfoMap.value.toMutableMap()
            current[symbol.uppercase()] = info
            _fundingInfoMap.value = current
        }
        return info
    }

    suspend fun loadExchangeInfoIfNeeded(): Boolean {
        if (_symbolInfoCache.value.isNotEmpty()) return true

        _isLoadingSymbols.value = true
        return try {
            val list = binanceClient.fetchExchangeInfo()
            val map = list.associateBy { it.symbol }
            _symbolInfoCache.value = map
            Log.d(TAG, "Loaded ${map.size} USDT perpetual symbols into cache")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load exchange info: ${e.message}")
            false
        } finally {
            _isLoadingSymbols.value = false
        }
    }

    fun searchSymbols(query: String): List<SymbolInfo> {
        val q = query.trim().uppercase()
        if (q.isEmpty()) return emptyList()

        return _symbolInfoCache.value.values
            .filter { it.symbol.contains(q) || it.baseAsset.uppercase().contains(q) }
            .take(50)
    }

    fun getSymbolInfo(symbol: String): SymbolInfo? {
        return _symbolInfoCache.value[symbol.uppercase()]
    }
}
