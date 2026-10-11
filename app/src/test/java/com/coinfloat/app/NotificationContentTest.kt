package com.coinfloat.app

import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.notification.CoinFloatNotification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

class NotificationContentTest {

    private val symbols = listOf("BTCUSDT", "ETHUSDT")
    private val info = mapOf(
        "BTCUSDT" to SymbolInfo("BTCUSDT", "BTCUSDT", "BTC", "USDT", "0.10"),
        "ETHUSDT" to SymbolInfo("ETHUSDT", "ETHUSDT", "ETH", "USDT", "0.01")
    )
    private val prices = mapOf(
        "BTCUSDT" to MarketPrice("BTCUSDT", BigDecimal("101.0"), dayOpen = BigDecimal("100")),
        "ETHUSDT" to MarketPrice("ETHUSDT", BigDecimal("2483.72"))
    )

    @Test
    fun liveShowsFirstCoinAsTitleAndTheRestBelow() {
        val c = CoinFloatNotification.content(symbols, ConnectionState.CONNECTED, true, prices, info)
        assertEquals("BTC 101.0  +1.00%", c.title)
        assertEquals("ETH 2,483.72", c.text)
        assertEquals(2, c.lines.size)
    }

    @Test
    fun hiddenOrReconnectingIsMarkedAsNotLive() {
        val hidden = CoinFloatNotification.content(symbols, ConnectionState.DISCONNECTED, false, prices, info)
        assertTrue(hidden.text.endsWith("숨김 · 마지막 가격"))
        val reconnecting = CoinFloatNotification.content(symbols, ConnectionState.RECONNECTING, true, prices, info)
        assertTrue(reconnecting.text.endsWith("연결 중…"))
    }

    @Test
    fun missingPriceShowsADash() {
        val c = CoinFloatNotification.content(listOf("SOLUSDT"), ConnectionState.CONNECTED, true, emptyMap(), emptyMap())
        assertEquals("SOL —", c.title)
        assertEquals("실시간", c.text)
    }
}
