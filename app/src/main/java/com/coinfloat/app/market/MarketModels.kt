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
    val isStale: Boolean = false
)

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

