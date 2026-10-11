package com.coinfloat.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import com.coinfloat.app.market.KlineItem
import com.coinfloat.app.market.PriceFormatter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * Candles + volume for the floating mini chart. Live prices update the forming candle in place and open the next
 * candle when its period starts, so the chart stays current between the (once a minute) REST refreshes.
 */
class CandleStickChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val density = resources.displayMetrics.density

    private val upPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = UP; style = Paint.Style.FILL }
    private val downPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DOWN; style = Paint.Style.FILL }
    private val wickUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = UP; strokeWidth = 1.2f * density; style = Paint.Style.STROKE }
    private val wickDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DOWN; strokeWidth = 1.2f * density; style = Paint.Style.STROKE }
    private val volUpPaint = Paint().apply { color = Color.argb(90, 0x0E, 0xCB, 0x81); style = Paint.Style.FILL }
    private val volDownPaint = Paint().apply { color = Color.argb(90, 0xF6, 0x46, 0x5D); style = Paint.Style.FILL }

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
        color = UP
        strokeWidth = 1f * density
        pathEffect = DashPathEffect(floatArrayOf(3f * density, 3f * density), 0f)
        style = Paint.Style.STROKE
    }
    private val priceBadgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = UP; style = Paint.Style.FILL }
    private val badgeTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 8.5f * density
        typeface = android.graphics.Typeface.DEFAULT_BOLD
    }
    private val crosshairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#848E9C")
        strokeWidth = 1f * density
        pathEffect = DashPathEffect(floatArrayOf(3f * density, 3f * density), 0f)
        style = Paint.Style.STROKE
    }
    private val crosshairBadgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#2A2E39"); style = Paint.Style.FILL }
    private val readoutBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(225, 0x16, 0x1A, 0x21); style = Paint.Style.FILL }
    private val readoutPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#D1D4DC")
        textSize = 8.5f * density
    }

    private val badgeRect = RectF()
    private val timeFmt = SimpleDateFormat("HH:mm", Locale.US)
    private val dateFmt = SimpleDateFormat("MM/dd", Locale.US)

    // Owned copy so live ticks can update the forming candle in place (no per-tick list allocation).
    private val klines = ArrayList<KlineItem>()
    private var isLoading = false
    private var errorMessage: String? = null
    private var currentLivePrice: Float? = null
    private var isPriceUp: Boolean = true
    private var intervalMs = 15 * 60_000L

    // Touch inspection: index into [klines] of the candle under the finger
    private var touchedCandleIndex: Int? = null
    var onCandleTouched: ((KlineItem?) -> Unit)? = null

    fun setInterval(interval: String) {
        intervalMs = intervalToMs(interval)
    }

    fun setData(items: List<KlineItem>) {
        klines.clear()
        klines.addAll(items)
        isLoading = false
        errorMessage = null
        if (items.isNotEmpty()) currentLivePrice = items.last().close
        invalidate()
    }

    fun setLoading() {
        isLoading = true
        errorMessage = null
        invalidate()
    }

    fun setError(message: String) {
        isLoading = false
        errorMessage = message
        invalidate()
    }

    fun updateLastPrice(price: Float) {
        if (klines.isEmpty() || isLoading || errorMessage != null) return
        val lastIndex = klines.size - 1
        val last = klines[lastIndex]

        val prevPrice = currentLivePrice ?: last.close
        if (price > prevPrice) isPriceUp = true else if (price < prevPrice) isPriceUp = false
        currentLivePrice = price
        val activeColor = if (isPriceUp) UP else DOWN
        currentPriceLinePaint.color = activeColor
        priceBadgePaint.color = activeColor

        val now = System.currentTimeMillis()
        if (intervalMs > 0 && now >= last.openTime + intervalMs) {
            // the period ended: open the next candle from the live price instead of stretching the old one
            val periods = (now - last.openTime) / intervalMs
            klines.add(KlineItem(last.openTime + periods * intervalMs, last.close, max(last.close, price), min(last.close, price), price, 0f))
            if (klines.size > MAX_CANDLES) klines.removeAt(0)
        } else {
            klines[lastIndex] = last.copy(close = price, high = max(last.high, price), low = min(last.low, price))
        }
        // nothing on screen moves while the finger inspects a candle; skip the redraw then
        if (touchedCandleIndex == null) invalidate()
    }

    // ---- geometry shared by drawing and touch ----------------------------------------------------------------------
    private val padLeft get() = 4f * density
    private val padRight get() = 44f * density
    private fun chartWidth() = width - padLeft - padRight
    private fun visibleStart(): Int {
        val fit = max(8, (chartWidth() / (MIN_SLOT_DP * density)).toInt())
        return max(0, klines.size - fit)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (klines.isEmpty() || isLoading || errorMessage != null) return super.onTouchEvent(event)
        val cw = chartWidth()
        if (cw <= 0) return super.onTouchEvent(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                val start = visibleStart()
                val count = klines.size - start
                val slot = cw / count
                val idx = start + ((event.x - padLeft) / slot).toInt().coerceIn(0, count - 1)
                if (idx != touchedCandleIndex) {
                    touchedCandleIndex = idx
                    onCandleTouched?.invoke(klines[idx])
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                touchedCandleIndex = null
                onCandleTouched?.invoke(null)
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()

        when {
            isLoading -> { canvas.drawText("차트 불러오는 중…", w / 2f, h / 2f + 4f * density, statusPaint); return }
            errorMessage != null -> { canvas.drawText(errorMessage ?: "오류", w / 2f, h / 2f + 4f * density, statusPaint); return }
            klines.isEmpty() -> { canvas.drawText("데이터 없음", w / 2f, h / 2f + 4f * density, statusPaint); return }
        }

        val padTop = 8f * density
        val padBottom = 4f * density
        val cw = chartWidth()
        val fullH = h - padTop - padBottom
        if (cw <= 0 || fullH <= 0) return
        // candles on top, a thin volume strip below
        val candleH = fullH * 0.80f
        val volTop = padTop + fullH * 0.84f
        val volH = padTop + fullH - volTop

        val start = visibleStart()
        val count = klines.size - start

        var minPrice = Float.MAX_VALUE
        var maxPrice = -Float.MAX_VALUE
        var maxVol = 0f
        for (i in start until klines.size) {
            val k = klines[i]
            if (k.low < minPrice) minPrice = k.low
            if (k.high > maxPrice) maxPrice = k.high
            if (k.volume > maxVol) maxVol = k.volume
        }
        if (minPrice >= maxPrice) maxPrice = minPrice + 1f
        val range = maxPrice - minPrice
        val adjMin = minPrice - range * 0.05f
        val adjRange = (maxPrice + range * 0.05f) - adjMin
        fun y(p: Float) = padTop + (1f - (p - adjMin) / adjRange) * candleH

        val highY = y(maxPrice)
        val lowY = y(minPrice)
        canvas.drawLine(padLeft, highY, padLeft + cw, highY, gridPaint)
        canvas.drawLine(padLeft, lowY, padLeft + cw, lowY, gridPaint)
        canvas.drawText(formatLabelPrice(maxPrice), padLeft + cw + 4f * density, highY + 3f * density, textPaint)
        canvas.drawText(formatLabelPrice(minPrice), padLeft + cw + 4f * density, lowY + 3f * density, textPaint)

        val slot = cw / count
        val bodyW = (slot * 0.7f).coerceAtLeast(1.5f)
        for (j in 0 until count) {
            val c = klines[start + j]
            val cx = padLeft + (j + 0.5f) * slot
            val up = c.close >= c.open
            canvas.drawLine(cx, y(c.high), cx, y(c.low), if (up) wickUpPaint else wickDownPaint)
            val top = min(y(c.open), y(c.close))
            val bottom = max(max(y(c.open), y(c.close)), top + 1f * density)
            canvas.drawRect(cx - bodyW / 2f, top, cx + bodyW / 2f, bottom, if (up) upPaint else downPaint)
            if (maxVol > 0f && c.volume > 0f) {
                val vh = max(1f, c.volume / maxVol * volH)
                canvas.drawRect(cx - bodyW / 2f, volTop + volH - vh, cx + bodyW / 2f, volTop + volH, if (up) volUpPaint else volDownPaint)
            }
        }

        val touchIdx = touchedCandleIndex
        if (touchIdx != null && touchIdx in start until klines.size) {
            val c = klines[touchIdx]
            val cx = padLeft + (touchIdx - start + 0.5f) * slot
            val cy = y(c.close)
            canvas.drawLine(cx, padTop, cx, padTop + fullH, crosshairPaint)
            canvas.drawLine(padLeft, cy, padLeft + cw, cy, crosshairPaint)
            drawBadge(canvas, formatLabelPrice(c.close), cy, cw, crosshairBadgePaint)
            drawReadout(canvas, c, cw)
        } else {
            val live = currentLivePrice ?: klines.last().close
            val ly = y(live).coerceIn(padTop, padTop + candleH)
            canvas.drawLine(padLeft, ly, padLeft + cw, ly, currentPriceLinePaint)
            drawBadge(canvas, formatLabelPrice(live), ly, cw, priceBadgePaint)
        }
    }

    private fun drawBadge(canvas: Canvas, text: String, cy: Float, cw: Float, paint: Paint) {
        val bw = padRight - 4f * density
        val bh = 14f * density
        val left = padLeft + cw + 2f * density
        badgeRect.set(left, cy - bh / 2f, left + bw, cy + bh / 2f)
        canvas.drawRoundRect(badgeRect, 3f * density, 3f * density, paint)
        canvas.drawText(text, left + 3f * density, cy + 3.5f * density, badgeTextPaint)
    }

    // time + OHLC of the touched candle, in a small box at the top-left of the chart
    private fun drawReadout(canvas: Canvas, c: KlineItem, cw: Float) {
        val time = (if (intervalMs >= 86_400_000L) dateFmt else timeFmt).format(Date(c.openTime))
        val text = "$time  O ${formatLabelPrice(c.open)}  H ${formatLabelPrice(c.high)}  L ${formatLabelPrice(c.low)}  C ${formatLabelPrice(c.close)}"
        val tw = min(readoutPaint.measureText(text), cw - 4f * density)
        val top = 2f * density
        badgeRect.set(padLeft, top, padLeft + tw + 8f * density, top + 14f * density)
        canvas.drawRoundRect(badgeRect, 3f * density, 3f * density, readoutBgPaint)
        canvas.drawText(text, padLeft + 4f * density, top + 10f * density, readoutPaint)
    }

    private fun formatLabelPrice(price: Float): String = PriceFormatter.formatLabelPrice(price)

    companion object {
        private val UP = Color.parseColor("#0ECB81")
        private val DOWN = Color.parseColor("#F6465D")
        private const val MIN_SLOT_DP = 5f
        private const val MAX_CANDLES = 120

        /** "15m" → 900 000 ms; unknown → 0 (no automatic roll-over). */
        fun intervalToMs(interval: String): Long {
            val n = interval.dropLast(1).toLongOrNull() ?: return 0L
            return when (interval.last()) {
                'm' -> n * 60_000L
                'h' -> n * 3_600_000L
                'd' -> n * 86_400_000L
                'w' -> n * 604_800_000L
                else -> 0L
            }
        }
    }
}
