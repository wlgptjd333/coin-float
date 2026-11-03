package com.coinfloat.app.market

import java.math.BigDecimal

/** One venue's live price feed: what [MarketDataRepository] needs from each exchange client. */
interface PriceFeed {
    val connectionState: kotlinx.coroutines.flow.StateFlow<ConnectionState>
    val tradeEvents: kotlinx.coroutines.flow.SharedFlow<AggTradeEvent>
    val dayEvents: kotlinx.coroutines.flow.SharedFlow<DayTickerEvent>
    val klineEvents: kotlinx.coroutines.flow.SharedFlow<KlineEvent>
    fun connect(symbols: List<String>)
    fun updateSubscriptions(newSymbols: List<String>)
    fun pause()
    fun reconnectNow()
}

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING
}

data class MarketPrice(
    val symbol: String,
    val price: BigDecimal?,
    val eventTime: Long? = null,
    val isStale: Boolean = false,
    /** Price 24 h ago (Binance rolling 24 h window), from the mini-ticker stream; null until the first one arrives. */
    val dayOpen: BigDecimal? = null
)

/** 24 h change in percent, or null while the 24 h open price is not known yet. */
fun MarketPrice.dayChangePercent(): Float? {
    val p = price ?: return null
    val o = dayOpen ?: return null
    if (o.signum() == 0) return null
    return ((p.toDouble() - o.toDouble()) / o.toDouble() * 100.0).toFloat()
}

/** Live candle from the kline stream (several per second while a mini chart is open). */
data class KlineEvent(val symbol: String, val interval: String, val item: KlineItem, val closeText: String = "")

/** Mini-ticker (1/s per symbol): only what the app uses. */
data class DayTickerEvent(val symbol: String, val open: String)

/**
 * Where a symbol's prices come from. Binance keys are the plain contract ("BTCUSDT"); the others carry a prefix
 * ("HL-BTC", "HL-XYZ-TSLA", "VAR-TSLA"), so every key stays upper-case letters, digits and dashes, which the settings,
 * the sync and the chart page all accept.
 */
enum class Exchange(val prefix: String, val label: String) {
    BINANCE("", "Binance"),
    HYPERLIQUID("HL-", "Hyperliquid"),
    VARIATIONAL("VAR-", "Variational");

    companion object {
        fun of(symbol: String): Exchange = when {
            symbol.startsWith(HYPERLIQUID.prefix, ignoreCase = true) -> HYPERLIQUID
            symbol.startsWith(VARIATIONAL.prefix, ignoreCase = true) -> VARIATIONAL
            else -> BINANCE
        }

        private fun keyPart(s: String) = s.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }

        /** "BTC" -> "HL-BTC", "xyz:TSLA" -> "HL-XYZ-TSLA" (Hyperliquid's coin names are case-sensitive: "kPEPE"). */
        fun hyperliquidKey(coin: String): String =
            HYPERLIQUID.prefix + coin.split(':').joinToString("-") { keyPart(it) }

        fun variationalKey(ticker: String): String = VARIATIONAL.prefix + keyPart(ticker)

        /** The coin's short name without the venue prefix or quote ("BTCUSDT" -> "BTC", "HL-XYZ-TSLA" -> "TSLA"). */
        fun baseOf(symbol: String): String {
            val s = symbol.uppercase()
            return when (of(s)) {
                BINANCE -> if (s.endsWith("USDT") && s.length > 4) s.removeSuffix("USDT") else s
                else -> s.substringAfterLast('-')
            }
        }
    }
}

data class SymbolInfo(
    val symbol: String,
    /** Binance: the pair; Hyperliquid: the exact coin name ("kPEPE", "xyz:TSLA"); Variational: the ticker. */
    val pair: String,
    val baseAsset: String,
    val quoteAsset: String,
    val tickSize: String,
    val pricePrecision: Int = 2,
    val exchange: Exchange = Exchange.BINANCE,
    /** What kind of market beyond plain coins ("주식", "원자재") or the venue's market group ("XYZ"); empty for coins. */
    val group: String = "",
    /** Full name when the venue gives one ("Strategy Inc"). */
    val name: String = ""
) {
    /** One line under the symbol in lists: "Binance · 주식", "Hyperliquid · XYZ", "Variational · Strategy Inc". */
    fun subtitle(): String = buildList {
        add(exchange.label)
        if (group.isNotEmpty()) add(group)
        if (name.isNotEmpty() && !name.equals(baseAsset, ignoreCase = true)) add(name)
        if (exchange == Exchange.BINANCE && group.isEmpty()) add("$quoteAsset 무기한")
    }.joinToString(" · ")
}

/** One row of the market list: last price, 24 h change (null where the venue publishes none), 24 h turnover in USD(T). */
data class MarketTicker(val symbol: String, val price: Double, val changePercent: Double?, val quoteVolume: Double)

/** The market list's rankings, like exchange apps: most traded, biggest risers, biggest fallers. */
enum class MarketSort(val label: String) { VOLUME("거래대금"), GAINERS("상승"), LOSERS("하락") }

/**
 * A ranking, optionally on one venue: every market by default (the list only draws the rows on screen). Risers and fallers leave out markets that barely trade ([minVolume] of
 * 24 h turnover): a thinly traded listing can move 50 % on one order and would fill the list with noise.
 */
fun rankMarket(
    tickers: Collection<MarketTicker>,
    sort: MarketSort,
    venue: Exchange? = null,
    minVolume: Double = 100_000.0,
    limit: Int = Int.MAX_VALUE
): List<MarketTicker> {
    val pool = tickers.asSequence().filter { venue == null || Exchange.of(it.symbol) == venue }.filter { it.price > 0.0 }
    return when (sort) {
        MarketSort.VOLUME -> pool.filter { it.quoteVolume > 0.0 }.sortedByDescending { it.quoteVolume }
        MarketSort.GAINERS -> pool.filter { it.changePercent != null && it.quoteVolume >= minVolume }.sortedByDescending { it.changePercent }
        MarketSort.LOSERS -> pool.filter { it.changePercent != null && it.quoteVolume >= minVolume }.sortedBy { it.changePercent }
    }.take(limit).toList()
}

/** Short name for headers: "BTCUSDT", "xyz:TSLA (HL)", "SOXL (VAR)". */
fun displaySymbol(symbol: String, info: SymbolInfo?): String = when (Exchange.of(symbol)) {
    Exchange.BINANCE -> symbol
    Exchange.HYPERLIQUID -> "${info?.pair ?: HyperliquidClient.guessCoin(symbol)} (HL)"
    Exchange.VARIATIONAL -> "${info?.pair ?: Exchange.baseOf(symbol)} (VAR)"
}

/** Subtitle for a key whose details are not loaded yet. */
fun subtitleOf(symbol: String, info: SymbolInfo?): String = info?.subtitle() ?: Exchange.of(symbol).label

data class AggTradeEvent(
    val eventType: String,
    val eventTime: Long,
    val symbol: String,
    val price: String,
    val tradeTime: Long
)

data class KlineItem(
    val openTime: Long,
    val open: Float,
    val high: Float,
    val low: Float,
    val close: Float,
    val volume: Float
)

data class Ticker24h(
    val symbol: String,
    val priceChange: Float = 0f,
    val priceChangePercent: Float = 0f,
    val highPrice: Float = 0f,
    val lowPrice: Float = 0f,
    val volume: Float = 0f,
    val quoteVolume: Float = 0f
)

data class FundingInfo(
    val symbol: String,
    val fundingRate: Float = 0f,
    val nextFundingTime: Long = 0L,
    val markPrice: Float = 0f,
    val indexPrice: Float = 0f
)

