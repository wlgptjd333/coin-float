package com.coinfloat.app.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.util.TypedValue
import android.view.View
import com.coinfloat.app.market.KlineItem
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class CandleStickChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val density = resources.displayMetrics.density

    // Paints
    private val upPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#0ECB81") // Binance Green
        style = Paint.Style.FILL
    }

    private val downPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F6465D") // Binance Red
        style = Paint.Style.FILL
    }

    private val wickUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#0ECB81")
        strokeWidth = 1.5f * density
        style = Paint.Style.STROKE
    }

    private val wickDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F6465D")
        strokeWidth = 1.5f * density
        style = Paint.Style.STROKE
    }

    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#2B313A")
        strokeWidth = 1f * density
        pathEffect = DashPathEffect(floatArrayOf(4f * density, 4f * density), 0f)
        style = Paint.Style.STROKE
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#848E9C")
        textSize = 9f * density
    }

    private val statusPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#9E9E9E")
        textSize = 11f * density
        textAlign = Paint.Align.CENTER
    }

    private val currentPriceLinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#0ECB81")
        strokeWidth = 1f * density
        pathEffect = DashPathEffect(floatArrayOf(3f * density, 3f * density), 0f)
        style = Paint.Style.STROKE
    }

    private val priceBadgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#0ECB81")
        style = Paint.Style.FILL
    }

    private val badgeTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 8.5f * density
        typeface = android.graphics.Typeface.DEFAULT_BOLD
    }

    private var klines: List<KlineItem> = emptyList()
    private var isLoading = false
    private var errorMessage: String? = null
    private var currentLivePrice: Float? = null
    private var isPriceUp: Boolean = true

    fun setData(items: List<KlineItem>) {
        this.klines = items
        this.isLoading = false
        this.errorMessage = null
        if (currentLivePrice == null && items.isNotEmpty()) {
            currentLivePrice = items.last().close
        }
        invalidate()
    }

    fun setLoading() {
        this.isLoading = true
        this.errorMessage = null
        invalidate()
    }

    fun setError(message: String) {
        this.isLoading = false
        this.errorMessage = message
        invalidate()
    }

    fun updateLastPrice(price: Float) {
        if (klines.isEmpty() || isLoading || errorMessage != null) return
        val lastIndex = klines.size - 1
        val last = klines[lastIndex]

        val prevPrice = currentLivePrice ?: last.close
        if (price > prevPrice) {
            isPriceUp = true
        } else if (price < prevPrice) {
            isPriceUp = false
        }
        currentLivePrice = price

        val activeColor = if (isPriceUp) Color.parseColor("#0ECB81") else Color.parseColor("#F6465D")
        currentPriceLinePaint.color = activeColor
        priceBadgePaint.color = activeColor

        val newHigh = max(last.high, price)
        val newLow = min(last.low, price)
        val updated = klines.toMutableList()
        updated[lastIndex] = last.copy(close = price, high = newHigh, low = newLow)
        this.klines = updated
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val w = width.toFloat()
        val h = height.toFloat()

        if (isLoading) {
            canvas.drawText("차트 불러오는 중...", w / 2f, h / 2f + (4f * density), statusPaint)
            return
        }

        if (errorMessage != null) {
            canvas.drawText(errorMessage ?: "오류 발생", w / 2f, h / 2f + (4f * density), statusPaint)
            return
        }

        if (klines.isEmpty()) {
            canvas.drawText("데이터 없음", w / 2f, h / 2f + (4f * density), statusPaint)
            return
        }

        val paddingLeft = 4f * density
        val paddingRight = 44f * density // Space for right-side price labels
        val paddingTop = 8f * density
        val paddingBottom = 8f * density

        val chartWidth = w - paddingLeft - paddingRight
        val chartHeight = h - paddingTop - paddingBottom

        if (chartWidth <= 0 || chartHeight <= 0) return

        var minPrice = Float.MAX_VALUE
        var maxPrice = Float.MIN_VALUE

        for (k in klines) {
            if (k.low < minPrice) minPrice = k.low
            if (k.high > maxPrice) maxPrice = k.high
        }

        if (minPrice >= maxPrice) {
            maxPrice = minPrice + 1f
        }

        // Add 5% headroom top and bottom
        val priceRange = maxPrice - minPrice
        val adjustedMin = minPrice - priceRange * 0.05f
        val adjustedMax = maxPrice + priceRange * 0.05f
        val adjustedRange = adjustedMax - adjustedMin

        // Draw horizontal grid lines for max and min
        val highY = paddingTop + (1f - (maxPrice - adjustedMin) / adjustedRange) * chartHeight
        val lowY = paddingTop + (1f - (minPrice - adjustedMin) / adjustedRange) * chartHeight

        canvas.drawLine(paddingLeft, highY, paddingLeft + chartWidth, highY, gridPaint)
        canvas.drawLine(paddingLeft, lowY, paddingLeft + chartWidth, lowY, gridPaint)

        // Draw price labels on right
        val highText = formatLabelPrice(maxPrice)
        val lowText = formatLabelPrice(minPrice)
        canvas.drawText(highText, paddingLeft + chartWidth + 4f * density, highY + 3f * density, textPaint)
        canvas.drawText(lowText, paddingLeft + chartWidth + 4f * density, lowY + 3f * density, textPaint)

        // Draw Candlesticks
        val count = klines.size
        val slotWidth = chartWidth / count
        val bodyWidth = (slotWidth * 0.72f).coerceAtLeast(2f)

        for (i in 0 until count) {
            val candle = klines[i]
            val slotCenterX = paddingLeft + (i + 0.5f) * slotWidth

            val cHighY = paddingTop + (1f - (candle.high - adjustedMin) / adjustedRange) * chartHeight
            val cLowY = paddingTop + (1f - (candle.low - adjustedMin) / adjustedRange) * chartHeight
            val cOpenY = paddingTop + (1f - (candle.open - adjustedMin) / adjustedRange) * chartHeight
            val cCloseY = paddingTop + (1f - (candle.close - adjustedMin) / adjustedRange) * chartHeight

            val isUp = candle.close >= candle.open
            val bodyPaint = if (isUp) upPaint else downPaint
            val wickPaint = if (isUp) wickUpPaint else wickDownPaint

            // Draw wick
            canvas.drawLine(slotCenterX, cHighY, slotCenterX, cLowY, wickPaint)

            // Draw body
            val topBodyY = min(cOpenY, cCloseY)
            val bottomBodyY = max(cOpenY, cCloseY)
            val finalBottomY = if (bottomBodyY - topBodyY < 1f * density) topBodyY + 1f * density else bottomBodyY

            val left = slotCenterX - bodyWidth / 2f
            val right = slotCenterX + bodyWidth / 2f

            canvas.drawRect(left, topBodyY, right, finalBottomY, bodyPaint)
        }

        // Draw Current Live Price Line & Badge (TradingView style)
        val livePrice = currentLivePrice ?: klines.lastOrNull()?.close
        if (livePrice != null && adjustedRange > 0f) {
            val liveY = (paddingTop + (1f - (livePrice - adjustedMin) / adjustedRange) * chartHeight)
                .coerceIn(paddingTop, paddingTop + chartHeight)

            // Dotted horizontal line across the entire chart
            canvas.drawLine(paddingLeft, liveY, paddingLeft + chartWidth, liveY, currentPriceLinePaint)

            // Live price badge on the right axis
            val badgeText = formatLabelPrice(livePrice)
            val badgeWidth = paddingRight - (4f * density)
            val badgeHeight = 14f * density
            val badgeLeft = paddingLeft + chartWidth + (2f * density)
            val badgeTop = liveY - (badgeHeight / 2f)
            val badgeRect = RectF(badgeLeft, badgeTop, badgeLeft + badgeWidth, badgeTop + badgeHeight)
            canvas.drawRoundRect(badgeRect, 3f * density, 3f * density, priceBadgePaint)

            // Badge text centered vertically
            canvas.drawText(badgeText, badgeLeft + (3f * density), liveY + (3.5f * density), badgeTextPaint)
        }
    }

    private fun formatLabelPrice(price: Float): String {
        return if (price >= 1000f) {
            String.format(Locale.US, "%.1f", price)
        } else if (price >= 1f) {
            String.format(Locale.US, "%.2f", price)
        } else {
            String.format(Locale.US, "%.4f", price)
        }
    }
}
