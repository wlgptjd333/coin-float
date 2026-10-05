package com.coinfloat.app.overlay

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.MarketDataRepository
import com.coinfloat.app.notification.CoinFloatNotification
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch

class FloatingOverlayService : Service() {

    companion object {
        private const val TAG = "FloatingOverlayService"

        const val ACTION_START = "com.coinfloat.app.action.START"
        const val ACTION_STOP = "com.coinfloat.app.action.STOP"
        const val ACTION_HIDE = "com.coinfloat.app.action.HIDE"
        const val ACTION_SHOW = "com.coinfloat.app.action.SHOW"

        private val _isServiceActive = MutableStateFlow(false)
        val isServiceActive: StateFlow<Boolean> = _isServiceActive.asStateFlow()
    }

    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private lateinit var settingsRepository: SettingsRepository
    private lateinit var marketDataRepository: MarketDataRepository
    private lateinit var overlayController: OverlayController
    private lateinit var notificationManager: NotificationManager

    private var priceUpdateJob: Job? = null
    private var isServiceRunning = false

    private val screenStateReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    Log.d(TAG, "Screen OFF detected: pausing market data to conserve battery")
                    marketDataRepository.pause()
                    overlayController.onScreenStateChanged(false)
                }
                Intent.ACTION_SCREEN_ON -> {
                    Log.d(TAG, "Screen ON detected: resuming market data")
                    overlayController.onScreenStateChanged(true)
                    if (isServiceRunning && settingsRepository.settingsFlow.value.isOverlayVisible) {
                        marketDataRepository.resume()
                    }
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "FloatingOverlayService onCreate")

        settingsRepository = SettingsRepository.getInstance(this)
        marketDataRepository = MarketDataRepository.getInstance()
        overlayController = OverlayController(this).apply {
            coroutineScope = serviceScope
            klineFetcher = { symbol, interval ->
                marketDataRepository.fetchKlines(symbol, interval, limit = 30)
            }
            onMiniChartResizedListener = { wDp, hDp ->
                serviceScope.launch {
                    settingsRepository.updateCustomChartSize(wDp, hDp)
                }
            }
        }
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        CoinFloatNotification.createNotificationChannel(this)

        val screenFilter = android.content.IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        }
        registerReceiver(screenStateReceiver, screenFilter)

        // Observe settings changes
        serviceScope.launch {
            settingsRepository.settingsFlow.collectLatest { settings ->
                handleSettingsChanged(settings)
            }
        }

        // Observe connection state to update notification
        serviceScope.launch {
            marketDataRepository.connectionState.collectLatest { state ->
                updateNotification(state)
            }
        }

        // Preload exchangeInfo in background
        serviceScope.launch(Dispatchers.IO) {
            marketDataRepository.loadExchangeInfoIfNeeded()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        Log.d(TAG, "onStartCommand with action: $action")

        when (action) {
            ACTION_START -> handleStart()
            ACTION_HIDE -> handleHide()
            ACTION_SHOW -> handleShow()
            ACTION_STOP -> handleStop()
        }

        return START_STICKY
    }

    private fun handleStart() {
        Log.d(TAG, "handleStart: starting foreground service and overlay")
        isServiceRunning = true
        _isServiceActive.value = true

        serviceScope.launch {
            settingsRepository.updateServiceEnabled(true)
            settingsRepository.updateOverlayVisible(true)
        }

        val currentSettings = settingsRepository.settingsFlow.value.copy(
            isServiceEnabled = true,
            isOverlayVisible = true
        )
        val initialNotification = CoinFloatNotification.buildNotification(
            context = this,
            symbols = currentSettings.selectedSymbols,
            connectionState = marketDataRepository.connectionState.value,
            isOverlayVisible = true
        )

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(
                        CoinFloatNotification.NOTIFICATION_ID,
                        initialNotification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    )
                } else {
                    startForeground(CoinFloatNotification.NOTIFICATION_ID, initialNotification)
                }
            } else {
                startForeground(CoinFloatNotification.NOTIFICATION_ID, initialNotification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to startForeground: ${e.message}", e)
        }

        marketDataRepository.start(currentSettings.selectedSymbols)
        showOverlay(currentSettings)
        startPriceObserving()
    }

    private fun handleHide() {
        Log.d(TAG, "Hiding overlay view, keeping service and WebSocket running")
        overlayController.hide()
        serviceScope.launch {
            settingsRepository.updateOverlayVisible(false)
        }
        updateNotification(marketDataRepository.connectionState.value)
    }

    private fun handleShow() {
        Log.d(TAG, "Showing overlay view with latest prices")
        if (!isServiceRunning) {
            handleStart()
            return
        }
        serviceScope.launch {
            settingsRepository.updateOverlayVisible(true)
        }
        val currentSettings = settingsRepository.settingsFlow.value.copy(isOverlayVisible = true)
        showOverlay(currentSettings)
        updateNotification(marketDataRepository.connectionState.value)
    }

    private fun handleStop() {
        Log.d(TAG, "Stopping service and shutting down WebSocket connection")
        isServiceRunning = false
        _isServiceActive.value = false
        serviceScope.launch {
            settingsRepository.updateServiceEnabled(false)
        }
        overlayController.hide()
        marketDataRepository.stop()
        priceUpdateJob?.cancel()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    private fun showOverlay(settings: OverlaySettings) {
        overlayController.show(
            settings = settings,
            symbolInfoMap = marketDataRepository.symbolInfoCache.value,
            prices = marketDataRepository.marketPrices.value,
            onPositionChanged = { newX, newY ->
                serviceScope.launch {
                    settingsRepository.updateOverlayPosition(newX, newY)
                }
            }
        )
    }

    private fun handleSettingsChanged(settings: OverlaySettings) {
        if (!isServiceRunning) return

        // Update WebSocket subscriptions when symbol list changes
        marketDataRepository.updateSymbols(settings.selectedSymbols)

        // Update overlay view with new styling/symbols
        if (settings.isOverlayVisible) {
            if (!overlayController.isShowing()) {
                showOverlay(settings)
            } else {
                overlayController.updateSettings(
                    settings = settings,
                    symbolInfoMap = marketDataRepository.symbolInfoCache.value
                )
            }
        } else {
            overlayController.hide()
        }

        updateNotification(marketDataRepository.connectionState.value)
    }

    private fun startPriceObserving() {
        priceUpdateJob?.cancel()
        priceUpdateJob = serviceScope.launch {
            // Throttled UI rendering loop (~150ms):
            // StateFlow already conflates intermediate values during delay(150L).
            // Caps redraw rate to ~6.7 FPS, saving ~75% CPU and conserving battery.
            marketDataRepository.marketPrices
                .collect { prices ->
                    if (overlayController.isShowing()) {
                        overlayController.updatePrices(
                            prices = prices,
                            symbolInfoMap = marketDataRepository.symbolInfoCache.value
                        )
                    }
                    delay(150L)
                }
        }
    }

    private fun updateNotification(state: ConnectionState) {
        if (!isServiceRunning) return
        val settings = settingsRepository.settingsFlow.value
        val notification = CoinFloatNotification.buildNotification(
            context = this,
            symbols = settings.selectedSymbols,
            connectionState = state,
            isOverlayVisible = settings.isOverlayVisible
        )
        notificationManager.notify(CoinFloatNotification.NOTIFICATION_ID, notification)
    }

    override fun onDestroy() {
        Log.d(TAG, "FloatingOverlayService onDestroy")
        isServiceRunning = false
        _isServiceActive.value = false
        try {
            unregisterReceiver(screenStateReceiver)
        } catch (_: Exception) {}
        overlayController.hide()
        marketDataRepository.stop()
        priceUpdateJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
