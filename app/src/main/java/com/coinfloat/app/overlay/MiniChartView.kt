package com.coinfloat.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import com.coinfloat.app.market.KlineItem
import kotlin.math.abs

@SuppressLint("ViewConstructor")
class MiniChartView(
    context: Context,
    private val onIntervalSelected: (String) -> Unit,
    private val onSymbolToggleClicked: () -> Unit,
    private val onExpandClicked: () -> Unit,
    private val onCloseClicked: () -> Unit
) : FrameLayout(context) {

    private val density = resources.displayMetrics.density
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    private val tvSymbol: TextView
    private val tvPrice: TextView
    private val scrollContainer: HorizontalScrollView
    private val intervalButtons = mutableMapOf<String, TextView>()
    private val chartView: CandleStickChartView
    val resizeGripView: TextView

    private var currentInterval = "15m"

    // Moving window callbacks
    var onMoveStart: (() -> Unit)? = null
    var onMoveDelta: ((dx: Int, dy: Int) -> Unit)? = null
    var onMoveEnd: (() -> Unit)? = null

    // Resizing window callbacks
    var onResizeStart: (() -> Unit)? = null
    var onResizeDelta: ((dx: Int, dy: Int) -> Unit)? = null
    var onResizeEnd: (() -> Unit)? = null

    init {
        // Rounded semi-transparent container background
        val cornerPx = 8f * density
        val bgDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = cornerPx
            setColor(Color.argb(240, 0x1E, 0x20, 0x24)) // 94% dark slate
            setStroke((1 * density).toInt().coerceAtLeast(1), Color.argb(180, 0x43, 0x4A, 0x54))
        }
        background = bgDrawable

        // Main content vertical container
        val contentLayout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            clipToPadding = true
            val padH = (10 * density).toInt()
            val padV = (8 * density).toInt()
            setPadding(padH, padV, padH, padV)
        }

        // 1. Top Header Row: Symbol, Price, Interval Tabs, Close Button
        val headerLayout = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (4 * density).toInt()
            }
        }

        // Symbol & Price container (Can be dragged to move window OR tapped to cycle symbols)
        val symbolContainer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setPadding(0, 0, (6 * density).toInt(), 0)
        }

        tvSymbol = TextView(context).apply {
            textSize = 12f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            text = "BTCUSDT"
        }

        tvPrice = TextView(context).apply {
            textSize = 10f
            setTextColor(Color.parseColor("#65D69A"))
            typeface = Typeface.MONOSPACE
            text = "—"
        }

        symbolContainer.addView(tvSymbol)
        symbolContainer.addView(tvPrice)

        setupMoveOrClickTouch(symbolContainer, onClick = { onSymbolToggleClicked() })
        headerLayout.addView(symbolContainer)

        // Interval Tabs inside HorizontalScrollView: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d
        val intervals = listOf("1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d")
        scrollContainer = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = (4 * density).toInt()
            }
        }

        val tabsLayout = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        for (interval in intervals) {
            val btn = TextView(context).apply {
                text = interval
                textSize = 9f
                setPadding(
                    (5 * density).toInt(),
                    (2 * density).toInt(),
                    (5 * density).toInt(),
                    (2 * density).toInt()
                )
                gravity = Gravity.CENTER
                setOnClickListener {
                    setActiveInterval(interval)
                    onIntervalSelected(interval)
                }
            }
            intervalButtons[interval] = btn
            tabsLayout.addView(btn)
        }
        scrollContainer.addView(tabsLayout)
        updateTabStyles()
        headerLayout.addView(scrollContainer)

        // Expand button (⛶)
        val btnExpand = TextView(context).apply {
            text = "⛶"
            textSize = 13f
            setTextColor(Color.parseColor("#848E9C"))
            gravity = Gravity.CENTER
            setPadding((5 * density).toInt(), 0, (5 * density).toInt(), 0)
            setOnClickListener { onExpandClicked() }
        }
        headerLayout.addView(btnExpand)

        // Close button (✕)
        val btnClose = TextView(context).apply {
            text = "✕"
            textSize = 13f
            setTextColor(Color.parseColor("#848E9C"))
            gravity = Gravity.CENTER
            setPadding((5 * density).toInt(), 0, (2 * density).toInt(), 0)
            setOnClickListener { onCloseClicked() }
        }
        headerLayout.addView(btnClose)

        contentLayout.addView(headerLayout)

        // 2. Candlestick Canvas View (Expands to fill remaining height)
        chartView = CandleStickChartView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }
        contentLayout.addView(chartView)

        addView(
            contentLayout,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        )

        // 3. Touch Resize Grip Handle in bottom-right corner
        val gripSize = (34 * density).toInt()
        resizeGripView = TextView(context).apply {
            text = "⇲"
            textSize = 13f
            setTextColor(Color.argb(160, 240, 185, 11)) // Binance Gold accent
            gravity = Gravity.BOTTOM or Gravity.END
            setPadding(0, 0, (4 * density).toInt(), (2 * density).toInt())
        }

        val gripParams = LayoutParams(gripSize, gripSize).apply {
            gravity = Gravity.BOTTOM or Gravity.END
        }
        setupResizeTouch(resizeGripView)
        addView(resizeGripView, gripParams)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupMoveOrClickTouch(view: View, onClick: () -> Unit) {
        var startX = 0f
        var startY = 0f
        var isMoved = false
        var downTime = 0L

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = event.rawX
                    startY = event.rawY
                    isMoved = false
                    downTime = System.currentTimeMillis()
                    onMoveStart?.invoke()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - startX).toInt()
                    val dy = (event.rawY - startY).toInt()
                    if (isMoved || abs(dx) > touchSlop || abs(dy) > touchSlop) {
                        isMoved = true
                        onMoveDelta?.invoke(dx, dy)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (isMoved) {
                        onMoveEnd?.invoke()
                    } else {
                        val duration = System.currentTimeMillis() - downTime
                        if (duration < 400) {
                            onClick()
                        }
                        onMoveEnd?.invoke()
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    onMoveEnd?.invoke()
                    true
                }
                else -> false
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupResizeTouch(view: View) {
        var startX = 0f
        var startY = 0f

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = event.rawX
                    startY = event.rawY
                    onResizeStart?.invoke()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - startX).toInt()
                    val dy = (event.rawY - startY).toInt()
                    onResizeDelta?.invoke(dx, dy)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    onResizeEnd?.invoke()
                    true
                }
                else -> false
            }
        }
    }

    fun updateHeader(symbol: String, priceStr: String?) {
        tvSymbol.text = symbol
        tvPrice.text = priceStr ?: "—"
    }

    fun setActiveInterval(interval: String) {
        currentInterval = interval
        updateTabStyles()
        val btn = intervalButtons[interval]
        if (btn != null) {
            scrollContainer.post {
                scrollContainer.smoothScrollTo((btn.left - 10 * density).toInt().coerceAtLeast(0), 0)
            }
        }
    }

    private fun updateTabStyles() {
        val activeBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 4f * density
            setColor(Color.parseColor("#2B313A"))
        }

        for ((interval, btn) in intervalButtons) {
            if (interval == currentInterval) {
                btn.background = activeBg
                btn.setTextColor(Color.parseColor("#F0B90B")) // Binance Gold / Yellow
                btn.typeface = Typeface.DEFAULT_BOLD
            } else {
                btn.background = null
                btn.setTextColor(Color.parseColor("#848E9C"))
                btn.typeface = Typeface.DEFAULT
            }
        }
    }

    fun setChartData(items: List<KlineItem>) {
        chartView.setData(items)
    }

    fun setChartLoading() {
        chartView.setLoading()
    }

    fun setChartError(message: String) {
        chartView.setError(message)
    }

    fun updateLivePrice(price: Float) {
        chartView.updateLastPrice(price)
    }
}
