package com.coinfloat.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import com.coinfloat.app.ui.SettingsScreen
import com.coinfloat.app.ui.SettingsViewModel
import com.coinfloat.app.ui.theme.CoinFloatTheme

class MainActivity : ComponentActivity() {

    private val viewModel: SettingsViewModel by viewModels()

    private val requestNotificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        viewModel.refreshPermissions()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        handleIntent(intent)
        requestNotificationPermissionIfNeeded()

        setContent {
            CoinFloatTheme {
                SettingsScreen(
                    viewModel = viewModel,
                    onRequestNotificationPermission = {
                        requestNotificationPermissionIfNeeded()
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshPermissions()
        viewModel.setAppForegroundActive(true)
    }

    override fun onPause() {
        super.onPause()
        viewModel.setAppForegroundActive(false)
    }

    private fun handleIntent(intent: android.content.Intent?) {
        val targetTab = intent?.getIntExtra("TARGET_TAB", -1) ?: -1
        if (targetTab >= 0) {
            viewModel.selectTab(targetTab)
        }
        val targetSymbol = intent?.getStringExtra("TARGET_SYMBOL")
        if (!targetSymbol.isNullOrBlank()) {
            viewModel.selectChartSymbol(targetSymbol)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}
