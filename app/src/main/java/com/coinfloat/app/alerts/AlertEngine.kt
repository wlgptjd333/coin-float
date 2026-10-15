package com.coinfloat.app.alerts

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** One closed candle as the alert engine sees it (prices and volumes as doubles, taker buy volume for the CVD). */
data class Bar(
    val openTime: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val takerBuy: Double
)

/** What fired: the candle it fired on, a short title for the notification and a line of detail. */
data class Signal(val candleTime: Long, val key: String, val title: String, val detail: String, val marker: String)

/**
 * Indicator math and the conditions, written like Pine's built-ins so the results match TradingView:
 * RSI (Wilder's RMA seeded with an SMA), EMA seeded with an SMA, MACD 12/26/9, pivots as ta.pivothigh / ta.pivotlow.
 * Every function works on closed candles only; index n - 1 is the candle that just closed.
 */
object AlertEngine {

    fun sma(src: DoubleArray, len: Int): DoubleArray {
        val out = DoubleArray(src.size) { Double.NaN }
        var sum = 0.0
        for (i in src.indices) {
            sum += src[i]
            if (i >= len) sum -= src[i - len]
            if (i >= len - 1) out[i] = sum / len
        }
        return out
    }

    fun ema(src: DoubleArray, len: Int): DoubleArray {
        val out = DoubleArray(src.size) { Double.NaN }
        val a = 2.0 / (len + 1)
        var started = false
        var sum = 0.0
        var count = 0
        for (i in src.indices) {
            val v = src[i]
            if (v.isNaN()) continue
            if (!started) {
                sum += v; count++
                if (count == len) { out[i] = sum / len; started = true }
            } else out[i] = out[i - 1] + a * (v - out[i - 1])
        }
        return out
    }

    fun rsi(close: DoubleArray, len: Int): DoubleArray {
        val out = DoubleArray(close.size) { Double.NaN }
        var g = 0.0
        var l = 0.0
        for (i in 1 until close.size) {
            val ch = close[i] - close[i - 1]
            val up = max(ch, 0.0)
            val dn = max(-ch, 0.0)
            if (i <= len) { g += up; l += dn; if (i == len) { g /= len; l /= len } }
            else { g = (g * (len - 1) + up) / len; l = (l * (len - 1) + dn) / len }
            if (i >= len) out[i] = if (l == 0.0) 100.0 else if (g == 0.0) 0.0 else 100.0 - 100.0 / (1.0 + g / l)
        }
        return out
    }

    /** MACD line (fast EMA - slow EMA) and its signal EMA. */
    fun macd(close: DoubleArray, fast: Int = 12, slow: Int = 26, signal: Int = 9): Pair<DoubleArray, DoubleArray> {
        val f = ema(close, fast)
        val s = ema(close, slow)
        val line = DoubleArray(close.size) { if (f[it].isNaN() || s[it].isNaN()) Double.NaN else f[it] - s[it] }
        return line to ema(line, signal)
    }

    /** Cumulative volume delta from the candles' taker buy volume (exact aggressor data, not an estimate). */
    fun cvd(bars: List<Bar>): DoubleArray {
        val out = DoubleArray(bars.size)
        var acc = 0.0
        for (i in bars.indices) { acc += 2 * bars[i].takerBuy - bars[i].volume; out[i] = acc }
        return out
    }

    /** ta.pivotlow / ta.pivothigh: is bar p strictly the lowest (highest) of [p - left, p + right]? Ties on the left count, like Pine. */
    fun isPivot(src: DoubleArray, p: Int, left: Int, right: Int, high: Boolean): Boolean {
        if (p - left < 0 || p + right >= src.size || src[p].isNaN()) return false
        val v = src[p]
        for (i in p - left..p + right) {
            if (i == p || src[i].isNaN()) continue
            if (high) { if (if (i < p) src[i] > v else src[i] >= v) return false }
            else { if (if (i < p) src[i] < v else src[i] <= v) return false }
        }
        return true
    }

    enum class Source { RSI, MACD, CVD, VOLUME }

    /**
     * Divergence confirmed on the newest closed candle: the pivot is `right` bars back (it needs those bars to be a
     * pivot), compared with the previous pivot of the same kind 5..60 bars before it, like TradingView's
     * "RSI Divergence" script. Regular: price makes a new extreme and the oscillator does not. Hidden: the opposite.
     * Volume: price pivots, a new high (low) on less volume than the previous one.
     */
    fun divergence(
        bars: List<Bar>, source: Source, regular: Boolean, hidden: Boolean, bull: Boolean, bear: Boolean,
        left: Int = 5, right: Int = 3, minGap: Int = 5, maxGap: Int = 60
    ): Signal? {
        val n = bars.size
        val p = n - 1 - right
        if (p - left < 1) return null
        val close = DoubleArray(n) { bars[it].close }
        val lows = DoubleArray(n) { bars[it].low }
        val highs = DoubleArray(n) { bars[it].high }
        val osc: DoubleArray = when (source) {
            Source.RSI -> rsi(close, 14)
            Source.MACD -> macd(close).first
            Source.CVD -> cvd(bars)
            Source.VOLUME -> DoubleArray(n) { bars[it].volume }
        }
        val name = when (source) { Source.RSI -> "RSI"; Source.MACD -> "MACD"; Source.CVD -> "CVD"; Source.VOLUME -> "거래량" }
        // pivots: on the oscillator, or on price for the volume divergence
        fun pivotSrcLow() = if (source == Source.VOLUME) lows else osc
        fun pivotSrcHigh() = if (source == Source.VOLUME) highs else osc
        fun prevPivot(src: DoubleArray, high: Boolean): Int {
            for (q in p - minGap downTo max(left, p - maxGap)) if (isPivot(src, q, left, right, high)) return q
            return -1
        }
        if (bull && isPivot(pivotSrcLow(), p, left, right, false)) {
            val q = prevPivot(pivotSrcLow(), false)
            if (q >= 0) {
                val priceLL = lows[p] < lows[q]
                val oscHL = osc[p] > osc[q]
                val hit = when {
                    source == Source.VOLUME -> if (regular && priceLL && osc[p] < osc[q]) "일반" else null
                    regular && priceLL && oscHL -> "일반"
                    hidden && !priceLL && lows[p] > lows[q] && osc[p] < osc[q] -> "히든"
                    else -> null
                }
                if (hit != null) return Signal(
                    bars[p].openTime, "div-bull-${bars[q].openTime}-${bars[p].openTime}",
                    "$name $hit 상승 다이버전스",
                    if (source == Source.VOLUME) "가격은 저점을 낮췄는데 거래량은 줄었습니다 (매도 소진)"
                    else "가격 저점 ${if (priceLL) "↓" else "↑"} · $name 저점 ${if (oscHL) "↑" else "↓"} (${p - q}봉 간격)",
                    "$name↑"
                )
            }
        }
        if (bear && isPivot(pivotSrcHigh(), p, left, right, true)) {
            val q = prevPivot(pivotSrcHigh(), true)
            if (q >= 0) {
                val priceHH = highs[p] > highs[q]
                val oscLH = osc[p] < osc[q]
                val hit = when {
                    source == Source.VOLUME -> if (regular && priceHH && oscLH) "일반" else null
                    regular && priceHH && oscLH -> "일반"
                    hidden && !priceHH && highs[p] < highs[q] && osc[p] > osc[q] -> "히든"
                    else -> null
                }
                if (hit != null) return Signal(
                    bars[p].openTime, "div-bear-${bars[q].openTime}-${bars[p].openTime}",
                    "$name $hit 하락 다이버전스",
                    if (source == Source.VOLUME) "가격은 고점을 높였는데 거래량은 줄었습니다 (매수 약화)"
                    else "가격 고점 ${if (priceHH) "↑" else "↓"} · $name 고점 ${if (oscLH) "↓" else "↑"} (${p - q}봉 간격)",
                    "$name↓"
                )
            }
        }
        return null
    }

    /** The newest closed candle traded at least `mult` times the average volume of the `len` candles before it. */
    fun volumeSpike(bars: List<Bar>, mult: Double, len: Int = 20): Signal? {
        val n = bars.size
        if (n < len + 1) return null
        var sum = 0.0
        for (i in n - 1 - len until n - 1) sum += bars[i].volume
        val avg = sum / len
        val last = bars[n - 1]
        if (avg <= 0 || last.volume < mult * avg) return null
        val ratio = last.volume / avg
        val dir = if (last.close >= last.open) "양봉" else "음봉"
        return Signal(last.openTime, "vol-${last.openTime}", "거래량 급증 · 평균의 ${fmt1(ratio)}배",
            "$dir · 직전 ${len}봉 평균 대비 ${fmt1(ratio)}배", "V×${fmt1(ratio)}")
    }

    /** Close beyond the highest high (lowest low) of the `len` candles before it, when the candle before had not broken out. */
    fun breakout(bars: List<Bar>, len: Int, up: Boolean, down: Boolean, volMult: Double = 0.0): Signal? {
        val n = bars.size
        if (n < len + 2) return null
        val last = bars[n - 1]
        val prev = bars[n - 2]
        var hi = Double.NEGATIVE_INFINITY
        var lo = Double.POSITIVE_INFINITY
        for (i in n - 1 - len until n - 1) { hi = max(hi, bars[i].high); lo = min(lo, bars[i].low) }
        if (volMult > 0) {
            var sum = 0.0
            for (i in n - 1 - len until n - 1) sum += bars[i].volume
            if (last.volume < volMult * sum / len) return null
        }
        // the candle before must not have broken out already (beyond the range that came before it)
        var hiPrev = Double.NEGATIVE_INFINITY
        var loPrev = Double.POSITIVE_INFINITY
        for (i in n - 2 - len until n - 2) { if (i < 0) continue; hiPrev = max(hiPrev, bars[i].high); loPrev = min(loPrev, bars[i].low) }
        if (up && last.close > hi && prev.close <= hiPrev) {
            return Signal(last.openTime, "brk-up-${last.openTime}", "${len}봉 고점 돌파", "직전 ${len}봉 최고가 ${fmtP(hi)} 위에서 마감", "돌파↑")
        }
        if (down && last.close < lo && prev.close >= loPrev) {
            return Signal(last.openTime, "brk-dn-${last.openTime}", "${len}봉 저점 이탈", "직전 ${len}봉 최저가 ${fmtP(lo)} 아래에서 마감", "이탈↓")
        }
        return null
    }

    /**
     * A price level or a line drawn on the chart: (t1, p1) - (t2, p2), times in ms, extended both ways; a horizontal line
     * has p1 == p2. Fires when the newest close is on the other side of the line than the close before it.
     */
    fun lineCross(bars: List<Bar>, t1: Long, p1: Double, t2: Long, p2: Double, intervalMs: Long, up: Boolean, down: Boolean, label: String): Signal? {
        val n = bars.size
        if (n < 2) return null
        fun at(t: Long): Double = if (t1 == t2 || p1 == p2) p1 else p1 + (p2 - p1) * (t - t1).toDouble() / (t2 - t1).toDouble()
        val last = bars[n - 1]
        val prev = bars[n - 2]
        val lNow = at(last.openTime + intervalMs)          // the line where the candle closed
        val lPrev = at(prev.openTime + intervalMs)
        if (up && prev.close <= lPrev && last.close > lNow) {
            return Signal(last.openTime, "line-up-${last.openTime}", "$label 상향 돌파", "${fmtP(lNow)} 위에서 마감", "선↑")
        }
        if (down && prev.close >= lPrev && last.close < lNow) {
            return Signal(last.openTime, "line-dn-${last.openTime}", "$label 하향 이탈", "${fmtP(lNow)} 아래에서 마감", "선↓")
        }
        return null
    }

    /** Bollinger bands like ta.bb: SMA and the population standard deviation of the closes. */
    fun bollinger(close: DoubleArray, len: Int, mult: Double): Pair<DoubleArray, DoubleArray> {
        val mid = sma(close, len)
        val up = DoubleArray(close.size) { Double.NaN }
        val lo = DoubleArray(close.size) { Double.NaN }
        for (i in close.indices) {
            if (mid[i].isNaN()) continue
            var sq = 0.0
            for (j in i - len + 1..i) { val d = close[j] - mid[i]; sq += d * d }
            val sd = Math.sqrt(sq / len)
            up[i] = mid[i] + mult * sd; lo[i] = mid[i] - mult * sd
        }
        return up to lo
    }

    private fun crossUp(a0: Double, a1: Double, b0: Double, b1: Double) = !a0.isNaN() && !a1.isNaN() && !b0.isNaN() && !b1.isNaN() && a0 <= b0 && a1 > b1
    private fun crossDn(a0: Double, a1: Double, b0: Double, b1: Double) = !a0.isNaN() && !a1.isNaN() && !b0.isNaN() && !b1.isNaN() && a0 >= b0 && a1 < b1

    /**
     * Indicator conditions on the newest closed candle (like TradingView's ta.crossover / ta.crossunder):
     * rsi: RSI(len) across `lvl`; pma: close across an MA(len); mama: MA(len) across MA(len2) (golden / dead cross);
     * macd: MACD line across its signal; macd0: MACD line across zero; bb: close beyond the Bollinger band (len, bbm).
     */
    fun indicatorCross(
        bars: List<Bar>, cond: String, up: Boolean, down: Boolean,
        len: Int = 14, lvl: Double = 70.0, len2: Int = 50, useEma: Boolean = true, bbm: Double = 2.0
    ): Signal? {
        val n = bars.size
        if (n < 3) return null
        val close = DoubleArray(n) { bars[it].close }
        val a = n - 2
        val z = n - 1
        val t = bars[z].openTime
        fun avg(len: Int) = if (useEma) ema(close, len) else sma(close, len)
        val maName = if (useEma) "EMA" else "SMA"
        when (cond) {
            "rsi" -> {
                val r = rsi(close, len)
                if (up && crossUp(r[a], r[z], lvl, lvl)) return Signal(t, "rsi-up-$t", "RSI($len) $lvl 상향 돌파", "RSI ${fmt1(r[a])} → ${fmt1(r[z])}", "RSI↑")
                if (down && crossDn(r[a], r[z], lvl, lvl)) return Signal(t, "rsi-dn-$t", "RSI($len) $lvl 하향 이탈", "RSI ${fmt1(r[a])} → ${fmt1(r[z])}", "RSI↓")
            }
            "pma" -> {
                val m = avg(len)
                if (up && crossUp(close[a], close[z], m[a], m[z])) return Signal(t, "pma-up-$t", "가격이 $maName$len 위로 돌파", "$maName$len ${fmtP(m[z])} 위에서 마감", "$maName↑")
                if (down && crossDn(close[a], close[z], m[a], m[z])) return Signal(t, "pma-dn-$t", "가격이 $maName$len 아래로 이탈", "$maName$len ${fmtP(m[z])} 아래에서 마감", "$maName↓")
            }
            "mama" -> {
                val f = avg(len)
                val s = avg(len2)
                if (up && crossUp(f[a], f[z], s[a], s[z])) return Signal(t, "mama-up-$t", "골든 크로스 $maName$len × $len2", "$maName$len ${fmtP(f[z])}이 $maName$len2 ${fmtP(s[z])} 위로", "골든")
                if (down && crossDn(f[a], f[z], s[a], s[z])) return Signal(t, "mama-dn-$t", "데드 크로스 $maName$len × $len2", "$maName$len ${fmtP(f[z])}이 $maName$len2 ${fmtP(s[z])} 아래로", "데드")
            }
            "macd", "macd0" -> {
                val (m, sg) = macd(close)
                val ref = if (cond == "macd") sg else DoubleArray(n) { 0.0 }
                val what = if (cond == "macd") "시그널" else "0선"
                if (up && crossUp(m[a], m[z], ref[a], ref[z])) return Signal(t, "$cond-up-$t", "MACD $what 상향 교차", "MACD ${fmtP(m[z])}", "MACD↑")
                if (down && crossDn(m[a], m[z], ref[a], ref[z])) return Signal(t, "$cond-dn-$t", "MACD $what 하향 교차", "MACD ${fmtP(m[z])}", "MACD↓")
            }
            "bb" -> {
                val (u, l) = bollinger(close, len, bbm)
                if (up && crossUp(close[a], close[z], u[a], u[z])) return Signal(t, "bb-up-$t", "볼린저 상단 돌파 ($len, $bbm)", "상단 ${fmtP(u[z])} 위에서 마감", "BB↑")
                if (down && crossDn(close[a], close[z], l[a], l[z])) return Signal(t, "bb-dn-$t", "볼린저 하단 이탈 ($len, $bbm)", "하단 ${fmtP(l[z])} 아래에서 마감", "BB↓")
            }
        }
        return null
    }

    private fun fmt1(v: Double) = String.format(java.util.Locale.US, "%.1f", v)
    fun fmtP(v: Double): String {
        val a = abs(v)
        val dec = when { a >= 1000 -> 1; a >= 1 -> 3; a >= 0.01 -> 5; else -> 8 }
        return String.format(java.util.Locale.US, "%,.${dec}f", v).trimEnd('0').trimEnd('.')
    }
}
