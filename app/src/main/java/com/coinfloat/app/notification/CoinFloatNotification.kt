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

    fun buildNotification(
        context: Context,
        symbols: List<String>,
        connectionState: ConnectionState,
        isOverlayVisible: Boolean
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

        val symbolsText = symbols.map { it.removeSuffix("USDT") }.joinToString(" · ")
        val statusText = when {
            !isOverlayVisible -> "오버레이 숨김"
            connectionState == ConnectionState.CONNECTED -> "연결됨"
            connectionState == ConnectionState.CONNECTING -> "연결 중"
            connectionState == ConnectionState.RECONNECTING -> "재연결 중"
            else -> "연결 안 됨"
        }

        val contentText = "$symbolsText · $statusText"

        val toggleTitle = if (isOverlayVisible) {
            context.getString(R.string.action_hide)
        } else {
            context.getString(R.string.action_show)
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.notification_title))
            .setContentText(contentText)
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
            openSettingsPendingIntent
        )
        builder.addAction(
            0,
            context.getString(R.string.action_stop),
            stopPendingIntent
        )

        return builder.build()
    }
}
