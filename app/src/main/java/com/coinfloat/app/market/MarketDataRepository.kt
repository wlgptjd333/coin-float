package com.coinfloat.app.market

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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

    init {
        // Collect trade events and update price map with high efficiency
        clientScope.launch {
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
                _marketPrices.value = priceCache.toMap()
            }
        }
    }

    fun start(symbols: List<String>) {
        Log.d(TAG, "Starting market data with symbols: $symbols")
        for (sym in symbols) {
            val upper = sym.uppercase()
            priceCache.putIfAbsent(upper, MarketPrice(symbol = upper, price = null))
        }
        _marketPrices.value = priceCache.toMap()
        binanceClient.connect(symbols)
    }

    fun stop() {
        Log.d(TAG, "Stopping market data")
        binanceClient.disconnect()
    }

    fun pause() {
        Log.d(TAG, "Pausing market data (screen off)")
        binanceClient.pause()
    }

    fun resume() {
        Log.d(TAG, "Resuming market data (screen on)")
        binanceClient.resume()
    }

    suspend fun fetchKlines(symbol: String, interval: String = "15m", limit: Int = 30): List<KlineItem> {
        return binanceClient.fetchKlines(symbol, interval, limit)
    }

    fun updateSymbols(symbols: List<String>) {
        Log.d(TAG, "Updating symbols to: $symbols")
        for (sym in symbols) {
            val upper = sym.uppercase()
            priceCache.putIfAbsent(upper, MarketPrice(symbol = upper, price = null))
        }
        _marketPrices.value = priceCache.toMap()
        binanceClient.updateSubscriptions(symbols)
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
