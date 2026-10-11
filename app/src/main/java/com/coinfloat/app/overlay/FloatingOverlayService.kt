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
        // Price refresh of the notification. Every post costs System UI ~30 ms of CPU (measured), plus every app that
        // listens to notifications. While the floating window is on screen it already shows the live price, so the
        // notification follows more slowly then.
        private const val NOTIFICATION_PRICE_MS = 2_000L
        private const val NOTIFICATION_PRICE_OVERLAY_MS = 10_000L

        private val _isServiceActive = MutableStateFlow(false)
        val isServiceActive: StateFlow<Boolean> = _isServiceActive.asStateFlow()
    }

    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private lateinit var settingsRepository: SettingsRepository
    private lateinit var marketDataRepository: MarketDataRepository
    private lateinit var overlayController: OverlayController
    private lateinit var notificationManager: NotificationManager

    private var priceUpdateJob: Job? = null
    private var lastSubscribedSymbols: List<String>? = null
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
                    // Behind the lock screen the overlay is invisible: keep the feed paused until the user unlocks.
                    val locked = isKeyguardLocked()
                    Log.d(TAG, "Screen ON detected (locked=$locked)")
                    overlayController.onScreenStateChanged(!locked)
                    feedScreenOn = !locked
                    syncFeed()
                }
                Intent.ACTION_USER_PRESENT -> {
                    Log.d(TAG, "Unlocked: resuming market data")
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
                marketDataRepository.fetchKlines(symbol, interval, limit = 80)
            }
            onChartStreamChanged = { symbol, interval -> marketDataRepository.setMiniChartStream(symbol, interval) }
            onMiniChartResizedListener = { wDp, hDp ->
                serviceScope.launch {
                    settingsRepository.updateCustomChartSize(wDp, hDp)
                }
            }
        }
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // The service can be (re)started while the screen is off; no screen event will arrive to tell us.
        feedScreenOn = (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isInteractive && !isKeyguardLocked()

        CoinFloatNotification.createNotificationChannel(this)

        val screenFilter = android.content.IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        registerReceiver(screenStateReceiver, screenFilter)
        registerNetworkCallback()

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

        // Live candles for the open mini chart
        serviceScope.launch {
            marketDataRepository.klineEvents.collect { overlayController.onKline(it) }
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

        // Without "display over other apps" nothing can be shown: a running service would only keep a "watching"
        // notification and the socket alive for nothing. Stop; the saved on/off state is kept, so the app brings the
        // window back by itself once the permission is granted again.
        if ((action == ACTION_START || action == ACTION_SHOW) && !android.provider.Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Overlay permission missing: not starting")
            stopWithoutForgetting()
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
            val state = marketDataRepository.connectionState.value
            val initialNotification = CoinFloatNotification.buildNotification(
                context = this,
                symbols = currentSettings.selectedSymbols,
                connectionState = state,
                isOverlayVisible = currentSettings.isOverlayVisible,
                content = CoinFloatNotification.content(
                    currentSettings.selectedSymbols, state, currentSettings.isOverlayVisible,
                    marketDataRepository.marketPrices.value, marketDataRepository.symbolInfoCache.value
                )
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
            // On a cold start DataStore may not have been read yet: starting from its placeholder defaults showed the
            // window at the default spot with BTC/ETH for a moment before it jumped to the saved place and coins.
            val saved = settingsRepository.awaitSettings()
            if (!isServiceRunning) return@launch
            settingsRepository.updateServiceEnabled(true)
            settingsRepository.updateOverlayVisible(true)
            val currentSettings = saved.copy(isServiceEnabled = true, isOverlayVisible = true)
            marketDataRepository.setFastTrades(currentSettings.refreshRateProfile == com.coinfloat.app.settings.RefreshRateProfile.FPS_10)

            updateNotification(marketDataRepository.connectionState.value)
            marketDataRepository.start(currentSettings.selectedSymbols)
            lastSubscribedSymbols = currentSettings.selectedSymbols
            feedRunning = true
            syncFeed()
            showOverlay(currentSettings)
            startPriceObserving()
        }
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

    /** Stops like [handleStop] but leaves "service enabled" as it is (used when the permission is missing). */
    private fun stopWithoutForgetting() {
        isServiceRunning = false
        _isServiceActive.value = false
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
        marketDataRepository.setFastTrades(settings.refreshRateProfile == com.coinfloat.app.settings.RefreshRateProfile.FPS_10)

        // Update WebSocket subscriptions only when the symbol list changes (not on every style tweak / slider tick)
        if (settings.selectedSymbols != lastSubscribedSymbols) {
            lastSubscribedSymbols = settings.selectedSymbols
            marketDataRepository.updateSymbols(settings.selectedSymbols)
        }

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
                    updateNotification(marketDataRepository.connectionState.value, priceOnly = true)
                    val refreshDelay = settingsRepository.settingsFlow.value.refreshRateProfile.intervalMs
                    delay(refreshDelay)
                }
        }
    }

    private data class NotificationKey(
        val symbols: List<String>,
        val state: ConnectionState,
        val overlayVisible: Boolean,
        val content: CoinFloatNotification.Content
    )

    private var lastNotificationKey: NotificationKey? = null
    private var lastNotifyAt = 0L
    private var pendingNotifyJob: Job? = null

    /**
     * The ongoing notification shows the coins' prices. Re-posting a notification is relatively expensive for the
     * system (the shade redraws, Android rate-limits updates), so price-only changes go out at most every
     * [NOTIFICATION_PRICE_MS] ([NOTIFICATION_PRICE_OVERLAY_MS] while the window is shown); state changes (connect / hide / coin list) go out at once. Nothing is re-posted when the
     * text did not change, and with the screen off the feed is paused, so prices do not change either.
     */
    private fun updateNotification(state: ConnectionState, priceOnly: Boolean = false) {
        if (!isServiceRunning) return
        val settings = settingsRepository.settingsFlow.value
        val content = CoinFloatNotification.content(
            settings.selectedSymbols, state, settings.isOverlayVisible,
            marketDataRepository.marketPrices.value, marketDataRepository.symbolInfoCache.value
        )
        val key = NotificationKey(settings.selectedSymbols, state, settings.isOverlayVisible, content)
        if (key == lastNotificationKey) return
        if (priceOnly) {
            val every = if (settings.isOverlayVisible) NOTIFICATION_PRICE_OVERLAY_MS else NOTIFICATION_PRICE_MS
            val wait = every - (System.currentTimeMillis() - lastNotifyAt)
            if (wait > 0) {
                // post the newest prices once the interval is over (unless something newer is posted first)
                if (pendingNotifyJob?.isActive != true) {
                    pendingNotifyJob = serviceScope.launch {
                        delay(wait)
                        updateNotification(marketDataRepository.connectionState.value, priceOnly = true)
                    }
                }
                return
            }
        }
        pendingNotifyJob?.cancel()
        lastNotificationKey = key
        lastNotifyAt = System.currentTimeMillis()
        val notification = CoinFloatNotification.buildNotification(
            context = this,
            symbols = settings.selectedSymbols,
            connectionState = state,
            isOverlayVisible = settings.isOverlayVisible,
            content = content
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
        networkCallback?.let { cb ->
            runCatching { (getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(cb) }
        }
        networkCallback = null
        overlayController.hide()
        marketDataRepository.setMiniChartStream(null, null)
        marketDataRepository.stop()
        priceUpdateJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }

    // Wi-Fi <-> mobile switches leave the old socket half-open until a ping times out (tens of seconds of frozen
    // prices). Reconnect as soon as a different network becomes the default one.
    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null
    private var currentNetwork: android.net.Network? = null

    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                val previous = currentNetwork
                currentNetwork = network
                if (previous != null && previous != network) {
                    Log.d(TAG, "Default network changed: reconnecting the market feed")
                    marketDataRepository.reconnectNow()
                }
            }
        }
        runCatching { cm.registerDefaultNetworkCallback(cb) }.onSuccess { networkCallback = cb }
    }

    private fun isKeyguardLocked(): Boolean =
        (getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager)?.isKeyguardLocked == true

    override fun onBind(intent: Intent?): IBinder? = null
}
