package com.coinfloat.app

import com.coinfloat.app.settings.ChartSizeProfile
import com.coinfloat.app.settings.OverlaySettings
import org.junit.Assert.assertEquals
import org.junit.Test

class ChartSettingsTest {

    @Test
    fun testChartSizeProfilesDimensions() {
        assertEquals(200, ChartSizeProfile.SMALL.widthDp)
        assertEquals(135, ChartSizeProfile.SMALL.heightDp)

        assertEquals(260, ChartSizeProfile.MEDIUM.widthDp)
        assertEquals(170, ChartSizeProfile.MEDIUM.heightDp)

        assertEquals(320, ChartSizeProfile.LARGE.widthDp)
        assertEquals(220, ChartSizeProfile.LARGE.heightDp)
    }

    @Test
    fun testOverlaySettingsDimensionsByProfile() {
        val smallSettings = OverlaySettings(chartSizeProfile = ChartSizeProfile.SMALL)
        assertEquals(Pair(200, 135), smallSettings.getChartDimensionsDp())

        val mediumSettings = OverlaySettings(chartSizeProfile = ChartSizeProfile.MEDIUM)
        assertEquals(Pair(260, 170), mediumSettings.getChartDimensionsDp())

        val largeSettings = OverlaySettings(chartSizeProfile = ChartSizeProfile.LARGE)
        assertEquals(Pair(320, 220), largeSettings.getChartDimensionsDp())

        val customSettings = OverlaySettings(
            chartSizeProfile = ChartSizeProfile.CUSTOM,
            customChartWidthDp = 300,
            customChartHeightDp = 200
        )
        assertEquals(Pair(300, 200), customSettings.getChartDimensionsDp())
    }

    @Test
    fun testCustomDimensionsClamping() {
        val tooSmall = OverlaySettings(
            chartSizeProfile = ChartSizeProfile.CUSTOM,
            customChartWidthDp = 50,
            customChartHeightDp = 50
        )
        val (minW, minH) = tooSmall.getChartDimensionsDp()
        assertEquals(160, minW)
        assertEquals(110, minH)

        val tooLarge = OverlaySettings(
            chartSizeProfile = ChartSizeProfile.CUSTOM,
            customChartWidthDp = 999,
            customChartHeightDp = 999
        )
        val (maxW, maxH) = tooLarge.getChartDimensionsDp()
        assertEquals(420, maxW)
        assertEquals(360, maxH)
    }

    @Test
    fun testSupportedIntervalsList() {
        val supportedIntervals = listOf("1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d")
        assertEquals(8, supportedIntervals.size)
        assertEquals("15m", OverlaySettings().defaultChartInterval)
    }
}
