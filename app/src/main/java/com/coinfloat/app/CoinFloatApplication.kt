package com.coinfloat.app

import android.app.Application
import com.coinfloat.app.market.MarketDataRepository
import com.coinfloat.app.notification.CoinFloatNotification
import com.coinfloat.app.settings.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CoinFloatApplication : Application() {

    private val applicationScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onCreate() {
        super.onCreate()
        CoinFloatNotification.createNotificationChannel(this)
        com.coinfloat.app.alerts.AlertNotifier.ensureChannel(this)
        com.coinfloat.app.alerts.AlertScheduler.schedule(this)      // a force stop cancels alarms: set the next check again

        // Initialize repositories
        SettingsRepository.getInstance(this)
        val marketRepo = MarketDataRepository.getInstance()
        marketRepo.symbolCacheFile = java.io.File(filesDir, "symbols_v1.tsv")

        // Preload exchangeInfo in background
        applicationScope.launch {
            marketRepo.loadExchangeInfoIfNeeded()
        }
    }
}
