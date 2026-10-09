package com.coinfloat.app.overlay

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
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

    // The market feed only has a consumer while the screen is on AND the overlay is visible. Keeping the socket
    // open for a hidden or screen-off overlay only burns radio and battery; resuming takes a few hundred ms.
    private var feedScreenOn = true
    private var feedOverlayVisible = true
    private var feedRunning: Boolean? = null

    private fun syncFeed() {
        if (!isServiceRunning) return
        val shouldRun = feedScreenOn && feedOverlayVisible
        if (shouldRun == feedRunning) return
        feedRunning = shouldRun
        if (shouldRun) marketDataRepository.resume() else marketDataRepository.pause()
    }

    private val screenStateReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    Log.d(TAG, "Screen OFF detected: pausing market data to conserve battery")
                    feedScreenOn = false
                    syncFeed()
                    overlayController.onScreenStateChanged(false)
                }
                Intent.ACTION_SCREEN_ON -> {
                    Log.d(TAG, "Screen ON detected: resuming market data")
                    overlayController.onScreenStateChanged(true)
                    feedScreenOn = true
                    syncFeed()
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
        // The service can be (re)started while the screen is off; no screen event will arrive to tell us.
        feedScreenOn = (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isInteractive

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

        // Observe connection state to update notification and dim the overlay while the feed is down
        serviceScope.launch {
            marketDataRepository.connectionState.collectLatest { state ->
                overlayController.setLive(state == ConnectionState.CONNECTED)
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

        if (action == ACTION_STOP) {
            handleStop()
            return START_NOT_STICKY
        }

        // A stale "hide" (e.g. from an old notification) must not leave a foreground service running
        // with nothing to show.
        if (action == ACTION_HIDE && !isServiceRunning) {
            stopSelf()
            return START_NOT_STICKY
        }

        // CRITICAL FIX: Ensure startForeground() is called immediately (within <5ms)
        // to satisfy Android's 5.0-second startForegroundService() contract and prevent
        // ForegroundServiceDidNotStartInTimeException / OS crash loop.
        val promoted = ensureForegroundNotification()
        if (!promoted) {
            Log.e(TAG, "Failed to promote to foreground service. Stopping immediately to avoid OS crash.")
            handleStop()
            return START_NOT_STICKY
        }

        when (action) {
            ACTION_START -> handleStart()
            ACTION_HIDE -> handleHide()
            ACTION_SHOW -> handleShow()
        }

        return START_NOT_STICKY
    }

    private fun ensureForegroundNotification(): Boolean {
        return try {
            val currentSettings = settingsRepository.settingsFlow.value
            val initialNotification = CoinFloatNotification.buildNotification(
                context = this,
                symbols = currentSettings.selectedSymbols,
                connectionState = marketDataRepository.connectionState.value,
                isOverlayVisible = currentSettings.isOverlayVisible
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    CoinFloatNotification.NOTIFICATION_ID,
                    initialNotification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(CoinFloatNotification.NOTIFICATION_ID, initialNotification)
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to startForeground: ${e.message}", e)
            false
        }
    }

    private fun handleStart() {
        Log.d(TAG, "handleStart: starting foreground service and overlay")
        isServiceRunning = true
        _isServiceActive.value = true
        feedOverlayVisible = true
        feedRunning = null

        serviceScope.launch {
            settingsRepository.updateServiceEnabled(true)
            settingsRepository.updateOverlayVisible(true)
        }

        val currentSettings = settingsRepository.settingsFlow.value.copy(
            isServiceEnabled = true,
            isOverlayVisible = true
        )

        updateNotification(marketDataRepository.connectionState.value)
        marketDataRepository.start(currentSettings.selectedSymbols)
        feedRunning = true
        syncFeed()
        showOverlay(currentSettings)
        startPriceObserving()
    }

    private fun handleHide() {
        Log.d(TAG, "Hiding overlay view, pausing the market feed")
        overlayController.hide()
        feedOverlayVisible = false
        syncFeed()
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
        feedOverlayVisible = true
        syncFeed()
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
                    val refreshDelay = settingsRepository.settingsFlow.value.refreshRateProfile.intervalMs
                    delay(refreshDelay)
                }
        }
    }

    private data class NotificationKey(
        val symbols: List<String>,
        val state: ConnectionState,
        val overlayVisible: Boolean
    )

    private var lastNotificationKey: NotificationKey? = null

    private fun updateNotification(state: ConnectionState) {
        if (!isServiceRunning) return
        val settings = settingsRepository.settingsFlow.value
        // Settings change many times per second while a slider is dragged; only re-post the
        // notification when something it shows actually changed.
        val key = NotificationKey(settings.selectedSymbols, state, settings.isOverlayVisible)
        if (key == lastNotificationKey) return
        lastNotificationKey = key
        val notification = CoinFloatNotification.buildNotification(
            context = this,
            symbols = settings.selectedSymbols,
            connectionState = state,
            isOverlayVisible = settings.isOverlayVisible
        )
        notificationManager.notify(CoinFloatNotification.NOTIFICATION_ID, notification)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        overlayController.onConfigurationChanged()
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
