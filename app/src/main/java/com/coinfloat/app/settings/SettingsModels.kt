package com.coinfloat.app.settings

enum class SymbolDisplayMode {
    FULL,
    SHORT,
    HIDDEN
}

data class SymbolConfig(
    val symbol: String,
    val customDisplayName: String? = null
)

data class OverlaySettings(
    val selectedSymbols: List<String> = listOf("BTCUSDT", "ETHUSDT"),
    val symbolDisplayMode: SymbolDisplayMode = SymbolDisplayMode.SHORT,
    val fontSizeSp: Float = 11f,
    val textColorHex: String = "#65D69A",
    val textOpacity: Float = 1.0f,
    val backgroundColorHex: String = "#1E2024",
    val backgroundOpacity: Float = 0.85f,
    val paddingDp: Int = 2,
    val show24hChange: Boolean = false,
    val overlayX: Int = -1,
    val overlayY: Int = -1,
    val isServiceEnabled: Boolean = false,
    val isOverlayVisible: Boolean = true,
    val isChartEnabled: Boolean = true,
    val defaultChartInterval: String = "15m"
)
