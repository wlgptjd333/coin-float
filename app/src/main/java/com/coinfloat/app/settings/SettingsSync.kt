package com.coinfloat.app.settings

import org.json.JSONArray
import org.json.JSONObject

/**
 * The part of the app's settings that follows the account: the watchlist and how the floating window looks. Its position
 * and whether the service runs belong to the device. Values from the cloud may come from another version of the app, so
 * each one is checked and anything unusable keeps what this device has.
 */
object SettingsSync {
    fun toJson(s: OverlaySettings): JSONObject = JSONObject()
        .put("symbols", JSONArray(s.selectedSymbols))
        .put("mode", s.symbolDisplayMode.name)
        .put("font", s.fontSizeSp.toDouble())
        .put("textColor", s.textColorHex)
        .put("textOpacity", s.textOpacity.toDouble())
        .put("bgColor", s.backgroundColorHex)
        .put("bgOpacity", s.backgroundOpacity.toDouble())
        .put("padding", s.paddingDp)
        .put("change24h", s.show24hChange)
        .put("chartEnabled", s.isChartEnabled)
        .put("interval", s.defaultChartInterval)
        .put("chartSize", s.chartSizeProfile.name)
        .put("chartW", s.customChartWidthDp)
        .put("chartH", s.customChartHeightDp)
        .put("refresh", s.refreshRateProfile.name)
        .put("upDown", s.upDownScheme.name)

    private val SYMBOL = Regex("^[A-Z0-9]{2,30}$")
    private val COLOR = Regex("^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")

    fun merge(base: OverlaySettings, o: JSONObject): OverlaySettings {
        val symbols = o.optJSONArray("symbols")?.let { a -> (0 until a.length()).map { a.optString(it).trim().uppercase() } }
            ?.filter { SYMBOL.matches(it) }?.distinct()?.takeIf { it.isNotEmpty() } ?: base.selectedSymbols
        return base.copy(
            selectedSymbols = symbols,
            symbolDisplayMode = enumOr(o, "mode", base.symbolDisplayMode),
            fontSizeSp = number(o, "font", 6.0, 40.0)?.toFloat() ?: base.fontSizeSp,
            textColorHex = color(o, "textColor") ?: base.textColorHex,
            textOpacity = number(o, "textOpacity", 0.0, 1.0)?.toFloat() ?: base.textOpacity,
            backgroundColorHex = color(o, "bgColor") ?: base.backgroundColorHex,
            backgroundOpacity = number(o, "bgOpacity", 0.0, 1.0)?.toFloat() ?: base.backgroundOpacity,
            paddingDp = number(o, "padding", 0.0, 40.0)?.toInt() ?: base.paddingDp,
            show24hChange = if (o.has("change24h")) o.optBoolean("change24h") else base.show24hChange,
            isChartEnabled = if (o.has("chartEnabled")) o.optBoolean("chartEnabled") else base.isChartEnabled,
            defaultChartInterval = o.optString("interval").takeIf { Regex("^[0-9]{1,2}[mhdwM]$").matches(it) } ?: base.defaultChartInterval,
            chartSizeProfile = enumOr(o, "chartSize", base.chartSizeProfile),
            customChartWidthDp = number(o, "chartW", 160.0, 420.0)?.toInt() ?: base.customChartWidthDp,
            customChartHeightDp = number(o, "chartH", 110.0, 360.0)?.toInt() ?: base.customChartHeightDp,
            refreshRateProfile = enumOr(o, "refresh", base.refreshRateProfile),
            upDownScheme = enumOr(o, "upDown", base.upDownScheme)
        )
    }

    private fun number(o: JSONObject, key: String, min: Double, max: Double): Double? =
        if (o.has(key)) o.optDouble(key).takeIf { !it.isNaN() && it in min..max } else null

    private fun color(o: JSONObject, key: String): String? = o.optString(key).takeIf { COLOR.matches(it) }

    private inline fun <reified E : Enum<E>> enumOr(o: JSONObject, key: String, fallback: E): E =
        runCatching { enumValueOf<E>(o.optString(key)) }.getOrDefault(fallback)
}
