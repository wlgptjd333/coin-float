package com.coinfloat.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.coinfloat.app.market.KlineItem

@SuppressLint("ViewConstructor")
class MiniChartView(
    context: Context,
    private val onIntervalSelected: (String) -> Unit,
    private val onSymbolToggleClicked: () -> Unit,
    private val onCloseClicked: () -> Unit
) : LinearLayout(context) {

    private val density = resources.displayMetrics.density

    private val tvSymbol: TextView
    private val tvPrice: TextView
    private val intervalButtons = mutableMapOf<String, TextView>()
    private val chartView: CandleStickChartView

    private var currentInterval = "15m"

    init {
        orientation = VERTICAL
        clipToPadding = true

        val padH = (10 * density).toInt()
        val padV = (8 * density).toInt()
        setPadding(padH, padV, padH, padV)

        // Rounded semi-transparent container background
        val cornerPx = 8f * density
        val bgDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = cornerPx
            setColor(Color.argb(235, 0x1E, 0x20, 0x24)) // 92% dark slate
            setStroke((1 * density).toInt().coerceAtLeast(1), Color.argb(180, 0x43, 0x4A, 0x54))
        }
        background = bgDrawable

        // 1. Top Header Row: Symbol, Price, Interval Tabs, Close Button
        val headerLayout = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (6 * density).toInt()
            }
        }

        // Symbol & Price clickable container (to cycle symbols)
        val symbolContainer = LinearLayout(context).apply {
            orientation = VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { onSymbolToggleClicked() }
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
        headerLayout.addView(symbolContainer)

        // Interval Buttons: 1m, 5m, 15m, 1h
        val intervals = listOf("1m", "5m", "15m", "1h")
        val tabsLayout = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
                rightMargin = (6 * density).toInt()
            }
        }

        for (interval in intervals) {
            val btn = TextView(context).apply {
                text = interval
                textSize = 9f
                setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())
                gravity = Gravity.CENTER
                setOnClickListener {
                    setActiveInterval(interval)
                    onIntervalSelected(interval)
                }
            }
            intervalButtons[interval] = btn
            tabsLayout.addView(btn)
        }
        updateTabStyles()
        headerLayout.addView(tabsLayout)

        // Close button (✕)
        val btnClose = TextView(context).apply {
            text = "✕"
            textSize = 13f
            setTextColor(Color.parseColor("#848E9C"))
            gravity = Gravity.CENTER
            setPadding((6 * density).toInt(), 0, (4 * density).toInt(), 0)
            setOnClickListener { onCloseClicked() }
        }
        headerLayout.addView(btnClose)

        addView(headerLayout)

        // 2. Candlestick Canvas View
        chartView = CandleStickChartView(context).apply {
            layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, (110 * density).toInt())
        }
        addView(chartView)
    }

    fun updateHeader(symbol: String, priceStr: String?) {
        tvSymbol.text = symbol
        tvPrice.text = priceStr ?: "—"
    }

    fun setActiveInterval(interval: String) {
        currentInterval = interval
        updateTabStyles()
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
}
