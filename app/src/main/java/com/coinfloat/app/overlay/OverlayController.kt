package com.coinfloat.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import com.coinfloat.app.MainActivity
import com.coinfloat.app.market.KlineItem
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.settings.OverlaySettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

class OverlayController(private val context: Context) {

    companion object {
        private const val TAG = "OverlayController"
    }

    private val windowManager: WindowManager =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())

    private var overlayView: OverlayView? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    // Mini Chart Window
    private var miniChartView: MiniChartView? = null
    private var miniChartParams: WindowManager.LayoutParams? = null
    @Volatile
    private var isMiniChartShowing = false
    private var currentChartSymbol: String = "BTCUSDT"
    private var currentChartInterval: String = "15m"
    private var chartRefreshJob: Job? = null
    private var chartLoadJob: Job? = null

    private var latestSettings: OverlaySettings = OverlaySettings()
    private var latestPriceMap: Map<String, MarketPrice> = emptyMap()
    private var latestSymbolInfoMap: Map<String, SymbolInfo> = emptyMap()

    var coroutineScope: CoroutineScope? = null
    var klineFetcher: (suspend (symbol: String, interval: String) -> List<KlineItem>)? = null

    private var isOverlayAttached = false
    private var isDragging = false
    private var onPositionSavedListener: ((Int, Int) -> Unit)? = null
    var onMiniChartResizedListener: ((Int, Int) -> Unit)? = null

    fun isShowing(): Boolean = (isOverlayAttached && overlayView != null) || (isMiniChartShowing && miniChartView != null)

    private fun runOnMainThread(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action()
        } else {
            mainHandler.post(action)
        }
    }

    private fun getRealScreenSize(): Pair<Int, Int> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            Pair(bounds.width(), bounds.height())
        } else {
            val realMetrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(realMetrics)
            Pair(realMetrics.widthPixels, realMetrics.heightPixels)
        }
    }

    private fun getSafePosition(settings: OverlaySettings): Pair<Int, Int> {
        val (screenWidth, screenHeight) = getRealScreenSize()
        val density = context.resources.displayMetrics.density

        val defaultX = (24 * density).toInt()
        val defaultY = (120 * density).toInt()

        // Never saved yet: use the default spot.
        if (settings.overlayX < 0 || settings.overlayY < 0) {
            return Pair(defaultX, defaultY)
        }

        // Saved on a differently sized/oriented screen: pull the box back inside the visible area
        // (without overwriting the saved spot, so it returns to it when the orientation flips back).
        val viewW = overlayView?.width?.takeIf { it > 0 } ?: (40 * density).toInt()
        val viewH = overlayView?.height?.takeIf { it > 0 } ?: (30 * density).toInt()
        val maxX = (screenWidth - viewW).coerceAtLeast(0)
        val maxY = (screenHeight - viewH).coerceAtLeast(0)
        return Pair(settings.overlayX.coerceIn(0, maxX), settings.overlayY.coerceIn(0, maxY))
    }

    /** Re-clamps the overlay after a rotation / display-size change. */
    fun onConfigurationChanged() {
        runOnMainThread {
            hideMiniChart() // its size and anchor were computed for the old screen
            if (!isOverlayAttached || overlayView == null) return@runOnMainThread
            val (posX, posY) = getSafePosition(latestSettings)
            updatePosition(posX, posY)
        }
    }

    private var isLive = true

    /** Dims the price box while the market feed is not connected so stale prices are not mistaken for live ones. */
    fun setLive(live: Boolean) {
        runOnMainThread {
            isLive = live
            overlayView?.setLive(live)
        }
    }

    fun show(
        settings: OverlaySettings,
        symbolInfoMap: Map<String, SymbolInfo>,
        prices: Map<String, MarketPrice>,
        onPositionChanged: (Int, Int) -> Unit
    ) {
        runOnMainThread {
            this.latestSettings = settings
            this.latestSymbolInfoMap = symbolInfoMap
            this.latestPriceMap = prices
            this.onPositionSavedListener = onPositionChanged
            val (posX, posY) = getSafePosition(settings)

            val currentView = overlayView
            if (isOverlayAttached && currentView != null) {
                currentView.applySettings(settings, symbolInfoMap)
                currentView.updatePrices(prices, symbolInfoMap)
                updatePosition(posX, posY)
                return@runOnMainThread
            }

            removeOverlayInternal()

            if (!Settings.canDrawOverlays(context)) {
                Log.e(TAG, "Cannot show overlay: SYSTEM_ALERT_WINDOW permission not granted")
                return@runOnMainThread
            }

            val view = OverlayView(context)
            view.applySettings(settings, symbolInfoMap)
            view.updatePrices(prices, symbolInfoMap)
            view.setLive(isLive)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.LEFT
                x = posX
                y = posY
            }

            setupDragListener(view, params)

            try {
                windowManager.addView(view, params)
                overlayView = view
                layoutParams = params
                isOverlayAttached = true
                Log.d(TAG, "Overlay view added successfully at (${params.x}, ${params.y})")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to add overlay view: ${e.message}", e)
                overlayView = null
                layoutParams = null
                isOverlayAttached = false
            }
        }
    }

    fun hide() {
        runOnMainThread {
            hideMiniChart()
            removeOverlayInternal()
        }
    }

    private fun removeOverlayInternal() {
        val view = overlayView
        if (view != null) {
            try {
                windowManager.removeView(view)
                Log.d(TAG, "Overlay view removed successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Error removing overlay view: ${e.message}", e)
            } finally {
                overlayView = null
                layoutParams = null
                isOverlayAttached = false
                isDragging = false
            }
        } else {
            isOverlayAttached = false
            isDragging = false
        }
    }

    fun updateSettings(settings: OverlaySettings, symbolInfoMap: Map<String, SymbolInfo>) {
        runOnMainThread {
            this.latestSettings = settings
            this.latestSymbolInfoMap = symbolInfoMap
            if (!isOverlayAttached || overlayView == null) return@runOnMainThread
            overlayView?.applySettings(settings, symbolInfoMap)
            val (posX, posY) = getSafePosition(settings)
            updatePosition(posX, posY)

            if (!settings.isChartEnabled && isMiniChartShowing) {
                hideMiniChart()
            } else if (isMiniChartShowing && miniChartView != null && miniChartParams != null) {
                miniChartView?.applyBackgroundStyle(settings.backgroundColorHex, settings.backgroundOpacity)
                val (wDp, hDp) = settings.getChartDimensionsDp()
                val density = context.resources.displayMetrics.density
                val targetW = (wDp * density).toInt()
                val targetH = (hDp * density).toInt()
                val p = miniChartParams!!
                if (p.width != targetW || p.height != targetH) {
                    p.width = targetW
                    p.height = targetH
                    try {
                        windowManager.updateViewLayout(miniChartView, p)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error updating mini chart layout on settings change: ${e.message}")
                    }
                }
            }
        }
    }

    fun updatePrices(prices: Map<String, MarketPrice>, symbolInfoMap: Map<String, SymbolInfo>) {
        runOnMainThread {
            this.latestPriceMap = prices
            this.latestSymbolInfoMap = symbolInfoMap
            if (isOverlayAttached && overlayView != null) {
                overlayView?.updatePrices(prices, symbolInfoMap)
            }

            if (isMiniChartShowing && miniChartView != null) {
                val marketPrice = prices[currentChartSymbol] ?: prices[currentChartSymbol.uppercase()]
                val info = symbolInfoMap[currentChartSymbol] ?: symbolInfoMap[currentChartSymbol.uppercase()]
                val formattedPrice = PriceFormatter.formatPrice(marketPrice?.price, info?.tickSize)
                val livePrice = marketPrice?.price?.toFloat()
                miniChartView?.updateHeader(currentChartSymbol, formattedPrice, livePrice)

                if (livePrice != null && livePrice > 0f) {
                    miniChartView?.updateLivePrice(livePrice)
                }
            }
        }
    }

    private fun updatePosition(x: Int, y: Int) {
        if (isDragging) return
        val params = layoutParams ?: return
        val view = overlayView ?: return
        if (params.x != x || params.y != y) {
            params.x = x
            params.y = y
            try {
                windowManager.updateViewLayout(view, params)
            } catch (e: Exception) {
                Log.e(TAG, "Error updating overlay layout params: ${e.message}")
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupDragListener(view: OverlayView, params: WindowManager.LayoutParams) {
        val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var downTime = 0L

        val dm = context.resources.displayMetrics
        val density = dm.density

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    downTime = System.currentTimeMillis()
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()

                    if (isDragging || abs(dx) > touchSlop || abs(dy) > touchSlop) {
                        if (!isDragging) {
                            isDragging = true
                            if (isMiniChartShowing) {
                                hideMiniChart()
                            }
                        }
                        val (screenWidth, screenHeight) = getRealScreenSize()
                        val viewW = if (view.width > 0) view.width else (40 * density).toInt()
                        val viewH = if (view.height > 0) view.height else (30 * density).toInt()
                        val maxSafeX = (screenWidth - viewW).coerceAtLeast(0)
                        val maxSafeY = (screenHeight - viewH).coerceAtLeast(0)

                        params.x = (initialX + dx).coerceIn(0, maxSafeX)
                        params.y = (initialY + dy).coerceIn(0, maxSafeY)
                        try {
                            windowManager.updateViewLayout(view, params)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error updating position on drag: ${e.message}")
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (isDragging) {
                        isDragging = false
                        onPositionSavedListener?.invoke(params.x, params.y)
                    } else {
                        val duration = System.currentTimeMillis() - downTime
                        if (duration < 350) {
                            handleOverlayClick()
                        }
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    isDragging = false
                    true
                }
                else -> false
            }
        }
    }

    private fun handleOverlayClick() {
        if (!latestSettings.isChartEnabled) return
        if (isMiniChartShowing) {
            hideMiniChart()
        } else {
            val firstSymbol = latestSettings.selectedSymbols.firstOrNull() ?: "BTCUSDT"
            currentChartSymbol = firstSymbol
            currentChartInterval = latestSettings.defaultChartInterval
            showMiniChart()
        }
    }

    fun showMiniChart() {
        runOnMainThread {
            if (isMiniChartShowing) return@runOnMainThread
            if (!Settings.canDrawOverlays(context)) return@runOnMainThread

            val baseParams = layoutParams ?: return@runOnMainThread
            val density = context.resources.displayMetrics.density
            val (wDp, hDp) = latestSettings.getChartDimensionsDp()
            val chartWidth = (wDp * density).toInt()
            val chartHeight = (hDp * density).toInt()
            val (screenWidth, screenHeight) = getRealScreenSize()

            var chartX = baseParams.x
            if (chartX + chartWidth > screenWidth - (8 * density).toInt()) {
                chartX = screenWidth - chartWidth - (8 * density).toInt()
            }
            chartX = chartX.coerceAtLeast((8 * density).toInt())

            val overlayH = if ((overlayView?.height ?: 0) > 0) overlayView!!.height else (35 * density).toInt()
            var chartY = baseParams.y + overlayH + (6 * density).toInt()
            if (chartY + chartHeight > screenHeight - (16 * density).toInt()) {
                chartY = (baseParams.y - chartHeight - (6 * density).toInt()).coerceAtLeast((8 * density).toInt())
            }

            val params = WindowManager.LayoutParams(
                chartWidth,
                chartHeight,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.LEFT
                x = chartX
                y = chartY
            }

            val view = MiniChartView(
                context = context,
                onIntervalSelected = { interval ->
                    currentChartInterval = interval
                    loadChartData()
                },
                onSymbolToggleClicked = {
                    val symbols = latestSettings.selectedSymbols
                    if (symbols.isNotEmpty()) {
                        val currentIdx = symbols.indexOf(currentChartSymbol)
                        val nextIdx = (currentIdx + 1) % symbols.size
                        currentChartSymbol = symbols[nextIdx]
                        loadChartData()
                    }
                },
                onExpandClicked = {
                    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                        putExtra(MainActivity.EXTRA_TARGET_TAB, 1)
                        putExtra(MainActivity.EXTRA_TARGET_SYMBOL, currentChartSymbol)
                        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    }
                    if (intent != null) {
                        context.startActivity(intent)
                        hideMiniChart()
                    }
                },
                onCloseClicked = {
                    hideMiniChart()
                }
            )
            view.setActiveInterval(currentChartInterval)
            view.applyBackgroundStyle(latestSettings.backgroundColorHex, latestSettings.backgroundOpacity)

            // Setup moving window via header drag
            var startMoveX = 0
            var startMoveY = 0
            view.onMoveStart = {
                startMoveX = miniChartParams?.x ?: params.x
                startMoveY = miniChartParams?.y ?: params.y
            }
            view.onMoveDelta = { dx, dy ->
                val p = miniChartParams
                if (p != null) {
                    val (sW, sH) = getRealScreenSize()
                    val maxSafeX = (sW - p.width).coerceAtLeast(0)
                    val maxSafeY = (sH - p.height).coerceAtLeast(0)
                    p.x = (startMoveX + dx).coerceIn(0, maxSafeX)
                    p.y = (startMoveY + dy).coerceIn(0, maxSafeY)
                    try {
                        windowManager.updateViewLayout(view, p)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error moving mini chart: ${e.message}")
                    }
                }
            }

            // Setup resizing window via bottom-right grip drag
            var startResizeW = 0
            var startResizeH = 0
            view.onResizeStart = {
                startResizeW = miniChartParams?.width ?: params.width
                startResizeH = miniChartParams?.height ?: params.height
            }
            view.onResizeDelta = { dx, dy ->
                val p = miniChartParams
                if (p != null) {
                    val (sW, sH) = getRealScreenSize()
                    val minW = (160 * density).toInt()
                    val maxW = (sW - (16 * density).toInt()).coerceAtLeast(minW)
                    val minH = (110 * density).toInt()
                    val maxH = (sH - (32 * density).toInt()).coerceAtLeast(minH)

                    val newW = (startResizeW + dx).coerceIn(minW, maxW)
                    val newH = (startResizeH + dy).coerceIn(minH, maxH)

                    if (p.x + newW > sW - (8 * density).toInt()) {
                        p.x = (sW - (8 * density).toInt() - newW).coerceAtLeast((8 * density).toInt())
                    }
                    if (p.y + newH > sH - (16 * density).toInt()) {
                        p.y = (sH - (16 * density).toInt() - newH).coerceAtLeast((8 * density).toInt())
                    }

                    p.width = newW
                    p.height = newH
                    try {
                        windowManager.updateViewLayout(view, p)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error resizing mini chart: ${e.message}")
                    }
                }
            }
            view.onResizeEnd = {
                val p = miniChartParams
                if (p != null) {
                    val finalWidthDp = ((p.width / density) + 0.5f).toInt()
                    val finalHeightDp = ((p.height / density) + 0.5f).toInt()
                    onMiniChartResizedListener?.invoke(finalWidthDp, finalHeightDp)
                }
            }

            try {
                windowManager.addView(view, params)
                miniChartView = view
                miniChartParams = params
                isMiniChartShowing = true
                loadChartData()
                startChartRefreshLoop()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to add mini chart view: ${e.message}", e)
                miniChartView = null
                miniChartParams = null
                isMiniChartShowing = false
                stopChartRefreshLoop()
            }
        }
    }

    fun hideMiniChart() {
        runOnMainThread {
            chartLoadJob?.cancel()
            chartLoadJob = null
            stopChartRefreshLoop()
            val chart = miniChartView
            if (chart != null) {
                try {
                    windowManager.removeView(chart)
                } catch (e: Exception) {
                    Log.e(TAG, "Error removing mini chart view: ${e.message}")
                } finally {
                    miniChartView = null
                    miniChartParams = null
                    isMiniChartShowing = false
                }
            } else {
                isMiniChartShowing = false
            }
        }
    }

    private fun loadChartData() {
        val chart = miniChartView ?: return
        val marketPrice = latestPriceMap[currentChartSymbol] ?: latestPriceMap[currentChartSymbol.uppercase()]
        val info = latestSymbolInfoMap[currentChartSymbol] ?: latestSymbolInfoMap[currentChartSymbol.uppercase()]
        val formattedPrice = PriceFormatter.formatPrice(marketPrice?.price, info?.tickSize)
        val livePrice = marketPrice?.price?.toFloat()
        chart.updateHeader(currentChartSymbol, formattedPrice, livePrice)
        chart.setChartLoading()

        // A newer request (user switched symbol/interval) supersedes this one: cancel it and, as
        // a safety net for responses already in flight, drop any result that no longer matches.
        chartLoadJob?.cancel()
        val symbol = currentChartSymbol
        val interval = currentChartInterval
        chartLoadJob = coroutineScope?.launch(Dispatchers.IO) {
            try {
                val klines = klineFetcher?.invoke(symbol, interval) ?: emptyList()
                mainHandler.post {
                    if (symbol != currentChartSymbol || interval != currentChartInterval) return@post
                    miniChartView?.setChartData(klines)
                    val currentPrice = latestPriceMap[symbol] ?: latestPriceMap[symbol.uppercase()]
                    val latestLivePrice = currentPrice?.price?.toFloat()
                    if (latestLivePrice != null && latestLivePrice > 0f) {
                        miniChartView?.updateLivePrice(latestLivePrice)
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load klines: ${e.message}")
                mainHandler.post {
                    if (symbol != currentChartSymbol || interval != currentChartInterval) return@post
                    miniChartView?.setChartError("차트 로드 실패")
                }
            }
        }
    }

    @Volatile
    private var isScreenOn = true

    fun onScreenStateChanged(screenOn: Boolean) {
        runOnMainThread {
            isScreenOn = screenOn
            if (!screenOn) {
                stopChartRefreshLoop()
            } else {
                if (isMiniChartShowing) {
                    loadChartData()
                    startChartRefreshLoop()
                }
            }
        }
    }

    private fun startChartRefreshLoop() {
        chartRefreshJob?.cancel()
        chartRefreshJob = coroutineScope?.launch(Dispatchers.IO) {
            while (isMiniChartShowing && isScreenOn) {
                delay(15_000L)
                if (!isMiniChartShowing || !isScreenOn) break
                try {
                    val symbol = currentChartSymbol
                    val interval = currentChartInterval
                    val klines = klineFetcher?.invoke(symbol, interval) ?: emptyList()
                    if (klines.isNotEmpty()) {
                        mainHandler.post {
                            if (isMiniChartShowing && isScreenOn &&
                                symbol == currentChartSymbol && interval == currentChartInterval
                            ) {
                                miniChartView?.setChartData(klines)
                                val currentPrice = latestPriceMap[symbol] ?: latestPriceMap[symbol.uppercase()]
                                val livePrice = currentPrice?.price?.toFloat()
                                if (livePrice != null && livePrice > 0f) {
                                    miniChartView?.updateLivePrice(livePrice)
                                }
                            }
                        }
                    }
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {}
            }
        }
    }

    private fun stopChartRefreshLoop() {
        chartRefreshJob?.cancel()
        chartRefreshJob = null
    }
}
