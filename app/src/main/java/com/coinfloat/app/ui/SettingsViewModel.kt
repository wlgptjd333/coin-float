package com.coinfloat.app.ui

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.MarketDataRepository
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.overlay.FloatingOverlayService
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.SettingsRepository
import com.coinfloat.app.settings.SymbolDisplayMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(application: Application) : AndroidViewModel(application) {

    private val settingsRepository = SettingsRepository.getInstance(application)
    private val marketDataRepository = MarketDataRepository.getInstance()

    val settings: StateFlow<OverlaySettings> = settingsRepository.settingsFlow
    val isServiceActive: StateFlow<Boolean> = FloatingOverlayService.isServiceActive

    val connectionState: StateFlow<ConnectionState> = marketDataRepository.connectionState

    private val _hasOverlayPermission = MutableStateFlow(checkOverlayPermission())
    val hasOverlayPermission: StateFlow<Boolean> = _hasOverlayPermission.asStateFlow()

    private val _hasNotificationPermission = MutableStateFlow(checkNotificationPermission())
    val hasNotificationPermission: StateFlow<Boolean> = _hasNotificationPermission.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _searchResults = MutableStateFlow<List<SymbolInfo>>(emptyList())
    val searchResults: StateFlow<List<SymbolInfo>> = _searchResults.asStateFlow()

    val isLoadingSymbols: StateFlow<Boolean> = marketDataRepository.isLoadingSymbols

    private val _selectedTabIndex = MutableStateFlow(0)
    val selectedTabIndex: StateFlow<Int> = _selectedTabIndex.asStateFlow()

    private val _activeChartSymbol = MutableStateFlow("BTCUSDT")
    val activeChartSymbol: StateFlow<String> = _activeChartSymbol.asStateFlow()

    fun selectTab(index: Int) {
        _selectedTabIndex.value = index
    }

    fun selectChartSymbol(symbol: String) {
        _activeChartSymbol.value = symbol.uppercase()
    }

    fun refreshPermissions() {
        _hasOverlayPermission.value = checkOverlayPermission()
        _hasNotificationPermission.value = checkNotificationPermission()
    }

    private fun checkOverlayPermission(): Boolean {
        return Settings.canDrawOverlays(getApplication())
    }

    private fun checkNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                getApplication(),
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    fun startService() {
        val context: Context = getApplication()
        if (!checkOverlayPermission()) {
            android.widget.Toast.makeText(context, "다른 앱 위에 표시 권한을 먼저 허용해주세요.", android.widget.Toast.LENGTH_LONG).show()
            return
        }
        val intent = Intent(context, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        viewModelScope.launch {
            settingsRepository.updateServiceEnabled(true)
            settingsRepository.updateOverlayVisible(true)
        }
        android.widget.Toast.makeText(context, "CoinFloat 시세창을 시작합니다.", android.widget.Toast.LENGTH_SHORT).show()
    }

    fun stopService() {
        val context: Context = getApplication()
        val intent = Intent(context, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_STOP
        }
        context.startService(intent)
        viewModelScope.launch {
            settingsRepository.updateServiceEnabled(false)
        }
        android.widget.Toast.makeText(context, "CoinFloat 시세창을 종료했습니다.", android.widget.Toast.LENGTH_SHORT).show()
    }

    fun hideOverlay() {
        val context: Context = getApplication()
        val intent = Intent(context, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_HIDE
        }
        context.startService(intent)
        viewModelScope.launch {
            settingsRepository.updateOverlayVisible(false)
        }
        android.widget.Toast.makeText(context, "시세창을 숨겼습니다. (백그라운드 수신 유지)", android.widget.Toast.LENGTH_SHORT).show()
    }

    fun showOverlay() {
        val context: Context = getApplication()
        if (!checkOverlayPermission()) {
            android.widget.Toast.makeText(context, "다른 앱 위에 표시 권한을 먼저 허용해주세요.", android.widget.Toast.LENGTH_LONG).show()
            return
        }
        val intent = Intent(context, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_SHOW
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        viewModelScope.launch {
            settingsRepository.updateOverlayVisible(true)
        }
        android.widget.Toast.makeText(context, "시세창을 표시합니다.", android.widget.Toast.LENGTH_SHORT).show()
    }

    fun onSearchQueryChanged(query: String) {
        _searchQuery.value = query
        if (query.isBlank()) {
            _searchResults.value = emptyList()
        } else {
            _searchResults.value = marketDataRepository.searchSymbols(query)
        }
    }

    fun addSymbol(symbol: String) {
        viewModelScope.launch {
            settingsRepository.addSymbol(symbol)
            _searchQuery.value = ""
            _searchResults.value = emptyList()
        }
    }

    fun removeSymbol(symbol: String) {
        viewModelScope.launch {
            settingsRepository.removeSymbol(symbol)
        }
    }

    fun moveSymbolUp(symbol: String) {
        viewModelScope.launch {
            settingsRepository.moveSymbolUp(symbol)
        }
    }

    fun moveSymbolDown(symbol: String) {
        viewModelScope.launch {
            settingsRepository.moveSymbolDown(symbol)
        }
    }

    fun updateSymbolDisplayMode(mode: SymbolDisplayMode) {
        viewModelScope.launch {
            settingsRepository.updateSymbolDisplayMode(mode)
        }
    }

    fun updateFontSize(fontSizeSp: Float) {
        viewModelScope.launch {
            settingsRepository.updateFontSize(fontSizeSp)
        }
    }

    val marketPrices = marketDataRepository.marketPrices

    init {
        viewModelScope.launch {
            settings.collectLatest { s ->
                if (s.isServiceEnabled && !FloatingOverlayService.isServiceActive.value && checkOverlayPermission()) {
                    startService()
                }
            }
        }
    }

    fun updateTextColor(colorHex: String) {
        viewModelScope.launch {
            settingsRepository.updateTextColor(colorHex)
        }
    }

    fun updateTextOpacity(opacity: Float) {
        viewModelScope.launch {
            settingsRepository.updateTextOpacity(opacity)
        }
    }

    fun updateBackgroundColor(colorHex: String) {
        viewModelScope.launch {
            settingsRepository.updateBackgroundColor(colorHex)
        }
    }

    fun updateBackgroundOpacity(opacity: Float) {
        viewModelScope.launch {
            settingsRepository.updateBackgroundOpacity(opacity)
        }
    }

    fun updatePadding(paddingDp: Int) {
        viewModelScope.launch {
            settingsRepository.updatePadding(paddingDp)
        }
    }

    fun updateChartEnabled(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.updateChartEnabled(enabled)
        }
    }

    fun updateChartInterval(interval: String) {
        viewModelScope.launch {
            settingsRepository.updateChartInterval(interval)
        }
    }
}
