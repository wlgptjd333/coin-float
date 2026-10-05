package com.coinfloat.app.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.coinfloat.app.market.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onRequestNotificationPermission: () -> Unit
) {
    val context = LocalContext.current
    val settings by viewModel.settings.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val hasOverlayPermission by viewModel.hasOverlayPermission.collectAsState()
    val hasNotificationPermission by viewModel.hasNotificationPermission.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val searchResults by viewModel.searchResults.collectAsState()
    val isLoadingSymbols by viewModel.isLoadingSymbols.collectAsState()
    val marketPrices by viewModel.marketPrices.collectAsState()
    val symbolInfoMap by viewModel.symbolInfoMap.collectAsState()
    val isServiceActive by viewModel.isServiceActive.collectAsState()
    val ticker24hMap by viewModel.ticker24hMap.collectAsState()
    val fundingInfoMap by viewModel.fundingInfoMap.collectAsState()

    val selectedTabIndex by viewModel.selectedTabIndex.collectAsState()
    val activeChartSymbol by viewModel.activeChartSymbol.collectAsState()
    var isChartFullscreen by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val tabs = listOf("상태", "차트", "심볼", "설정", "안내")

    Scaffold(
        topBar = {
            if (selectedTabIndex != 1) {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = "CoinFloat",
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.titleLarge
                            )
                            Text(
                                text = "초소형 암호화폐 실시간 시세 오버레이",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                )
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(if (selectedTabIndex == 1) androidx.compose.foundation.layout.PaddingValues(0.dp) else innerPadding)
        ) {
            if (!(selectedTabIndex == 1 && isChartFullscreen)) {
                PrimaryTabRow(selectedTabIndex = selectedTabIndex) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTabIndex == index,
                            onClick = { viewModel.selectTab(index) },
                            text = { Text(text = title, fontWeight = FontWeight.SemiBold) }
                        )
                    }
                }
            }

            if (selectedTabIndex == 1) {
                // Interactive Pro TradingView Chart
                TradingViewChartScreen(
                    selectedSymbols = settings.selectedSymbols,
                    activeSymbol = activeChartSymbol,
                    onSymbolSelected = viewModel::selectChartSymbol,
                    marketPrices = marketPrices,
                    symbolInfoMap = symbolInfoMap,
                    ticker24hMap = ticker24hMap,
                    fundingInfoMap = fundingInfoMap,
                    onSearchSymbols = viewModel::searchSymbols,
                    onAddSymbolToWatchlist = viewModel::addSymbol,
                    onRefreshTicker = viewModel::load24hTicker,
                    onRefreshFunding = viewModel::loadFundingInfo,
                    isFullscreen = isChartFullscreen,
                    onToggleFullscreen = { isChartFullscreen = !isChartFullscreen },
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    when (selectedTabIndex) {
                        0 -> {
                        // Section 1: Permission Warnings
                        if (!hasOverlayPermission) {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
                            ) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            imageVector = Icons.Default.Warning,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.error
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = "다른 앱 위에 표시 권한 필요",
                                            fontWeight = FontWeight.Bold,
                                            color = MaterialTheme.colorScheme.onErrorContainer
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text(
                                        text = "시세창 오버레이를 다른 앱 위에 작게 띄우려면 시스템 오버레이 권한이 필요합니다.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onErrorContainer
                                    )
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Button(
                                        onClick = {
                                            val intent = Intent(
                                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                                Uri.parse("package:${context.packageName}")
                                            )
                                            context.startActivity(intent)
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                                    ) {
                                        Text("권한 허용하기")
                                    }
                                }
                            }
                        }

                        if (!hasNotificationPermission) {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = "알림 권한 권장",
                                            fontWeight = FontWeight.Bold,
                                            style = MaterialTheme.typography.bodyMedium
                                        )
                                        Text(
                                            text = "알림창에서 숨기기/표시/종료 제어를 사용하려면 알림을 허용하세요.",
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                    }
                                    Spacer(modifier = Modifier.width(8.dp))
                                    OutlinedButton(onClick = onRequestNotificationPermission) {
                                        Text("알림 허용")
                                    }
                                }
                            }
                        }

                        // Section 2: Service & Connection Status
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(
                                    text = "실시간 시세 감시 상태",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.height(12.dp))

                                // Overlay Permission Row
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("오버레이 권한", style = MaterialTheme.typography.bodyMedium)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            imageVector = if (hasOverlayPermission) Icons.Default.CheckCircle else Icons.Default.Warning,
                                            contentDescription = null,
                                            tint = if (hasOverlayPermission) Color(0xFF65D69A) else Color.Red,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text(
                                            text = if (hasOverlayPermission) "허용됨" else "미허용",
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }

                                Spacer(modifier = Modifier.height(8.dp))

                                // Binance WebSocket Connection Row
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Binance Futures 연결", style = MaterialTheme.typography.bodyMedium)
                                    val (color, text) = when (connectionState) {
                                        ConnectionState.CONNECTED -> Color(0xFF65D69A) to "연결됨"
                                        ConnectionState.CONNECTING -> Color(0xFFFFB300) to "연결 중..."
                                        ConnectionState.RECONNECTING -> Color(0xFFFFB300) to "재연결 중..."
                                        ConnectionState.DISCONNECTED -> Color.Gray to "연결 안 됨"
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(8.dp)
                                                .background(color, CircleShape)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(
                                            text = text,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                            color = color
                                        )
                                    }
                                }

                                if (isServiceActive && connectionState == ConnectionState.CONNECTED) {
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Card(
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                                    ) {
                                        Column(modifier = Modifier.padding(10.dp)) {
                                            Text(
                                                text = "실시간 바이낸스 체결가 (수신 확인)",
                                                style = MaterialTheme.typography.labelSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                            Spacer(modifier = Modifier.height(4.dp))
                                            settings.selectedSymbols.forEach { sym ->
                                                val p = marketPrices[sym]?.price ?: marketPrices[sym.uppercase()]?.price
                                                val pStr = if (p != null) "$sym: ${com.coinfloat.app.market.PriceFormatter.formatPrice(p, "0.01")} USDT" else "$sym: 시세 수신 대기 중..."
                                                Text(
                                                    text = pStr,
                                                    style = MaterialTheme.typography.bodySmall,
                                                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                                                    fontWeight = FontWeight.SemiBold
                                                 )
                                            }
                                        }
                                    }
                                }

                                Spacer(modifier = Modifier.height(16.dp))

                                // Main Start / Stop Buttons
                                if (!isServiceActive) {
                                    Button(
                                        onClick = { viewModel.startService() },
                                        enabled = hasOverlayPermission,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(50.dp)
                                    ) {
                                        Icon(imageVector = Icons.Default.PlayArrow, contentDescription = null)
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("시세창 시작", fontWeight = FontWeight.Bold)
                                    }
                                } else {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        if (settings.isOverlayVisible) {
                                            OutlinedButton(
                                                onClick = { viewModel.hideOverlay() },
                                                modifier = Modifier.weight(1f)
                                            ) {
                                                Icon(imageVector = Icons.Default.VisibilityOff, contentDescription = null)
                                                Spacer(modifier = Modifier.width(6.dp))
                                                Text("숨기기")
                                            }
                                        } else {
                                            Button(
                                                onClick = { viewModel.showOverlay() },
                                                modifier = Modifier.weight(1f)
                                            ) {
                                                Icon(imageVector = Icons.Default.Visibility, contentDescription = null)
                                                Spacer(modifier = Modifier.width(6.dp))
                                                Text("다시 표시")
                                            }
                                        }

                                        Button(
                                            onClick = { viewModel.stopService() },
                                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Icon(imageVector = Icons.Default.Stop, contentDescription = null)
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text("완전 종료")
                                        }
                                    }
                                }
                            }
                        }

                        // Overlay Preview
                        OverlayPreviewCard(settings = settings)
                    }

                    2 -> {
                        SymbolManagementContent(
                            selectedSymbols = settings.selectedSymbols,
                            searchQuery = searchQuery,
                            searchResults = searchResults,
                            isLoadingSymbols = isLoadingSymbols,
                            onSearchQueryChange = viewModel::onSearchQueryChanged,
                            onAddSymbol = viewModel::addSymbol,
                            onRemoveSymbol = viewModel::removeSymbol,
                            onMoveUp = viewModel::moveSymbolUp,
                            onMoveDown = viewModel::moveSymbolDown
                        )
                    }

                    3 -> {
                        DisplaySettingsContent(
                            settings = settings,
                            onSymbolDisplayModeChange = viewModel::updateSymbolDisplayMode,
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
                            onRefreshRateProfileChange = viewModel::updateRefreshRateProfile
                        )
                    }

                    4 -> {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = Icons.Default.Info,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = "삼성 Galaxy / One UI 안내",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = "삼성 Galaxy 기기에서는 백그라운드 절전 정책으로 인해 다른 앱 사용 중 시세 서비스가 일시 중단될 수 있습니다.",
                                    style = MaterialTheme.typography.bodyMedium
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "안정적인 장시간 시세 유지를 위해:\n" +
                                            "1. 디바이스 케어 > 배터리 > 백그라운드 사용 제한\n" +
                                            "2. '절전 예외 앱'에 CoinFloat을 추가해 주세요.\n" +
                                            "3. 앱 설정 > 배터리 > '제한 없음'으로 설정해 주세요.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(
                                    text = "CoinFloat v1.3.7",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "• 거래소: Binance USDⓈ-M Futures (공개 시장 데이터)\n" +
                                            "• 실시간 스트림: Aggregate Trade Stream (100ms)\n" +
                                            "• 트레이딩뷰 실시간 차트 & 미니 캔들 팝업 내장\n" +
                                            "• 계정/API 키/로그인 불필요, 주문/거래 기능 없음",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
}

