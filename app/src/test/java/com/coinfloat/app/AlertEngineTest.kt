package com.coinfloat.app

import com.coinfloat.app.alerts.AlertEngine
import com.coinfloat.app.alerts.AlertRule
import com.coinfloat.app.alerts.AlertTime
import com.coinfloat.app.alerts.Bar
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertEngineTest {

    private fun bars(closes: List<Double>, vols: List<Double> = closes.map { 10.0 }, buy: List<Double> = vols.map { it / 2 }) =
        closes.indices.map { i ->
            val o = if (i == 0) closes[0] else closes[i - 1]
            Bar(i * 60_000L, o, maxOf(o, closes[i]) + 0.1, minOf(o, closes[i]) - 0.1, closes[i], vols[i], buy[i])
        }

    @Test
    fun rsiMatchesWildersTextbookExample() {
        // the classic 14-period example (StockCharts): first RSI 70.53, then 66.32, 66.55, 69.41, 66.36, 57.97
        val c = doubleArrayOf(44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
            46.28, 46.00, 46.03, 46.41, 46.22, 45.64)
        val r = AlertEngine.rsi(c, 14)
        assertTrue(r[13].isNaN())
        val want = doubleArrayOf(70.53, 66.32, 66.55, 69.41, 66.36, 57.97)
        // the book rounds its averages to two decimals on the way, so its RSIs are off by up to ~0.1
        for (k in want.indices) assertEquals(want[k], r[14 + k], 0.15)
    }

    @Test
    fun emaIsSeededWithTheSimpleAverage() {
        val e = AlertEngine.ema(doubleArrayOf(1.0, 2.0, 3.0, 4.0, 5.0), 3)
        assertTrue(e[1].isNaN())
        assertEquals(2.0, e[2], 1e-12)
        assertEquals(3.0, e[3], 1e-12)                      // 2 + 0.5 * (4 - 2)
    }

    @Test
    fun cvdUsesTakerBuyVolume() {
        val b = bars(listOf(1.0, 1.0, 1.0), vols = listOf(10.0, 10.0, 10.0), buy = listOf(7.0, 2.0, 5.0))
        val c = AlertEngine.cvd(b)
        assertEquals(4.0, c[0], 1e-12); assertEquals(-2.0, c[1], 1e-12); assertEquals(-2.0, c[2], 1e-12)
    }

    @Test
    fun pivotNeedsBarsOnBothSides() {
        val s = doubleArrayOf(5.0, 4.0, 3.0, 1.0, 2.0, 3.0, 4.0)
        assertTrue(AlertEngine.isPivot(s, 3, 3, 3, high = false))
        assertTrue(!AlertEngine.isPivot(s, 3, 3, 4, high = false))     // not enough bars on the right yet
        assertTrue(!AlertEngine.isPivot(s, 2, 2, 2, high = false))
    }

    @Test
    fun volumeSpikeComparesWithThePreviousAverage() {
        val closes = List(22) { 100.0 }
        assertNotNull(AlertEngine.volumeSpike(bars(closes, vols = List(21) { 10.0 } + 35.0), 3.0))
        assertNull(AlertEngine.volumeSpike(bars(closes, vols = List(21) { 10.0 } + 25.0), 3.0))
    }

    @Test
    fun breakoutFiresOnTheFirstCloseBeyondTheRange() {
        val flat = List(21) { 100.0 }
        assertNotNull(AlertEngine.breakout(bars(flat + 102.0), 20, up = true, down = false))
        assertNull(AlertEngine.breakout(bars(flat + 102.0 + 103.0), 20, up = true, down = false))    // already above
        val down = AlertEngine.breakout(bars(flat + 97.0), 20, up = false, down = true)
        assertNotNull(down); assertTrue(down!!.title.contains("저점"))
    }

    @Test
    fun lineCrossFollowsASlopedLine() {
        // line from (0, 100) to (10 min, 110): 1 per minute
        val b = bars(listOf(100.0, 101.0, 101.5, 104.5))
        val s = AlertEngine.lineCross(b, 0L, 100.0, 600_000L, 110.0, 60_000L, up = true, down = true, label = "추세선")
        assertNotNull(s)                                       // 101.5 <= 103 before, 104.5 > 104 now
        val h = AlertEngine.lineCross(bars(listOf(100.0, 99.0, 98.0)), 0L, 98.5, 0L, 98.5, 60_000L, up = true, down = true, label = "98.5")
        assertTrue(h!!.title.contains("하향"))
    }

    @Test
    fun regularBullishRsiDivergence() {
        // a fast drop to a low, a bounce, a slow drift to a lower low (weaker selling), then a recovery
        val c = ArrayList<Double>()
        var p = 100.0
        repeat(30) { p += if (it % 2 == 0) 0.4 else -0.4; c += p }
        repeat(8) { p -= 3.0; c += p }                 // low A
        repeat(8) { p += 2.0; c += p }
        repeat(20) { p -= 0.9; c += p }                // lower low B (74 < 76), gentler
        repeat(6) { p += 1.5; c += p }
        val b = bars(c)
        var bull = 0; var bear = 0
        for (n in 45..b.size) {
            val s = AlertEngine.divergence(b.subList(0, n), AlertEngine.Source.RSI, regular = true, hidden = false, bull = true, bear = true)
            if (s != null && s.title.contains("상승")) bull++
            if (s != null && s.title.contains("하락")) bear++
        }
        assertTrue("bullish divergence expected", bull >= 1)
        assertEquals(0, bear)
    }

    @Test
    fun rsiLevelCrossFiresOnceOnTheCrossingCandle() {
        val c = ArrayList<Double>(); var p = 100.0
        repeat(30) { p -= 0.5; c += p }                       // a long fall: RSI deep below 30
        repeat(6) { p += 1.5; c += p }                        // a strong bounce lifts it through 30
        val b = bars(c)
        var hits = 0
        for (n in 20..b.size) if (AlertEngine.indicatorCross(b.subList(0, n), "rsi", up = true, down = false, len = 14, lvl = 30.0) != null) hits++
        assertEquals(1, hits)
    }

    @Test
    fun goldenAndDeadCross() {
        val c = ArrayList<Double>(); var p = 100.0
        repeat(40) { p -= 0.3; c += p }
        repeat(40) { p += 0.6; c += p }
        val b = bars(c)
        var golden = 0; var dead = 0
        for (n in 30..b.size) {
            val s = AlertEngine.indicatorCross(b.subList(0, n), "mama", up = true, down = true, len = 5, len2 = 20, useEma = false) ?: continue
            if (s.marker == "골든") golden++ else dead++
        }
        assertEquals(1, golden); assertEquals(0, dead)
    }

    @Test
    fun priceAcrossMaAndBollinger() {
        val flat = List(30) { 100.0 + if (it % 2 == 0) 0.2 else -0.2 }
        val up = bars(flat + 103.0)
        assertNotNull(AlertEngine.indicatorCross(up, "pma", up = true, down = false, len = 20, useEma = false))
        assertNotNull(AlertEngine.indicatorCross(up, "bb", up = true, down = false, len = 20, bbm = 2.0))
        assertNull(AlertEngine.indicatorCross(bars(flat + 100.1), "bb", up = true, down = true, len = 20, bbm = 2.0))
    }

    @Test
    fun macdCrossesItsSignal() {
        val c = ArrayList<Double>(); var p = 100.0
        repeat(60) { p -= 0.4; c += p }
        repeat(30) { p += 1.0; c += p }
        val b = bars(c)
        var hits = 0
        for (n in 40..b.size) if (AlertEngine.indicatorCross(b.subList(0, n), "macd", up = true, down = false) != null) hits++
        assertEquals(1, hits)
    }

    @Test
    fun weeklyCandlesOpenOnMonday() {
        val wed = 1_791_936_000_000L                         // 2026-10-14 (Wednesday) 00:00 UTC
        val open = AlertTime.currentOpen("1w", wed)
        assertEquals(1_791_763_200_000L, open)               // Monday 2026-10-12 00:00 UTC
        assertEquals(open + 604_800_000L, AlertTime.nextClose("1w", wed))
        assertEquals(wed - 900_000L, AlertTime.lastClosedOpen("15m", wed))
    }

    @Test
    fun malformedRulesAreDropped() {
        assertNull(AlertRule.fromJson(JSONObject("""{"id":"a","symbol":"btc usdt","interval":"15m","kind":"vol"}""")))
        assertNull(AlertRule.fromJson(JSONObject("""{"id":"a","symbol":"BTCUSDT","interval":"3d","kind":"vol"}""")))
        assertNull(AlertRule.fromJson(JSONObject("""{"id":"a","symbol":"BTCUSDT","interval":"15m","kind":"line","p1":0}""")))
        val r = AlertRule.fromJson(JSONObject("""{"id":"a","symbol":"btcusdt","interval":"15m","kind":"vol","mult":999}"""))
        assertEquals("BTCUSDT", r!!.symbol)
        assertEquals(50.0, r.mult, 0.0)
    }
}
