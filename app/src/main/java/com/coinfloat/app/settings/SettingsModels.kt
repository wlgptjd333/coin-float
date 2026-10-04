package com.coinfloat.app.settings

enum class SymbolDisplayMode {
    FULL,
    SHORT,
    HIDDEN
}

enum class ChartSizeProfile(val label: String, val widthDp: Int, val heightDp: Int) {
    SMALL("작은 사이즈 (200x135)", 200, 135),
    MEDIUM("보통 사이즈 (260x170)", 260, 170),
    LARGE("큰 사이즈 (320x220)", 320, 220),
    CUSTOM("커스텀 프로필", 260, 170)
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
    val defaultChartInterval: String = "15m",
    val chartSizeProfile: ChartSizeProfile = ChartSizeProfile.MEDIUM,
    val customChartWidthDp: Int = 260,
    val customChartHeightDp: Int = 170
) {
    fun getChartDimensionsDp(): Pair<Int, Int> = when (chartSizeProfile) {
        ChartSizeProfile.SMALL -> Pair(ChartSizeProfile.SMALL.widthDp, ChartSizeProfile.SMALL.heightDp)
        ChartSizeProfile.MEDIUM -> Pair(ChartSizeProfile.MEDIUM.widthDp, ChartSizeProfile.MEDIUM.heightDp)
        ChartSizeProfile.LARGE -> Pair(ChartSizeProfile.LARGE.widthDp, ChartSizeProfile.LARGE.heightDp)
        ChartSizeProfile.CUSTOM -> Pair(
            customChartWidthDp.coerceIn(160, 420),
            customChartHeightDp.coerceIn(110, 360)
        )
    }
}

