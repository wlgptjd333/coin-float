package com.coinfloat.app.market

import com.coinfloat.app.settings.SymbolDisplayMode
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

object PriceFormatter {

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

        val symbols = DecimalFormatSymbols(Locale.US)
        val pattern = buildString {
            append("#,##0")
            if (scale > 0) {
                append(".")
                repeat(scale) { append("0") }
            }
        }
        val df = DecimalFormat(pattern, symbols)
        return df.format(rounded)
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
