package com.coinfloat.app.ui

/**
 * Interval and symbol helpers shared by the in-app chart and its tests.
 */
object ChartInterval {
    const val DEFAULT = "15m"

    private val valid = setOf("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w")

    /** Binance-style interval ("15m", "1h", "1d" ...) accepted by the chart page; anything else becomes the default. */
    fun normalize(interval: String?): String {
        val v = interval?.trim()?.lowercase().orEmpty()
        return if (v in valid) v else DEFAULT
    }

    /** Keeps only characters that are safe to embed in a JavaScript string literal for a symbol. */
    fun sanitizeSymbol(symbol: String): String =
        symbol.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
}
