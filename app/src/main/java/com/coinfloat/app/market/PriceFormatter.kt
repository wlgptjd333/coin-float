package com.coinfloat.app.market

import com.coinfloat.app.settings.SymbolDisplayMode
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs

object PriceFormatter {

    // DecimalFormat is not thread-safe and is costly to build; prices are formatted several times per
    // second per symbol, so keep one instance per (thread, scale).
    private val formatCache = object : ThreadLocal<MutableMap<Int, DecimalFormat>>() {
        override fun initialValue(): MutableMap<Int, DecimalFormat> = HashMap()
    }

    private fun formatFor(scale: Int): DecimalFormat {
        val cache = formatCache.get()!!
        return cache.getOrPut(scale) {
            val pattern = buildString {
                append("#,##0")
                if (scale > 0) {
                    append(".")
                    repeat(scale) { append("0") }
                }
            }
            DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
        }
    }

    /**
     * Determines decimal scale from tickSize string.
     * E.g. "0.01" -> 2, "0.0001" -> 4, "1" -> 0, "0.10000" -> 1
     */
    fun calculateScaleFromTickSize(tickSize: String?): Int {
        if (tickSize.isNullOrBlank()) return 2
        return try {
            val bd = BigDecimal(tickSize).stripTrailingZeros()
            val scale = bd.scale()
            if (scale < 0) 0 else scale
        } catch (_: Exception) {
            2
        }
    }

    /**
     * Formats BigDecimal price using given tickSize.
     * Adds commas for thousands grouping (e.g. 118,250.50).
     */
    fun formatPrice(price: BigDecimal?, tickSize: String? = null): String {
        if (price == null) return "—"
        val scale = calculateScaleFromTickSize(tickSize)
        val rounded = price.setScale(scale, RoundingMode.HALF_UP)
        return formatFor(scale).format(rounded)
    }

    /**
     * Overload for String price.
     */
    fun formatPrice(priceStr: String?, tickSize: String? = null): String {
        if (priceStr.isNullOrBlank()) return "—"
        return try {
            formatPrice(BigDecimal(priceStr), tickSize)
        } catch (_: Exception) {
            "—"
        }
    }

    /**
     * Compact price for chart axes/labels where no tick size is at hand. Keeps about four
     * significant digits for sub-dollar prices so that e.g. 0.00001234 is not shown as 0.0000.
     */
    fun formatLabelPrice(price: Float): String {
        val abs = abs(price)
        return when {
            abs >= 1000f -> String.format(Locale.US, "%.1f", price)
            abs >= 1f -> String.format(Locale.US, "%.2f", price)
            abs >= 0.01f -> String.format(Locale.US, "%.4f", price)
            abs == 0f -> "0"
            else -> {
                val decimals = (3 - Math.floor(Math.log10(abs.toDouble())).toInt()).coerceIn(4, 10)
                String.format(Locale.US, "%.${decimals}f", price)
            }
        }
    }

    /**
     * Shortens large volumes: 1_234_567 -> "1.23M", 2_500_000_000 -> "2.50B".
     */
    fun formatCompactVolume(value: Float): String {
        val abs = abs(value)
        return when {
            abs >= 1_000_000_000f -> String.format(Locale.US, "%.2fB", value / 1_000_000_000f)
            abs >= 1_000_000f -> String.format(Locale.US, "%.2fM", value / 1_000_000f)
            abs >= 1_000f -> String.format(Locale.US, "%.1fK", value / 1_000f)
            else -> String.format(Locale.US, "%.1f", value)
        }
    }

    /**
     * Formats symbol name according to SymbolDisplayMode.
     */
    fun formatSymbol(symbol: String, baseAsset: String? = null, mode: SymbolDisplayMode): String {
        return when (mode) {
            SymbolDisplayMode.FULL -> symbol.uppercase()
            SymbolDisplayMode.SHORT -> {
                if (!baseAsset.isNullOrBlank()) {
                    baseAsset.uppercase()
                } else if (symbol.endsWith("USDT", ignoreCase = true) && symbol.length > 4) {
                    symbol.substring(0, symbol.length - 4).uppercase()
                } else {
                    symbol.uppercase()
                }
            }
            SymbolDisplayMode.HIDDEN -> ""
        }
    }
}
