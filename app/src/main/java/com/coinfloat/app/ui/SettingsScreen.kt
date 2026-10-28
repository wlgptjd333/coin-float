package com.coinfloat.app.ui

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.coinfloat.app.ui.theme.Cf

private data class NavTab(val label: String, val icon: ImageVector)

private val TABS = listOf(
    NavTab("홈", Icons.Outlined.Home),
    NavTab("차트", Icons.AutoMirrored.Outlined.ShowChart),
    NavTab("종목", Icons.Outlined.FormatListBulleted),
    NavTab("설정", Icons.Outlined.Settings)
)

/** App shell: bottom navigation (홈 · 차트 · 종목 · 설정) around the four screens. */
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onRequestNotificationPermission: () -> Unit
) {
    val context = LocalContext.current
    val appVersion = remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: ""
    }
    val settings by viewModel.settings.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val hasOverlayPermission by viewModel.hasOverlayPermission.collectAsState()
    val hasNotificationPermission by viewModel.hasNotificationPermission.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val searchResults by viewModel.searchResults.collectAsState()
    val isLoadingSymbols by viewModel.isLoadingSymbols.collectAsState()
    val symbolInfoMap by viewModel.symbolInfoMap.collectAsState()
    val isServiceActive by viewModel.isServiceActive.collectAsState()
    val ticker24hMap by viewModel.ticker24hMap.collectAsState()
    val fundingInfoMap by viewModel.fundingInfoMap.collectAsState()
    val selectedTab by viewModel.selectedTabIndex.collectAsState()
    val activeChartSymbol by viewModel.activeChartSymbol.collectAsState()
    val pendingChartInterval by viewModel.pendingChartInterval.collectAsState()

    var isChartFullscreen by rememberSaveable { mutableStateOf(false) }
    // the chart page survives tab switches; it is torn down with the activity
    val chartWeb = remember { ChartWebHolder() }
    DisposableEffect(Unit) { onDispose { chartWeb.destroy() } }
    var infoSheet by rememberSaveable { mutableStateOf<InfoSheet?>(null) }
    val isLandscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    // Fullscreen and landscape give the chart the whole window (no navigation bar).
    val isChartImmersive = selectedTab == SettingsViewModel.TAB_CHART && (isChartFullscreen || isLandscape)

    fun openAppInfo() {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    val upDown = remember(settings.upDownScheme) {
        com.coinfloat.app.ui.theme.UpDownColors(
            androidx.compose.ui.graphics.Color(settings.upDownScheme.up),
            androidx.compose.ui.graphics.Color(settings.upDownScheme.down)
        )
    }
    androidx.compose.runtime.CompositionLocalProvider(com.coinfloat.app.ui.theme.LocalUpDown provides upDown) {
    Scaffold(
        containerColor = Cf.Bg,
        bottomBar = {
            if (!isChartImmersive) {
                NavigationBar(containerColor = Cf.Surface, tonalElevation = 0.dp) {
                    TABS.forEachIndexed { index, tab ->
                        NavigationBarItem(
                            selected = selectedTab == index,
                            onClick = { viewModel.selectTab(index) },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tab.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Cf.Text,
                                selectedTextColor = Cf.Text,
                                indicatorColor = Cf.SurfaceHigh,
                                unselectedIconColor = Cf.TextFaint,
                                unselectedTextColor = Cf.TextFaint
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(Modifier.fillMaxSize().padding(innerPadding)) {
            if (selectedTab == SettingsViewModel.TAB_CHART) {
                TradingViewChartScreen(
                    selectedSymbols = settings.selectedSymbols,
                    activeSymbol = activeChartSymbol,
                    onSymbolSelected = viewModel::selectChartSymbol,
                    marketPrices = viewModel.marketPrices,
                    symbolInfoMap = symbolInfoMap,
                    ticker24hMap = ticker24hMap,
                    fundingInfoMap = fundingInfoMap,
                    defaultInterval = settings.defaultChartInterval,
                    onSearchSymbols = viewModel::searchSymbols,
                    onAddSymbolToWatchlist = viewModel::addSymbol,
                    onRefreshTicker = viewModel::load24hTicker,
                    onRefreshFunding = viewModel::loadFundingInfo,
                    isFullscreen = isChartFullscreen,
                    onToggleFullscreen = { isChartFullscreen = !isChartFullscreen },
                    webHolder = chartWeb,
                    pendingInterval = pendingChartInterval,
                    onIntervalShown = viewModel::chartIntervalShown,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                // each tab keeps its own scroll position (one shared state would open a tab already scrolled)
                key(selectedTab) { Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    when (selectedTab) {
                        SettingsViewModel.TAB_SYMBOLS -> SymbolsContent(
                            selectedSymbols = settings.selectedSymbols,
                            searchQuery = searchQuery,
                            searchResults = searchResults,
                            isLoadingSymbols = isLoadingSymbols,
                            symbolInfo = symbolInfoMap,
                            onSearchQueryChange = viewModel::onSearchQueryChanged,
                            onAddSymbol = viewModel::addSymbol,
                            onRemoveSymbol = viewModel::removeSymbol,
                            onMoveUp = viewModel::moveSymbolUp,
                            onMoveDown = viewModel::moveSymbolDown
                        )
                        SettingsViewModel.TAB_SETTINGS -> SettingsContent(
                            settings = settings,
                            appVersion = appVersion,
                            onSymbolDisplayModeChange = viewModel::updateSymbolDisplayMode,
                            onShow24hChangeChange = viewModel::updateShow24hChange,
                            onUpDownSchemeChange = viewModel::updateUpDownScheme,
                            onFontSizeChange = viewModel::updateFontSize,
                            onTextColorChange = viewModel::updateTextColor,
                            onTextOpacityChange = viewModel::updateTextOpacity,
                            onBackgroundColorChange = viewModel::updateBackgroundColor,
                            onBackgroundOpacityChange = viewModel::updateBackgroundOpacity,
                            onPaddingChange = viewModel::updatePadding,
                            onChartEnabledChange = viewModel::updateChartEnabled,
                            onChartIntervalChange = viewModel::updateChartInterval,
                            onChartSizeProfileChange = viewModel::updateChartSizeProfile,
                            onCustomChartSizeChange = viewModel::updateCustomChartSize,
                            onRefreshRateProfileChange = viewModel::updateRefreshRateProfile,
                            onOpenAppInfo = ::openAppInfo,
                            onShowStabilityHelp = { infoSheet = InfoSheet.STABILITY },
                            onShowGuide = { infoSheet = InfoSheet.GUIDE },
                            onShowLicenses = { infoSheet = InfoSheet.LICENSES },
                            onShowPrivacy = { infoSheet = InfoSheet.PRIVACY }
                        )
                        else -> HomeContent(
                            settings = settings,
                            isServiceActive = isServiceActive,
                            connectionState = connectionState,
                            hasOverlayPermission = hasOverlayPermission,
                            hasNotificationPermission = hasNotificationPermission,
                            prices = viewModel.marketPrices,
                            tickers = ticker24hMap,
                            symbolInfo = symbolInfoMap,
                            onStartService = viewModel::startService,
                            onStopService = viewModel::stopService,
                            onShowOverlay = viewModel::showOverlay,
                            onHideOverlay = viewModel::hideOverlay,
                            onOpenOverlayPermission = {
                                context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")))
                            },
                            onShowPermissionHelp = { infoSheet = InfoSheet.PERMISSION },
                            onRequestNotificationPermission = onRequestNotificationPermission,
                            onOpenChart = viewModel::openChart,
                            onEditSymbols = { viewModel.selectTab(SettingsViewModel.TAB_SYMBOLS) },
                            onRefreshTickers = viewModel::refreshWatchlistTickers
                        )
                    }
                } }
            }
        }
    }

    }
    infoSheet?.let { InfoDialog(it) { infoSheet = null } }
}
