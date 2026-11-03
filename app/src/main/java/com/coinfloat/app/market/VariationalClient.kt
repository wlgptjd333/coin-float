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
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.floor
import kotlin.math.log10

/**
 * Variational (Omni) perpetuals. Its only public market data is one statistics document with every listing's mark
 * price; there is no stream and no candle history. The document is cached at the edge for about 30 s, so prices are
 * polled at that pace while a Variational symbol is on screen, and nothing is fetched otherwise.
 */
class VariationalClient(
    private val scope: CoroutineScope
) : PriceFeed {
    companion object {
        private const val TAG = "VariationalClient"
        const val STATS_URL = "https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats"
        const val POLL_MS = 30_000L
        private val RETRY_MS = longArrayOf(5_000L, 10_000L, 30_000L)

        data class Listing(val ticker: String, val name: String, val markPrice: String)

        fun parseStats(json: String): List<Listing> {
            val arr = JSONObject(json).optJSONArray("listings") ?: return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val ticker = o.optString("ticker").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                Listing(ticker, o.optString("name"), o.optString("mark_price"))
            }
        }

        /** No tick size is published: about six significant digits of the current price. */
        fun tickSizeFor(price: Double): String {
            if (!(price > 0.0)) return "0.0001"
            val decimals = (5 - floor(log10(price)).toInt()).coerceIn(0, 8)
            return if (decimals == 0) "1" else "0." + "0".repeat(decimals - 1) + "1"
        }

        fun toSymbolInfo(l: Listing): SymbolInfo {
            val tick = tickSizeFor(l.markPrice.toDoubleOrNull() ?: 0.0)
            return SymbolInfo(
                symbol = Exchange.variationalKey(l.ticker),
                pair = l.ticker,
                baseAsset = l.ticker,
                quoteAsset = "USDC",
                tickSize = tick,
                pricePrecision = PriceFormatter.calculateScaleFromTickSize(tick),
                exchange = Exchange.VARIATIONAL,
                name = l.name
            )
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    override val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _tradeEvents = MutableSharedFlow<AggTradeEvent>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val tradeEvents: SharedFlow<AggTradeEvent> = _tradeEvents.asSharedFlow()

    // Neither 24 h statistics nor candles are published.
    override val dayEvents: SharedFlow<DayTickerEvent> = MutableSharedFlow<DayTickerEvent>().asSharedFlow()
    override val klineEvents: SharedFlow<KlineEvent> = MutableSharedFlow<KlineEvent>().asSharedFlow()

    private val lock = Any()
    private val activeSymbols = linkedSetOf<String>()
    private var isPaused = false
    private var pollJob: Job? = null
    @Volatile
    private var last: Map<String, Listing> = emptyMap()

    override fun connect(symbols: List<String>) {
        synchronized(lock) {
            isPaused = false
            activeSymbols.clear()
            activeSymbols.addAll(symbols.map { it.uppercase() })
        }
        startPolling()
    }

    override fun updateSubscriptions(newSymbols: List<String>) {
        val added: Set<String>
        synchronized(lock) {
            val next = newSymbols.map { it.uppercase() }.toSet()
            added = next - activeSymbols
            activeSymbols.clear()
            activeSymbols.addAll(next)
        }
        if (pollJob?.isActive != true) startPolling() else emit(added)      // new symbols show the last known price at once
    }

    override fun pause() {
        synchronized(lock) { isPaused = true }
        pollJob?.cancel()
        pollJob = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    override fun reconnectNow() {
        if (synchronized(lock) { isPaused || activeSymbols.isEmpty() }) return
        startPolling()
    }

    private fun startPolling() {
        pollJob?.cancel()
        if (synchronized(lock) { isPaused || activeSymbols.isEmpty() }) return
        if (_connectionState.value != ConnectionState.CONNECTED) _connectionState.value = ConnectionState.CONNECTING
        pollJob = scope.launch {
            var failures = 0
            while (isActive) {
                val ok = runCatching { last = fetchListings().associateBy { Exchange.variationalKey(it.ticker) } }
                    .onFailure { Log.e(TAG, "Stats failed: ${it.message}") }
                    .isSuccess
                if (ok) {
                    failures = 0
                    _connectionState.value = ConnectionState.CONNECTED
                    emit(synchronized(lock) { activeSymbols.toSet() })
                    delay(POLL_MS)
                } else {
                    _connectionState.value = ConnectionState.RECONNECTING
                    delay(RETRY_MS[failures.coerceAtMost(RETRY_MS.size - 1)])
                    failures++
                }
            }
        }
    }

    private fun emit(keys: Set<String>) {
        val now = System.currentTimeMillis()
        for (key in keys) {
            val price = last[key]?.markPrice?.takeIf { it.toDoubleOrNull() != null } ?: continue
            _tradeEvents.tryEmit(AggTradeEvent("mark", now, key, price, now))
        }
    }

    suspend fun fetchListings(): List<Listing> = withContext(Dispatchers.IO) {
        httpClient.newCall(Request.Builder().url(STATS_URL).get().build()).execute().use { r ->
            if (!r.isSuccessful) throw Exception("Variational HTTP ${r.code}")
            parseStats(r.body?.string() ?: throw Exception("Empty body"))
        }
    }

    suspend fun fetchUniverse(): List<SymbolInfo> = fetchListings().map { toSymbolInfo(it) }
}
