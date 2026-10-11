package com.coinfloat.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import com.coinfloat.app.market.dayChangePercent
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.Ticker24h
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.SymbolDisplayMode
import com.coinfloat.app.ui.components.Caption
import com.coinfloat.app.ui.components.CoinAvatar
import com.coinfloat.app.ui.components.Group
import com.coinfloat.app.ui.components.GroupDivider
import com.coinfloat.app.ui.components.ListRow
import com.coinfloat.app.ui.components.Notice
import com.coinfloat.app.ui.components.PillButton
import com.coinfloat.app.ui.components.ScreenHeader
import com.coinfloat.app.ui.components.SectionLabel
import com.coinfloat.app.ui.components.StatusPill
import com.coinfloat.app.ui.components.SwitchRow
import com.coinfloat.app.ui.theme.Cf
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow

@Composable
fun HomeContent(
    settings: OverlaySettings,
    isServiceActive: Boolean,
    connectionState: ConnectionState,
    hasOverlayPermission: Boolean,
    hasNotificationPermission: Boolean,
    prices: StateFlow<Map<String, MarketPrice>>,
    tickers: Map<String, Ticker24h>,
    symbolInfo: Map<String, SymbolInfo>,
    onStartService: () -> Unit,
    onStopService: () -> Unit,
    onShowOverlay: () -> Unit,
    onHideOverlay: () -> Unit,
    onOpenOverlayPermission: () -> Unit,
    onShowPermissionHelp: () -> Unit,
    onRequestNotificationPermission: () -> Unit,
    onOpenChart: (String) -> Unit,
    onEditSymbols: () -> Unit,
    onRefreshTickers: () -> Unit
) {
    // 24h change for the watchlist: a REST snapshot seeds it; the live stream keeps it current afterwards.
    val refresh by rememberUpdatedState(onRefreshTickers)
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(settings.selectedSymbols) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                refresh()
                delay(300_000L)
            }
        }
    }

    Column {
        ScreenHeader(title = "CoinFloat") {
            val (label, color) = when {
                !isServiceActive -> "시세창 꺼짐" to Cf.TextMuted
                connectionState == ConnectionState.CONNECTED -> "실시간" to Cf.Brand
                connectionState == ConnectionState.DISCONNECTED -> "대기 중" to Cf.TextMuted
                else -> "연결 중" to Cf.Warn
            }
            StatusPill(label, color)
        }

        if (!hasOverlayPermission) {
            Spacer(Modifier.height(8.dp))
            Notice(
                icon = Icons.Outlined.Layers,
                title = "다른 앱 위에 표시 권한이 필요해요",
                body = "시세창을 다른 앱 위에 띄우려면 권한을 허용해 주세요. 스위치가 회색으로 눌리지 않으면 도움말을 확인하세요."
            ) {
                PillButton("권한 허용", onOpenOverlayPermission)
                PillButton("허용이 안 될 때", onShowPermissionHelp, primary = false)
            }
        } else if (!hasNotificationPermission) {
            Spacer(Modifier.height(8.dp))
            Notice(
                icon = Icons.Outlined.NotificationsNone,
                title = "알림을 허용하면 더 편해요",
                body = "알림창에서 시세창을 바로 숨기거나 끌 수 있어요.",
                tint = Cf.Accent
            ) {
                PillButton("알림 허용", onRequestNotificationPermission)
            }
        }

        SectionLabel("플로팅 시세창")
        Group {
            SwitchRow(
                title = "시세창 켜기",
                subtitle = if (isServiceActive) "다른 앱 위에 실시간 시세를 띄우는 중" else "켜면 화면 위에 작은 시세창이 떠요",
                checked = isServiceActive,
                enabled = hasOverlayPermission || isServiceActive,
                onCheckedChange = { if (it) onStartService() else onStopService() }
            )
            if (isServiceActive) {
                GroupDivider()
                SwitchRow(
                    title = "화면에 표시",
                    subtitle = if (settings.isOverlayVisible) "숨기면 시세 수신도 멈춰 배터리를 아껴요" else "숨김 상태 · 시세 수신 일시정지",
                    checked = settings.isOverlayVisible,
                    onCheckedChange = { if (it) onShowOverlay() else onHideOverlay() }
                )
            }
        }

        SectionLabel("관심 종목") {
            Text(
                "편집",
                style = MaterialTheme.typography.labelLarge,
                color = Cf.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onEditSymbols)
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
        Watchlist(settings.selectedSymbols, prices, tickers, symbolInfo, onOpenChart)
        Caption("종목을 누르면 차트가 열려요.")

        SectionLabel("시세창 미리보기")
        Group { OverlayPreview(settings, Modifier.padding(12.dp)) }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Watchlist(
    symbols: List<String>,
    pricesFlow: StateFlow<Map<String, MarketPrice>>,
    tickers: Map<String, Ticker24h>,
    symbolInfo: Map<String, SymbolInfo>,
    onOpenChart: (String) -> Unit
) {
    // Collected here so a price tick recomposes only the list.
    val prices by pricesFlow.collectAsState()
    Group {
        symbols.forEachIndexed { i, sym ->
            val upper = sym.uppercase()
            val info = symbolInfo[upper]
            val base = info?.baseAsset ?: upper.removeSuffix("USDT")
            val price = prices[upper]?.price
            val change = prices[upper]?.dayChangePercent() ?: tickers[upper]?.priceChangePercent
            ListRow(
                title = base,
                subtitle = "${info?.quoteAsset ?: "USDT"} 무기한",
                onClick = { onOpenChart(upper) },
                leading = { CoinAvatar(base) },
                trailing = {
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            PriceFormatter.formatPrice(price, info?.tickSize),
                            // fixed-width digits: prices do not jitter as they tick
                            style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum", fontSize = 15.sp),
                            color = Cf.Text
                        )
                        Spacer(Modifier.height(3.dp))
                        ChangeTag(change)
                    }
                }
            )
            if (i < symbols.size - 1) GroupDivider(startInset = 64)
        }
    }
}

@Composable
private fun ChangeTag(change: Float?) {
    val color = when {
        change == null -> Cf.TextFaint
        change >= 0f -> Cf.Up
        else -> Cf.Down
    }
    Text(
        text = if (change == null) "—" else "%+.2f%%".format(change),
        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
        fontWeight = FontWeight.SemiBold,
        color = color,
        modifier = Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 6.dp, vertical = 1.dp)
    )
}

/** The floating window as it will look, on a mock phone wallpaper. */
@Composable
fun OverlayPreview(settings: OverlaySettings, modifier: Modifier = Modifier) {
    fun parse(hex: String, alpha: Float, fallback: Color): Color = runCatching {
        val c = android.graphics.Color.parseColor(hex)
        Color(android.graphics.Color.red(c) / 255f, android.graphics.Color.green(c) / 255f, android.graphics.Color.blue(c) / 255f, alpha)
    }.getOrDefault(fallback)

    val bg = parse(settings.backgroundColorHex, settings.backgroundOpacity.coerceIn(0f, 1f), Color(0xCC1E2024))
    val text = parse(settings.textColorHex, settings.textOpacity.coerceIn(0.1f, 1f), Color(0xFF65D69A))
    val stroke = parse(settings.backgroundColorHex, (settings.backgroundOpacity.coerceIn(0f, 1f) * 1.5f).coerceIn(0.2f, 0.85f), Color.Gray)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(132.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF2B3A55), Color(0xFF1B2333), Color(0xFF3A2F45))))
    ) {
        // a hint of app content behind the window
        Column(Modifier.padding(start = 16.dp, top = 54.dp)) {
            repeat(3) { r ->
                Box(
                    Modifier
                        .padding(bottom = 8.dp)
                        .width((150 - r * 30).dp)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color.White.copy(alpha = 0.08f))
                )
            }
        }
        Box(
            modifier = Modifier
                .padding(12.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(bg)
                .border(1.dp, stroke, RoundedCornerShape(6.dp))
                .padding(horizontal = (settings.paddingDp * 1.5f + 4f).dp, vertical = (settings.paddingDp + 2f).dp)
        ) {
            Column {
                listOf(
                    Triple("BTCUSDT", "BTC", "85,136.70") to 0.99f,
                    Triple("ETHUSDT", "ETH", "3,240.20") to -1.42f
                ).forEach { (row, change) ->
                    val (full, short, p) = row
                    val label = when (settings.symbolDisplayMode) {
                        SymbolDisplayMode.FULL -> "$full "
                        SymbolDisplayMode.SHORT -> "$short "
                        SymbolDisplayMode.HIDDEN -> ""
                    }
                    val line = buildAnnotatedString {
                        append("$label$p")
                        if (settings.show24hChange) {
                            withStyle(SpanStyle(color = (if (change >= 0f) Cf.Up else Cf.Down).copy(alpha = text.alpha))) {
                                append(" %+.2f%%".format(change))
                            }
                        }
                    }
                    Text(
                        line,
                        color = text,
                        fontSize = settings.fontSizeSp.sp,
                        fontFamily = FontFamily.Monospace,
                        lineHeight = settings.fontSizeSp.sp * 1.25f
                    )
                }
            }
        }
    }
}
