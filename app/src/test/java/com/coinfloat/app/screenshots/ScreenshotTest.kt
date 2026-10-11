package com.coinfloat.app.screenshots

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.ScreenOrientation
import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.Ticker24h
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.ui.HomeContent
import com.coinfloat.app.ui.SettingsContent
import com.coinfloat.app.ui.SymbolsContent
import com.coinfloat.app.ui.theme.Cf
import com.coinfloat.app.ui.theme.CoinFloatTheme
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import java.math.BigDecimal

/**
 * Renders the app screens on the JVM (no device) for design review and visual regression.
 * `./gradlew :app:recordPaparazziDebug` writes the images to app/src/test/snapshots/images.
 */
class ScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 3200, orientation = ScreenOrientation.PORTRAIT),
        maxPercentDifference = 0.1
    )

    private val symbols = listOf("BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT")
    private val info = mapOf(
        "BTCUSDT" to SymbolInfo("BTCUSDT", "BTCUSDT", "BTC", "USDT", "0.10"),
        "ETHUSDT" to SymbolInfo("ETHUSDT", "ETHUSDT", "ETH", "USDT", "0.01"),
        "SOLUSDT" to SymbolInfo("SOLUSDT", "SOLUSDT", "SOL", "USDT", "0.010"),
        "XRPUSDT" to SymbolInfo("XRPUSDT", "XRPUSDT", "XRP", "USDT", "0.0001")
    )
    private val prices = MutableStateFlow(
        mapOf(
            "BTCUSDT" to MarketPrice("BTCUSDT", BigDecimal("83021.10")),
            "ETHUSDT" to MarketPrice("ETHUSDT", BigDecimal("2483.72")),
            "SOLUSDT" to MarketPrice("SOLUSDT", BigDecimal("146.230")),
            "XRPUSDT" to MarketPrice("XRPUSDT", BigDecimal("0.5123"))
        )
    )
    private val tickers = mapOf(
        "BTCUSDT" to Ticker24h("BTCUSDT", priceChangePercent = 0.99f),
        "ETHUSDT" to Ticker24h("ETHUSDT", priceChangePercent = -1.42f),
        "SOLUSDT" to Ticker24h("SOLUSDT", priceChangePercent = 3.18f)
    )

    private fun shot(content: @Composable () -> Unit) = paparazzi.snapshot {
        CoinFloatTheme {
            Box(Modifier.background(Cf.Bg).verticalScroll(rememberScrollState())) { content() }
        }
    }

    @Test
    fun overlayWindow() {
        val ctx = paparazzi.context
        val density = ctx.resources.displayMetrics.density
        fun box(settings: OverlaySettings) = com.coinfloat.app.overlay.OverlayView(ctx).apply {
            applySettings(settings, info)
            updatePrices(
                mapOf(
                    "BTCUSDT" to MarketPrice("BTCUSDT", BigDecimal("83021.10"), dayOpen = BigDecimal("82208.00")),
                    "ETHUSDT" to MarketPrice("ETHUSDT", BigDecimal("2483.72"), dayOpen = BigDecimal("2519.50"))
                ),
                info
            )
        }
        val host = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.parseColor("#2B3A55"))
            setPadding((16 * density).toInt(), (16 * density).toInt(), 0, 0)
            val base = OverlaySettings(selectedSymbols = listOf("BTCUSDT", "ETHUSDT"))
            addView(box(base), android.widget.LinearLayout.LayoutParams(-2, -2))
            addView(box(base.copy(show24hChange = true)), android.widget.LinearLayout.LayoutParams(-2, -2).apply { topMargin = (16 * density).toInt() })
        }
        paparazzi.snapshot(host)
    }

    @Test
    fun miniChart() {
        val ctx = paparazzi.context
        val density = ctx.resources.displayMetrics.density
        val chart = com.coinfloat.app.overlay.MiniChartView(ctx, {}, {}, {}, {})
        chart.applyBackgroundStyle("#1E2024", 0.85f)
        chart.setActiveInterval("15m")
        // deterministic random walk ending "now", so the live candle logic sees a current period
        val now = System.currentTimeMillis() / 900_000L * 900_000L
        var price = 83000f
        val rnd = java.util.Random(7)
        val items = (0 until 80).map { i ->
            val open = price
            val close = open + (rnd.nextGaussian().toFloat() * 60f)
            val high = maxOf(open, close) + rnd.nextFloat() * 40f
            val low = minOf(open, close) - rnd.nextFloat() * 40f
            price = close
            com.coinfloat.app.market.KlineItem(now - (79 - i) * 900_000L, open, high, low, close, 50f + rnd.nextFloat() * 400f)
        }
        chart.setChartData(items)
        chart.updateHeader("BTCUSDT", "83,021.1", price, 0.99f)
        chart.updateLivePrice(price)
        val host = android.widget.FrameLayout(ctx).apply {
            setBackgroundColor(android.graphics.Color.parseColor("#2B3A55"))
            addView(chart, android.widget.FrameLayout.LayoutParams((300 * density).toInt(), (190 * density).toInt()).apply {
                leftMargin = (16 * density).toInt(); topMargin = (16 * density).toInt()
            })
        }
        paparazzi.snapshot(host)
    }

    @Test
    fun home() = shot {
        HomeContent(
            settings = OverlaySettings(selectedSymbols = symbols, isServiceEnabled = true, show24hChange = true),
            isServiceActive = true, connectionState = ConnectionState.CONNECTED,
            hasOverlayPermission = true, hasNotificationPermission = true,
            prices = prices, tickers = tickers, symbolInfo = info,
            onStartService = {}, onStopService = {}, onShowOverlay = {}, onHideOverlay = {},
            onOpenOverlayPermission = {}, onShowPermissionHelp = {}, onRequestNotificationPermission = {},
            onOpenChart = {}, onEditSymbols = {}, onRefreshTickers = {}
        )
    }

    @Test
    fun homeNeedsPermission() = shot {
        HomeContent(
            settings = OverlaySettings(selectedSymbols = symbols),
            isServiceActive = false, connectionState = ConnectionState.DISCONNECTED,
            hasOverlayPermission = false, hasNotificationPermission = false,
            prices = MutableStateFlow(emptyMap()), tickers = emptyMap(), symbolInfo = info,
            onStartService = {}, onStopService = {}, onShowOverlay = {}, onHideOverlay = {},
            onOpenOverlayPermission = {}, onShowPermissionHelp = {}, onRequestNotificationPermission = {},
            onOpenChart = {}, onEditSymbols = {}, onRefreshTickers = {}
        )
    }

    @Test
    fun symbols() = shot {
        SymbolsContent(symbols, "", emptyList(), false, info, {}, {}, {}, {}, {})
    }

    @Test
    fun symbolSearch() = shot {
        SymbolsContent(
            symbols, "SO",
            listOf(SymbolInfo("SOLUSDT", "SOLUSDT", "SOL", "USDT", "0.010"), SymbolInfo("SONICUSDT", "SONICUSDT", "SONIC", "USDT", "0.0001")),
            false, info, {}, {}, {}, {}, {}
        )
    }

    @Test
    fun settingsBottom() = paparazzi.snapshot {
        CoinFloatTheme {
            Box(Modifier.background(Cf.Bg).verticalScroll(rememberScrollState(initial = 1400))) {
                SettingsContent(
                    settings = OverlaySettings(selectedSymbols = symbols),
                    appVersion = "1.8.0",
                    onSymbolDisplayModeChange = {}, onShow24hChangeChange = {}, onFontSizeChange = {}, onTextColorChange = {}, onTextOpacityChange = {},
                    onBackgroundColorChange = {}, onBackgroundOpacityChange = {}, onPaddingChange = {}, onChartEnabledChange = {},
                    onChartIntervalChange = {}, onChartSizeProfileChange = {}, onCustomChartSizeChange = { _, _ -> },
                    onRefreshRateProfileChange = {}, onOpenAppInfo = {}, onShowStabilityHelp = {}, onShowLicenses = {}, onShowPrivacy = {}
                )
            }
        }
    }

    @Test
    fun settings() = shot {
        SettingsContent(
            settings = OverlaySettings(selectedSymbols = symbols),
            appVersion = "1.8.0",
            onSymbolDisplayModeChange = {}, onShow24hChangeChange = {}, onFontSizeChange = {}, onTextColorChange = {}, onTextOpacityChange = {},
            onBackgroundColorChange = {}, onBackgroundOpacityChange = {}, onPaddingChange = {}, onChartEnabledChange = {},
            onChartIntervalChange = {}, onChartSizeProfileChange = {}, onCustomChartSizeChange = { _, _ -> },
            onRefreshRateProfileChange = {}, onOpenAppInfo = {}, onShowStabilityHelp = {}, onShowLicenses = {}, onShowPrivacy = {}
        )
    }
}
