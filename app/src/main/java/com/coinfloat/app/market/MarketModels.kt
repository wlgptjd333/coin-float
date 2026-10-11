package com.coinfloat.app.market

import java.math.BigDecimal

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
data class KlineEvent(val symbol: String, val interval: String, val item: KlineItem)

/** Mini-ticker (1/s per symbol): only what the app uses. */
data class DayTickerEvent(val symbol: String, val open: String)

data class SymbolInfo(
    val symbol: String,
    val pair: String,
    val baseAsset: String,
    val quoteAsset: String,
    val tickSize: String,
    val pricePrecision: Int = 2
)

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

