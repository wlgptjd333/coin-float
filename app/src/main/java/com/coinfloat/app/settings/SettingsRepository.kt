package com.coinfloat.app.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.io.IOException

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "coinfloat_settings")

class SettingsRepository(
    private val context: Context,
    scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) {
    companion object {
        private val KEY_SELECTED_SYMBOLS = stringPreferencesKey("selected_symbols")
        private val KEY_SYMBOL_DISPLAY_MODE = stringPreferencesKey("symbol_display_mode")
        private val KEY_FONT_SIZE_SP = floatPreferencesKey("font_size_sp")
        private val KEY_TEXT_COLOR = stringPreferencesKey("text_color")
        private val KEY_TEXT_OPACITY = floatPreferencesKey("text_opacity")
        private val KEY_BACKGROUND_COLOR = stringPreferencesKey("background_color")
        private val KEY_BACKGROUND_OPACITY = floatPreferencesKey("background_opacity")
        private val KEY_PADDING_DP = intPreferencesKey("padding_dp")
        private val KEY_SHOW_24H_CHANGE = booleanPreferencesKey("show_24h_change")
        private val KEY_OVERLAY_X = intPreferencesKey("overlay_x")
        private val KEY_OVERLAY_Y = intPreferencesKey("overlay_y")
        private val KEY_SERVICE_ENABLED = booleanPreferencesKey("service_enabled")
        private val KEY_OVERLAY_VISIBLE = booleanPreferencesKey("overlay_visible")

        @Volatile
        private var instance: SettingsRepository? = null

        fun getInstance(context: Context): SettingsRepository {
            return instance ?: synchronized(this) {
                instance ?: SettingsRepository(context.applicationContext).also { instance = it }
            }
        }
    }

    val settingsFlow: StateFlow<OverlaySettings> = context.dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { preferences ->
            val symbolsStr = preferences[KEY_SELECTED_SYMBOLS] ?: "BTCUSDT,ETHUSDT"
            val symbols = symbolsStr.split(",")
                .map { it.trim().uppercase() }
                .filter { it.isNotEmpty() }
                .ifEmpty { listOf("BTCUSDT", "ETHUSDT") }

            val modeStr = preferences[KEY_SYMBOL_DISPLAY_MODE] ?: SymbolDisplayMode.SHORT.name
            val mode = try {
                SymbolDisplayMode.valueOf(modeStr)
            } catch (_: Exception) {
                SymbolDisplayMode.SHORT
            }

            OverlaySettings(
                selectedSymbols = symbols,
                symbolDisplayMode = mode,
                fontSizeSp = preferences[KEY_FONT_SIZE_SP] ?: 11f,
                textColorHex = preferences[KEY_TEXT_COLOR] ?: "#65D69A",
                textOpacity = preferences[KEY_TEXT_OPACITY] ?: 1.0f,
                backgroundColorHex = preferences[KEY_BACKGROUND_COLOR] ?: "#1E2024",
                backgroundOpacity = preferences[KEY_BACKGROUND_OPACITY] ?: 0.85f,
                paddingDp = preferences[KEY_PADDING_DP] ?: 2,
                show24hChange = preferences[KEY_SHOW_24H_CHANGE] ?: false,
                overlayX = preferences[KEY_OVERLAY_X] ?: -1,
                overlayY = preferences[KEY_OVERLAY_Y] ?: -1,
                isServiceEnabled = preferences[KEY_SERVICE_ENABLED] ?: false,
                isOverlayVisible = preferences[KEY_OVERLAY_VISIBLE] ?: true
            )
        }
        .stateIn(
            scope = scope,
            started = SharingStarted.Eagerly,
            initialValue = OverlaySettings()
        )

    suspend fun updateSelectedSymbols(symbols: List<String>) {
        val filtered = symbols.map { it.trim().uppercase() }.filter { it.isNotEmpty() }
        val finalSymbols = if (filtered.isEmpty()) listOf("BTCUSDT") else filtered
        context.dataStore.edit { preferences ->
            preferences[KEY_SELECTED_SYMBOLS] = finalSymbols.joinToString(",")
        }
    }

    suspend fun addSymbol(symbol: String) {
        val upper = symbol.trim().uppercase()
        val current = settingsFlow.value.selectedSymbols.toMutableList()
        if (!current.contains(upper)) {
            current.add(upper)
            updateSelectedSymbols(current)
        }
    }

    suspend fun removeSymbol(symbol: String) {
        val upper = symbol.trim().uppercase()
        val current = settingsFlow.value.selectedSymbols.toMutableList()
        // Requirements: keep at least 1 symbol
        if (current.size > 1 && current.contains(upper)) {
            current.remove(upper)
            updateSelectedSymbols(current)
        }
    }

    suspend fun reorderSymbol(fromIndex: Int, toIndex: Int) {
        val current = settingsFlow.value.selectedSymbols.toMutableList()
        if (fromIndex in current.indices && toIndex in current.indices && fromIndex != toIndex) {
            val item = current.removeAt(fromIndex)
            current.add(toIndex, item)
            updateSelectedSymbols(current)
        }
    }

    suspend fun moveSymbolUp(symbol: String) {
        val upper = symbol.trim().uppercase()
        val current = settingsFlow.value.selectedSymbols
        val index = current.indexOf(upper)
        if (index > 0) {
            reorderSymbol(index, index - 1)
        }
    }

    suspend fun moveSymbolDown(symbol: String) {
        val upper = symbol.trim().uppercase()
        val current = settingsFlow.value.selectedSymbols
        val index = current.indexOf(upper)
        if (index >= 0 && index < current.size - 1) {
            reorderSymbol(index, index + 1)
        }
    }

    suspend fun updateSymbolDisplayMode(mode: SymbolDisplayMode) {
        context.dataStore.edit { preferences ->
            preferences[KEY_SYMBOL_DISPLAY_MODE] = mode.name
        }
    }

    suspend fun updateFontSize(fontSizeSp: Float) {
        context.dataStore.edit { preferences ->
            preferences[KEY_FONT_SIZE_SP] = fontSizeSp
        }
    }

    suspend fun updateTextColor(colorHex: String) {
        context.dataStore.edit { preferences ->
            preferences[KEY_TEXT_COLOR] = colorHex
        }
    }

    suspend fun updateTextOpacity(opacity: Float) {
        context.dataStore.edit { preferences ->
            preferences[KEY_TEXT_OPACITY] = opacity
        }
    }

    suspend fun updateBackgroundColor(colorHex: String) {
        context.dataStore.edit { preferences ->
            preferences[KEY_BACKGROUND_COLOR] = colorHex
        }
    }

    suspend fun updateBackgroundOpacity(opacity: Float) {
        context.dataStore.edit { preferences ->
            preferences[KEY_BACKGROUND_OPACITY] = opacity
        }
    }

    suspend fun updatePadding(paddingDp: Int) {
        context.dataStore.edit { preferences ->
            preferences[KEY_PADDING_DP] = paddingDp
        }
    }

    suspend fun updateOverlayPosition(x: Int, y: Int) {
        context.dataStore.edit { preferences ->
            preferences[KEY_OVERLAY_X] = x
            preferences[KEY_OVERLAY_Y] = y
        }
    }

    suspend fun updateServiceEnabled(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[KEY_SERVICE_ENABLED] = enabled
        }
    }

    suspend fun updateOverlayVisible(visible: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[KEY_OVERLAY_VISIBLE] = visible
        }
    }
}
