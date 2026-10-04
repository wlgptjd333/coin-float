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
