package com.coinfloat.app

import com.coinfloat.app.settings.ChartSizeProfile
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.RefreshRateProfile
import com.coinfloat.app.settings.SettingsSync
import com.coinfloat.app.settings.SymbolDisplayMode
import com.coinfloat.app.settings.UpDownScheme
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsSyncTest {
    private val changed = OverlaySettings(
        selectedSymbols = listOf("SOLUSDT", "HYPEUSDT"),
        symbolDisplayMode = SymbolDisplayMode.HIDDEN,
        fontSizeSp = 14f,
        textColorHex = "#112233",
        textOpacity = 0.5f,
        backgroundColorHex = "#445566",
        backgroundOpacity = 0.25f,
        paddingDp = 6,
        show24hChange = true,
        isChartEnabled = false,
        defaultChartInterval = "1h",
        chartSizeProfile = ChartSizeProfile.LARGE,
        customChartWidthDp = 300,
        customChartHeightDp = 200,
        refreshRateProfile = RefreshRateProfile.FPS_2,
        upDownScheme = UpDownScheme.RED_BLUE
    )

    @Test
    fun `everything synced comes back unchanged`() {
        assertEquals(changed, SettingsSync.merge(OverlaySettings(), JSONObject(SettingsSync.toJson(changed).toString())))
    }

    @Test
    fun `position and running state stay with the device`() {
        val device = OverlaySettings(overlayX = 120, overlayY = 340, isServiceEnabled = true, isOverlayVisible = false)
        val merged = SettingsSync.merge(device, SettingsSync.toJson(changed.copy(overlayX = 1, overlayY = 2, isServiceEnabled = false, isOverlayVisible = true)))
        assertEquals(120, merged.overlayX)
        assertEquals(340, merged.overlayY)
        assertEquals(true, merged.isServiceEnabled)
        assertEquals(false, merged.isOverlayVisible)
    }

    @Test
    fun `unusable values keep what the device has`() {
        val bad = JSONObject("""{"symbols":[],"mode":"NOPE","font":999,"textColor":"red","padding":-3,"interval":"x","refresh":1,"chartW":"wide"}""")
        val base = OverlaySettings()
        assertEquals(base, SettingsSync.merge(base, bad))
    }

    @Test
    fun `symbols are cleaned`() {
        val merged = SettingsSync.merge(OverlaySettings(), JSONObject("""{"symbols":[" btcusdt ","BTCUSDT","<script>","ETHUSDT"]}"""))
        assertEquals(listOf("BTCUSDT", "ETHUSDT"), merged.selectedSymbols)
    }
}
