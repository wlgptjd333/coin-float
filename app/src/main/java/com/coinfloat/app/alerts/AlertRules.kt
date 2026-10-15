package com.coinfloat.app.alerts

import org.json.JSONArray
import org.json.JSONObject

/**
 * An alert the user set on the chart. Kinds:
 *  - "vol"  volume of a closed candle >= mult x the average of the previous 20
 *  - "div"  divergence (src: rsi | macd | cvd | vol; reg / hid; bull / bear)
 *  - "brk"  close beyond the highest high / lowest low of the previous `len` candles
 *  - "line" close across a price level or a line drawn on the chart (t1, p1, t2, p2)
 */
data class AlertRule(
    val id: String,
    val symbol: String,
    val interval: String,
    val kind: String,
    val on: Boolean = true,
    val once: Boolean = false,
    val mult: Double = 3.0,
    val src: String = "rsi",
    val reg: Boolean = true,
    val hid: Boolean = false,
    val up: Boolean = true,
    val down: Boolean = true,
    val len: Int = 20,
    val right: Int = 3,
    val volMult: Double = 0.0,
    val t1: Long = 0, val p1: Double = 0.0, val t2: Long = 0, val p2: Double = 0.0,
    val label: String = "",
    val drawing: String = "",
    // "ind": an indicator condition (cond: rsi | pma | mama | macd | macd0 | bb)
    val cond: String = "rsi",
    val lvl: Double = 70.0,
    val len2: Int = 50,
    val ma: String = "ema",
    val bbm: Double = 2.0
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("symbol", symbol); put("interval", interval); put("kind", kind); put("on", on); put("once", once)
        put("mult", mult); put("src", src); put("reg", reg); put("hid", hid); put("up", up); put("down", down)
        put("len", len); put("right", right); put("volMult", volMult)
        put("t1", t1); put("p1", p1); put("t2", t2); put("p2", p2); put("label", label); put("drawing", drawing)
        put("cond", cond); put("lvl", lvl); put("len2", len2); put("ma", ma); put("bbm", bbm)
    }

    companion object {
        val KINDS = setOf("vol", "div", "brk", "line", "ind")
        val CONDS = setOf("rsi", "pma", "mama", "macd", "macd0", "bb")
        val SOURCES = setOf("rsi", "macd", "cvd", "vol")
        private val SYMBOL = Regex("^[A-Z0-9]{2,30}$")

        /** Rules come from the chart page: anything malformed is dropped, numbers are clamped. */
        fun fromJson(o: JSONObject): AlertRule? {
            val symbol = o.optString("symbol").uppercase()
            val interval = o.optString("interval")
            val kind = o.optString("kind")
            if (!SYMBOL.matches(symbol) || !AlertTime.supported(interval) || kind !in KINDS) return null
            val id = o.optString("id").filter { it.isLetterOrDigit() || it == '-' }.take(40).ifEmpty { return null }
            val p1 = o.optDouble("p1", 0.0)
            val p2 = o.optDouble("p2", p1)
            if (kind == "line" && !(p1 > 0 && p2 > 0 && p1.isFinite() && p2.isFinite())) return null
            return AlertRule(
                id = id, symbol = symbol, interval = interval, kind = kind,
                on = o.optBoolean("on", true), once = o.optBoolean("once", false),
                mult = o.optDouble("mult", 3.0).coerceIn(1.2, 50.0),
                src = o.optString("src", "rsi").takeIf { it in SOURCES } ?: "rsi",
                reg = o.optBoolean("reg", true), hid = o.optBoolean("hid", false),
                up = o.optBoolean("up", true), down = o.optBoolean("down", true),
                len = o.optInt("len", 20).coerceIn(2, 400), right = o.optInt("right", 3).coerceIn(1, 10),
                volMult = o.optDouble("volMult", 0.0).coerceIn(0.0, 20.0),
                t1 = o.optLong("t1", 0), p1 = p1, t2 = o.optLong("t2", 0), p2 = p2,
                label = o.optString("label").take(40), drawing = o.optString("drawing").take(40),
                cond = o.optString("cond", "rsi").takeIf { it in CONDS } ?: "rsi",
                lvl = o.optDouble("lvl", 70.0).let { if (it.isFinite()) it.coerceIn(0.0, 100.0) else 70.0 },
                len2 = o.optInt("len2", 50).coerceIn(2, 400), ma = if (o.optString("ma") == "sma") "sma" else "ema",
                bbm = o.optDouble("bbm", 2.0).let { if (it.isFinite()) it.coerceIn(0.5, 5.0) else 2.0 }
            )
        }

        fun listFromJson(text: String?): List<AlertRule> = runCatching {
            val a = JSONArray(text ?: "[]")
            (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::fromJson) }.take(MAX_RULES)
        }.getOrDefault(emptyList())

        const val MAX_RULES = 100
    }
}

/** A fired alert, kept for the history list and the chart markers. */
data class AlertEvent(
    val ruleId: String, val symbol: String, val interval: String, val candleTime: Long, val at: Long,
    val title: String, val detail: String, val marker: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("ruleId", ruleId); put("symbol", symbol); put("interval", interval); put("t", candleTime); put("at", at)
        put("title", title); put("detail", detail); put("marker", marker)
    }

    companion object {
        fun fromJson(o: JSONObject) = AlertEvent(
            o.optString("ruleId"), o.optString("symbol"), o.optString("interval"), o.optLong("t"), o.optLong("at"),
            o.optString("title"), o.optString("detail"), o.optString("marker")
        )
    }
}

/** Candle boundaries of the intervals alerts support (Binance futures candles are aligned to UTC). */
object AlertTime {
    private val ms = mapOf(
        "1m" to 60_000L, "3m" to 180_000L, "5m" to 300_000L, "15m" to 900_000L, "30m" to 1_800_000L,
        "1h" to 3_600_000L, "2h" to 7_200_000L, "4h" to 14_400_000L, "6h" to 21_600_000L, "8h" to 28_800_000L, "12h" to 43_200_000L,
        "1d" to 86_400_000L, "1w" to 604_800_000L
    )
    private const val MONDAY = 4 * 86_400_000L          // 1970-01-01 was a Thursday; weekly candles open on Mondays

    fun supported(interval: String) = interval in ms
    fun length(interval: String): Long = ms[interval] ?: 60_000L

    /** Open time of the candle that is forming at `now`. */
    fun currentOpen(interval: String, now: Long): Long {
        val len = length(interval)
        return if (interval == "1w") Math.floorDiv(now - MONDAY, len) * len + MONDAY else Math.floorDiv(now, len) * len
    }

    /** Open time of the newest closed candle at `now`. */
    fun lastClosedOpen(interval: String, now: Long) = currentOpen(interval, now) - length(interval)

    fun nextClose(interval: String, now: Long) = currentOpen(interval, now) + length(interval)
}
