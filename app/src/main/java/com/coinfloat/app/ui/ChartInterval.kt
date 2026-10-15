package com.coinfloat.app.ui

/**
 * Interval and symbol helpers shared by the in-app chart and its tests.
 */
object ChartInterval {
    const val DEFAULT = "15m"

    private val valid = setOf("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M")

    /**
     * Binance-style interval ("15m", "1h", "1d" ...) accepted by the chart page; anything else becomes the default.
     * "1M" (month) and "1m" (minute) differ only by case, so an exact match wins before case is folded.
     */
    fun normalize(interval: String?): String {
        val raw = interval?.trim().orEmpty()
        if (raw in valid) return raw
        val v = raw.lowercase()
        return if (v in valid) v else DEFAULT
    }

    fun isValid(interval: String): Boolean = interval in valid

    /** Label as the chart's interval bar shows it: minutes/hours as is, days and weeks capitalised ("1D"), "1M" month. */
    fun label(interval: String): String =
        if (interval.endsWith("d") || interval.endsWith("w")) interval.uppercase() else interval

    /** "04:12", "1:04:12", or "2일 03:15" for multi-day candles. Never negative. */
    fun formatTimeLeft(ms: Long): String {
        val s = (ms.coerceAtLeast(0L) + 999L) / 1000L          // round up: "00:00" only once the candle has closed
        val d = s / 86_400L
        val h = s % 86_400L / 3_600L
        val m = s % 3_600L / 60L
        val sec = s % 60L
        return when {
            d > 0 -> String.format(java.util.Locale.US, "%d일 %02d:%02d", d, h, m)
            h > 0 -> String.format(java.util.Locale.US, "%d:%02d:%02d", h, m, sec)
            else -> String.format(java.util.Locale.US, "%02d:%02d", m, sec)
        }
    }

    /** Keeps only characters that are safe to embed in a JavaScript string literal for a symbol. */
    fun sanitizeSymbol(symbol: String): String =
        symbol.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
}
