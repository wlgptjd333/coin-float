package com.coinfloat.app.overlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.coinfloat.app.settings.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * An app update or a reboot ends the floating window's service; it used to stay gone until the app was opened again.
 * Both broadcasts may start a foreground service, so the window comes back by itself when it was on and shown.
 */
class OverlayRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED && intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext
        val done = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Main).launch {
            try {
                val settings = withTimeoutOrNull(5_000L) { SettingsRepository.getInstance(app).awaitSettings() } ?: return@launch
                // a window the user hid stays hidden; without the permission the service would only stop again
                if (!settings.isServiceEnabled || !settings.isOverlayVisible) return@launch
                if (!Settings.canDrawOverlays(app) || FloatingOverlayService.isServiceActive.value) return@launch
                val start = Intent(app, FloatingOverlayService::class.java).setAction(FloatingOverlayService.ACTION_START)
                ContextCompat.startForegroundService(app, start)
                Log.d(TAG, "Floating window restored after ${intent.action}")
            } catch (e: Exception) {
                Log.e(TAG, "Could not restore the floating window", e)
            } finally {
                done.finish()
            }
        }
    }

    private companion object {
        const val TAG = "OverlayRestore"
    }
}
