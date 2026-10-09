package com.coinfloat.app

import com.coinfloat.app.ui.ChartInterval
import org.junit.Assert.assertEquals
import org.junit.Test

class ChartIntervalTest {

    @Test
    fun acceptsKnownIntervals() {
        listOf("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w").forEach {
            assertEquals(it, ChartInterval.normalize(it))
        }
    }

    @Test
    fun isCaseAndWhitespaceTolerant() {
        assertEquals("1h", ChartInterval.normalize(" 1H "))
        assertEquals("1d", ChartInterval.normalize("1D"))
    }

    @Test
    fun unknownOrMissingIntervalFallsBackToDefault() {
        assertEquals(ChartInterval.DEFAULT, ChartInterval.normalize(null))
        assertEquals(ChartInterval.DEFAULT, ChartInterval.normalize(""))
        assertEquals(ChartInterval.DEFAULT, ChartInterval.normalize("7m"))
        assertEquals(ChartInterval.DEFAULT, ChartInterval.normalize("15'); alert(1);//"))
    }

    @Test
    fun sanitizeSymbolKeepsOnlyUppercaseLettersAndDigits() {
        assertEquals("BTCUSDT", ChartInterval.sanitizeSymbol("btcusdt"))
        assertEquals("1000PEPEUSDT", ChartInterval.sanitizeSymbol("1000pepeusdt"))
        // Quotes, plus signs, semicolons, slashes and backslashes can never survive into the script.
        assertEquals("BTCALERTUSDT", ChartInterval.sanitizeSymbol("BTC'+alert+'USDT"))
        assertEquals("", ChartInterval.sanitizeSymbol("'\"; \\"))
    }
}
