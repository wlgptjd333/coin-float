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

        // Initialize repositories
        SettingsRepository.getInstance(this)
        val marketRepo = MarketDataRepository.getInstance()

        // Preload exchangeInfo in background
        applicationScope.launch {
            marketRepo.loadExchangeInfoIfNeeded()
        }
    }
}
