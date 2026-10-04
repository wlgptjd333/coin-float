package com.coinfloat.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.widget.LinearLayout
import android.widget.TextView
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.SymbolDisplayMode

@SuppressLint("ViewConstructor")
class OverlayView(context: Context) : LinearLayout(context) {

    private var currentSettings: OverlaySettings = OverlaySettings()
    private val rowViews = mutableMapOf<String, TextView>()
    private var symbolInfoMap: Map<String, SymbolInfo> = emptyMap()
    private var latestPrices: Map<String, MarketPrice> = emptyMap()

    init {
        orientation = VERTICAL
        gravity = Gravity.START or Gravity.TOP
        clipToPadding = false
        isClickable = true
        isFocusable = false
    }

    override fun onInterceptTouchEvent(ev: MotionEvent?): Boolean {
        // Intercept all touches so child TextViews never consume touch events
        return true
    }

    fun applySettings(settings: OverlaySettings, infoMap: Map<String, SymbolInfo>) {
        this.currentSettings = settings
        this.symbolInfoMap = infoMap

        // Set padding scaling directly with paddingDp for fine box size control
        val hPadPx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            (settings.paddingDp * 1.5f + 4f),
            resources.displayMetrics
        ).toInt()
        val vPadPx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            (settings.paddingDp + 2f),
            resources.displayMetrics
        ).toInt()
        setPadding(hPadPx, vPadPx, hPadPx, vPadPx)

        // Set background color with opacity applied ONLY to background
        applyBackgroundColor(settings.backgroundColorHex, settings.backgroundOpacity)

        // Rebuild rows if symbol list or order changed
        val currentKeys = rowViews.keys.toList()
        if (currentKeys != settings.selectedSymbols) {
            rebuildRows(settings)
        } else {
            // Update styling of existing rows
            updateRowsStyling(settings)
        }

        // Re-render latest prices
        renderPrices()
    }

    private fun applyBackgroundColor(colorHex: String, opacity: Float) {
        val baseColor = try {
            Color.parseColor(colorHex)
        } catch (_: Exception) {
            Color.parseColor("#1E2024")
        }

        val alpha = (opacity.coerceIn(0f, 1f) * 255).toInt()
        val bgWithAlpha = Color.argb(
            alpha,
            Color.red(baseColor),
            Color.green(baseColor),
            Color.blue(baseColor)
        )

        // Rounded background with 6dp radius for aesthetics (matching OverlayPreviewCard)
        val cornerPx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            6f,
            resources.displayMetrics
        )
        val strokeAlpha = ((opacity.coerceIn(0f, 1f) * 1.5f).coerceIn(0.2f, 0.85f) * 255).toInt()
        val strokeColor = Color.argb(
            strokeAlpha,
            Color.red(baseColor),
            Color.green(baseColor),
            Color.blue(baseColor)
        )
        val strokeWidthPx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            1f,
            resources.displayMetrics
        ).toInt().coerceAtLeast(1)

        val drawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(bgWithAlpha)
            cornerRadius = cornerPx
            setStroke(strokeWidthPx, strokeColor)
        }
        background = drawable
    }

    private fun rebuildRows(settings: OverlaySettings) {
        removeAllViews()
        rowViews.clear()

        val textColor = parseTextColor(settings.textColorHex, settings.textOpacity)
        val gapPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 2f, resources.displayMetrics).toInt()
        val count = settings.selectedSymbols.size

        for ((idx, symbol) in settings.selectedSymbols.withIndex()) {
            val formattedSymbol = PriceFormatter.formatSymbol(symbol, null, settings.symbolDisplayMode)
            val tv = TextView(context).apply {
                setTextSize(TypedValue.COMPLEX_UNIT_SP, settings.fontSizeSp)
                setTextColor(textColor)
                typeface = Typeface.MONOSPACE
                includeFontPadding = false
                isClickable = false
                isFocusable = false
                setPadding(0, 0, 0, 0)
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                // Clean crisp text without blur or shadow, matching OverlayPreviewCard
                setShadowLayer(0f, 0f, 0f, 0)
                text = if (settings.symbolDisplayMode == SymbolDisplayMode.HIDDEN) "—" else "$formattedSymbol —"
                layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
                    if (idx < count - 1) {
                        bottomMargin = gapPx
                    }
                }
            }
            rowViews[symbol] = tv
            addView(tv)
        }
    }

    private fun updateRowsStyling(settings: OverlaySettings) {
        val textColor = parseTextColor(settings.textColorHex, settings.textOpacity)
        for ((_, tv) in rowViews) {
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, settings.fontSizeSp)
            tv.setTextColor(textColor)
            tv.setShadowLayer(0f, 0f, 0f, 0)
        }
    }

    private fun parseTextColor(colorHex: String, opacity: Float): Int {
        val alpha = (opacity.coerceIn(0.1f, 1f) * 255).toInt()
        return try {
            val parsed = Color.parseColor(colorHex)
            Color.argb(alpha, Color.red(parsed), Color.green(parsed), Color.blue(parsed))
        } catch (_: Exception) {
            Color.argb(alpha, 0x65, 0xD6, 0x9A)
        }
    }

    fun updatePrices(prices: Map<String, MarketPrice>, infoMap: Map<String, SymbolInfo>) {
        this.latestPrices = prices
        this.symbolInfoMap = infoMap
        renderPrices()
    }

    private fun renderPrices() {
        for (symbol in currentSettings.selectedSymbols) {
            val tv = rowViews[symbol] ?: continue
            val marketPrice = latestPrices[symbol] ?: latestPrices[symbol.uppercase()] ?: latestPrices[symbol.lowercase()]
            val info = symbolInfoMap[symbol] ?: symbolInfoMap[symbol.uppercase()]

            val tickSize = info?.tickSize
            val formattedPrice = PriceFormatter.formatPrice(marketPrice?.price, tickSize)

            val formattedSymbol = PriceFormatter.formatSymbol(
                symbol = symbol,
                baseAsset = info?.baseAsset,
                mode = currentSettings.symbolDisplayMode
            )

            val text = if (currentSettings.symbolDisplayMode == SymbolDisplayMode.HIDDEN) {
                formattedPrice
            } else {
                "$formattedSymbol $formattedPrice"
            }

            if (tv.text != text) {
                tv.text = text
            }
        }
    }
}
