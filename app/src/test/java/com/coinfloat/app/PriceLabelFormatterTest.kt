package com.coinfloat.app

import com.coinfloat.app.market.PriceFormatter
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PriceLabelFormatterTest {

    @Test
    fun labelPriceKeepsSensibleDecimalsForNormalPrices() {
        assertEquals("118250.5", PriceFormatter.formatLabelPrice(118250.5f))
        assertEquals("3240.2", PriceFormatter.formatLabelPrice(3240.2f))
        assertEquals("2.35", PriceFormatter.formatLabelPrice(2.3512f))
        assertEquals("0.1234", PriceFormatter.formatLabelPrice(0.1234f))
    }

    @Test
    fun labelPriceDoesNotCollapseTinyPricesToZero() {
        val shiba = PriceFormatter.formatLabelPrice(0.00001234f)
        assertNotEquals("0.0000", shiba)
        assertEquals("0.00001234", shiba)

        val pepe = PriceFormatter.formatLabelPrice(0.0000008123f)
        assertNotEquals("0.0000", pepe)
        assertEquals("0.0000008123", pepe)
    }

    @Test
    fun labelPriceHandlesZero() {
        assertEquals("0", PriceFormatter.formatLabelPrice(0f))
    }

    @Test
    fun compactVolumeUsesSuffixes() {
        assertEquals("2.50B", PriceFormatter.formatCompactVolume(2_500_000_000f))
        assertEquals("1.23M", PriceFormatter.formatCompactVolume(1_234_567f))
        assertEquals("12.3K", PriceFormatter.formatCompactVolume(12_345f))
        assertEquals("999.0", PriceFormatter.formatCompactVolume(999f))
    }

    @Test
    fun formatPriceIsStableAcrossRepeatedCalls() {
        // Formatters are cached per scale; repeated and interleaved scales must not leak state.
        repeat(3) {
            assertEquals("118,250.50", PriceFormatter.formatPrice(BigDecimal("118250.5"), "0.01"))
            assertEquals("0.12345", PriceFormatter.formatPrice(BigDecimal("0.123449"), "0.00001"))
            assertEquals("3,240", PriceFormatter.formatPrice(BigDecimal("3239.6"), "1"))
        }
    }
}
