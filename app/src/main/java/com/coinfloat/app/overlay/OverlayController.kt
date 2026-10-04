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
import com.coinfloat.app.market.KlineItem
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.settings.OverlaySettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
    private var isMiniChartShowing = false
    private var currentChartSymbol: String = "BTCUSDT"
    private var currentChartInterval: String = "15m"

    private var latestSettings: OverlaySettings = OverlaySettings()
    private var latestPriceMap: Map<String, MarketPrice> = emptyMap()
    private var latestSymbolInfoMap: Map<String, SymbolInfo> = emptyMap()

    var coroutineScope: CoroutineScope? = null
    var klineFetcher: (suspend (symbol: String, interval: String) -> List<KlineItem>)? = null

    private var isOverlayAttached = false
    private var isDragging = false
    private var onPositionSavedListener: ((Int, Int) -> Unit)? = null

    fun isShowing(): Boolean = isOverlayAttached && overlayView != null

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

        val posX = if (settings.overlayX < 0 || settings.overlayX > screenWidth - 10) {
            defaultX
        } else {
            settings.overlayX
        }

        val posY = if (settings.overlayY < 0 || settings.overlayY > screenHeight - 10) {
            defaultY
        } else {
            settings.overlayY
        }
        return Pair(posX, posY)
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
            }
        }
    }

    fun updatePrices(prices: Map<String, MarketPrice>, symbolInfoMap: Map<String, SymbolInfo>) {
        runOnMainThread {
            this.latestPriceMap = prices
            this.latestSymbolInfoMap = symbolInfoMap
            if (!isOverlayAttached || overlayView == null) return@runOnMainThread
            overlayView?.updatePrices(prices, symbolInfoMap)

            if (isMiniChartShowing && miniChartView != null) {
                val marketPrice = prices[currentChartSymbol] ?: prices[currentChartSymbol.uppercase()]
                val info = symbolInfoMap[currentChartSymbol] ?: symbolInfoMap[currentChartSymbol.uppercase()]
                val formattedPrice = PriceFormatter.formatPrice(marketPrice?.price, info?.tickSize)
                miniChartView?.updateHeader(currentChartSymbol, formattedPrice)
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
            val chartWidth = (240 * density).toInt()
            val chartHeight = (155 * density).toInt()
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
                WindowManager.LayoutParams.WRAP_CONTENT,
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
                        putExtra("TARGET_TAB", 1)
                        putExtra("TARGET_SYMBOL", currentChartSymbol)
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

            try {
                windowManager.addView(view, params)
                miniChartView = view
                miniChartParams = params
                isMiniChartShowing = true
                loadChartData()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to add mini chart view: ${e.message}", e)
                miniChartView = null
                miniChartParams = null
                isMiniChartShowing = false
            }
        }
    }

    fun hideMiniChart() {
        runOnMainThread {
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
        chart.updateHeader(currentChartSymbol, formattedPrice)
        chart.setChartLoading()

        coroutineScope?.launch(Dispatchers.IO) {
            try {
                val klines = klineFetcher?.invoke(currentChartSymbol, currentChartInterval) ?: emptyList()
                mainHandler.post {
                    miniChartView?.setChartData(klines)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load klines: ${e.message}")
                mainHandler.post {
                    miniChartView?.setChartError("차트 로드 실패")
                }
            }
        }
    }
}
