package com.coinfloat.app

import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.settings.SymbolDisplayMode
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal

class PriceFormatterTest {

    @Test
    fun testSymbolDisplayModeFormatting() {
        // FULL mode
        assertEquals(
            "BTCUSDT",
            PriceFormatter.formatSymbol("BTCUSDT", "BTC", SymbolDisplayMode.FULL)
        )

        // SHORT mode with baseAsset
        assertEquals(
            "BTC",
            PriceFormatter.formatSymbol("BTCUSDT", "BTC", SymbolDisplayMode.SHORT)
        )

        // SHORT mode fallback without baseAsset
        assertEquals(
            "ETH",
            PriceFormatter.formatSymbol("ETHUSDT", null, SymbolDisplayMode.SHORT)
        )

        // HIDDEN mode
        assertEquals(
            "",
            PriceFormatter.formatSymbol("BTCUSDT", "BTC", SymbolDisplayMode.HIDDEN)
        )
    }

    @Test
    fun testCalculateScaleFromTickSize() {
        assertEquals(2, PriceFormatter.calculateScaleFromTickSize("0.01"))
        assertEquals(1, PriceFormatter.calculateScaleFromTickSize("0.1"))
        assertEquals(4, PriceFormatter.calculateScaleFromTickSize("0.0001"))
        assertEquals(0, PriceFormatter.calculateScaleFromTickSize("1"))
        assertEquals(0, PriceFormatter.calculateScaleFromTickSize("1.0"))
        assertEquals(2, PriceFormatter.calculateScaleFromTickSize(null))
        assertEquals(2, PriceFormatter.calculateScaleFromTickSize("invalid"))
    }

    @Test
    fun testFormatPriceWithVariousTickSizes() {
        // BTC price with 2 decimals and thousands grouping
        val btcPrice = BigDecimal("118250.504")
        assertEquals("118,250.50", PriceFormatter.formatPrice(btcPrice, "0.01"))

        // ETH price with 1 decimal
        val ethPrice = BigDecimal("4325.26")
        assertEquals("4,325.3", PriceFormatter.formatPrice(ethPrice, "0.1"))

        // Low cost altcoin with 4 decimals
        val altPrice = BigDecimal("0.12345")
        assertEquals("0.1235", PriceFormatter.formatPrice(altPrice, "0.0001"))

        // Integer price tickSize
        val intPrice = BigDecimal("50000.9")
        assertEquals("50,001", PriceFormatter.formatPrice(intPrice, "1"))

        // Null price
        assertEquals("—", PriceFormatter.formatPrice(null as BigDecimal?, "0.01"))

        // String price
        assertEquals("118,250.50", PriceFormatter.formatPrice("118250.50", "0.01"))
        assertEquals("—", PriceFormatter.formatPrice(""))
    }
}
