package com.coinfloat.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.settings.OverlaySettings
import android.os.Build
import android.provider.Settings
import android.util.DisplayMetrics
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
            this.onPositionSavedListener = onPositionChanged
            val (posX, posY) = getSafePosition(settings)

            val currentView = overlayView
            if (isOverlayAttached && currentView != null) {
                currentView.applySettings(settings, symbolInfoMap)
                currentView.updatePrices(prices, symbolInfoMap)
                updatePosition(posX, posY)
                return@runOnMainThread
            }

            // Synchronously remove any previous view to avoid posting delayed removal
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
            if (!isOverlayAttached || overlayView == null) return@runOnMainThread
            overlayView?.applySettings(settings, symbolInfoMap)
            val (posX, posY) = getSafePosition(settings)
            updatePosition(posX, posY)
        }
    }

    fun updatePrices(prices: Map<String, MarketPrice>, symbolInfoMap: Map<String, SymbolInfo>) {
        runOnMainThread {
            if (!isOverlayAttached || overlayView == null) return@runOnMainThread
            overlayView?.updatePrices(prices, symbolInfoMap)
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

        val dm = context.resources.displayMetrics
        val density = dm.density

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()

                    if (isDragging || abs(dx) > touchSlop || abs(dy) > touchSlop) {
                        isDragging = true
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
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (isDragging) {
                        isDragging = false
                        onPositionSavedListener?.invoke(params.x, params.y)
                    }
                    true
                }
                else -> false
            }
        }
    }
}
