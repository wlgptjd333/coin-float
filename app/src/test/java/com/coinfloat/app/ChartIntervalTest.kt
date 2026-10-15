package com.coinfloat.app

import com.coinfloat.app.ui.ChartInterval
import org.junit.Assert.assertEquals
import org.junit.Test

class ChartIntervalTest {

    @Test
    fun acceptsKnownIntervals() {
        listOf("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M").forEach {
            assertEquals(it, ChartInterval.normalize(it))
        }
    }

    @Test
    fun isCaseAndWhitespaceTolerant() {
        assertEquals("1h", ChartInterval.normalize(" 1H "))
        assertEquals("1d", ChartInterval.normalize("1D"))
    }

    @Test
    fun monthAndMinuteStayDistinct() {
        assertEquals("1M", ChartInterval.normalize("1M"))
        assertEquals("1m", ChartInterval.normalize("1m"))
        assertEquals("1w", ChartInterval.normalize("1W"))
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

    @Test
    fun timeLeftFormats() {
        assertEquals("04:12", ChartInterval.formatTimeLeft(252_000L))
        assertEquals("00:01", ChartInterval.formatTimeLeft(400L))              // rounds up: 0 only once closed
        assertEquals("00:00", ChartInterval.formatTimeLeft(-5_000L))
        assertEquals("1:00:00", ChartInterval.formatTimeLeft(3_600_000L))
        assertEquals("23:59", ChartInterval.formatTimeLeft(1_439_000L))
        assertEquals("2일 03:15", ChartInterval.formatTimeLeft((2 * 86_400L + 3 * 3_600L + 15 * 60L) * 1000L))
    }

    @Test
    fun labelsMatchTheChartBar() {
        assertEquals("15m", ChartInterval.label("15m"))
        assertEquals("4h", ChartInterval.label("4h"))
        assertEquals("1D", ChartInterval.label("1d"))
        assertEquals("1W", ChartInterval.label("1w"))
        assertEquals("1M", ChartInterval.label("1M"))
    }

    @Test
    fun parsesCandleCloseFromThePage() {
        assertEquals(com.coinfloat.app.ui.CandleClose("15m", 1760100900000L), com.coinfloat.app.ui.parseCandleClose("15m|1760100900000"))
        assertEquals(null, com.coinfloat.app.ui.parseCandleClose(""))
        assertEquals(null, com.coinfloat.app.ui.parseCandleClose("7x|1"))
        assertEquals(null, com.coinfloat.app.ui.parseCandleClose("15m|abc"))
    }
}
