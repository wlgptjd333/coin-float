package com.coinfloat.app.notification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.coinfloat.app.MainActivity
import com.coinfloat.app.R
import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.dayChangePercent
import java.util.Locale
import com.coinfloat.app.overlay.FloatingOverlayService

object CoinFloatNotification {

    const val CHANNEL_ID = "coinfloat_overlay_service"
    const val NOTIFICATION_ID = 1001

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = context.getString(R.string.channel_name)
            val descriptionText = context.getString(R.string.channel_description)
            val importance = NotificationManager.IMPORTANCE_LOW

            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
                setSound(null, null)
            }

            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    /** What the notification shows: the first coin as the title, the others below, and the feed state if not live. */
    data class Content(val title: String, val text: String, val lines: List<String>)

    fun content(
        symbols: List<String>,
        connectionState: ConnectionState,
        isOverlayVisible: Boolean,
        prices: Map<String, MarketPrice>,
        info: Map<String, SymbolInfo>
    ): Content {
        fun line(symbol: String): String {
            val upper = symbol.uppercase()
            val base = info[upper]?.baseAsset ?: upper.removeSuffix("USDT")
            val p = prices[upper] ?: return "$base —"
            val price = PriceFormatter.formatPrice(p.price, info[upper]?.tickSize)
            val change = p.dayChangePercent()?.let { String.format(Locale.US, "  %+.2f%%", it) } ?: ""
            return "$base $price$change"
        }
        val lines = symbols.map(::line)
        // the price is only live while the window is shown and connected (the feed pauses otherwise)
        val status = when {
            !isOverlayVisible -> "숨김 · 마지막 가격"
            connectionState == ConnectionState.CONNECTED -> null
            connectionState == ConnectionState.DISCONNECTED -> "일시정지 · 마지막 가격"
            else -> "연결 중…"
        }
        val title = lines.firstOrNull() ?: "CoinFloat"
        val rest = lines.drop(1).joinToString("  ·  ")
        val text = listOfNotNull(rest.ifEmpty { null }, status).joinToString("  ·  ").ifEmpty { "실시간" }
        return Content(title, text, lines + listOfNotNull(status))
    }

    fun buildNotification(
        context: Context,
        symbols: List<String>,
        connectionState: ConnectionState,
        isOverlayVisible: Boolean,
        content: Content? = null
    ): Notification {
        val openSettingsIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openSettingsPendingIntent = PendingIntent.getActivity(
            context,
            1,
            openSettingsIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // the "설정" button opens the settings tab itself (tapping the notification just opens the app)
        val settingsTabIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_TARGET_TAB, com.coinfloat.app.ui.SettingsViewModel.TAB_SETTINGS)
        }
        val settingsTabPendingIntent = PendingIntent.getActivity(
            context,
            4,
            settingsTabIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(context, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            context,
            2,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val toggleActionIntent = Intent(context, FloatingOverlayService::class.java).apply {
            action = if (isOverlayVisible) FloatingOverlayService.ACTION_HIDE else FloatingOverlayService.ACTION_SHOW
        }
        val togglePendingIntent = PendingIntent.getService(
            context,
            3,
            toggleActionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val c = content ?: content(symbols, connectionState, isOverlayVisible, emptyMap(), emptyMap())

        val toggleTitle = if (isOverlayVisible) {
            context.getString(R.string.action_hide)
        } else {
            context.getString(R.string.action_show)
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(c.title)
            .setContentText(c.text)
            .setStyle(NotificationCompat.InboxStyle().also { st -> c.lines.forEach { st.addLine(it) } })
            .setShowWhen(false)
            .setSilent(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openSettingsPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        // Actions: [숨기기 / 표시], [설정], [종료]
        builder.addAction(
            0,
            toggleTitle,
            togglePendingIntent
        )
        builder.addAction(
            0,
            context.getString(R.string.action_settings),
            settingsTabPendingIntent
        )
        builder.addAction(
            0,
            context.getString(R.string.action_stop),
            stopPendingIntent
        )

        return builder.build()
    }
}
