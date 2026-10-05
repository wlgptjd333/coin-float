package com.coinfloat.app.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.coinfloat.app.market.FundingInfo
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.Ticker24h
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TradingViewChartScreen(
    selectedSymbols: List<String>,
    activeSymbol: String,
    onSymbolSelected: (String) -> Unit,
    marketPrices: Map<String, MarketPrice> = emptyMap(),
    symbolInfoMap: Map<String, SymbolInfo> = emptyMap(),
    ticker24hMap: Map<String, Ticker24h> = emptyMap(),
    fundingInfoMap: Map<String, FundingInfo> = emptyMap(),
    onSearchSymbols: (String) -> List<SymbolInfo> = { emptyList() },
    onAddSymbolToWatchlist: (String) -> Unit = {},
    onRefreshTicker: (String) -> Unit = {},
    onRefreshFunding: (String) -> Unit = {},
    isFullscreen: Boolean = false,
    onToggleFullscreen: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    // Intercept back button when fullscreen: exit fullscreen instead of leaving app
    BackHandler(enabled = isFullscreen) {
        onToggleFullscreen()
    }

    val currentSymbol = if (activeSymbol.isNotBlank()) activeSymbol else selectedSymbols.firstOrNull() ?: "BTCUSDT"
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Periodically refresh 24h ticker & funding info every 30s while chart screen is actively displayed
    LaunchedEffect(currentSymbol) {
        onRefreshTicker(currentSymbol)
        onRefreshFunding(currentSymbol)
        while (true) {
            kotlinx.coroutines.delay(30_000L)
            onRefreshTicker(currentSymbol)
            onRefreshFunding(currentSymbol)
        }
    }

    // 1-second countdown ticker for next funding fee time
    var countdownTick by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000L)
            countdownTick = System.currentTimeMillis()
        }
    }

    // Live Price state (100ms native WebSocket)
    val currentMarketPrice = marketPrices[currentSymbol] ?: marketPrices[currentSymbol.uppercase()]
    val currentInfo = symbolInfoMap[currentSymbol] ?: symbolInfoMap[currentSymbol.uppercase()]
    val formattedPrice = PriceFormatter.formatPrice(currentMarketPrice?.price, currentInfo?.tickSize)
    val livePriceFloat = currentMarketPrice?.price?.toFloat() ?: 0f

    // 24h Stats
    val ticker24h = ticker24hMap[currentSymbol] ?: ticker24hMap[currentSymbol.uppercase()]
    val changePercent = ticker24h?.priceChangePercent ?: 0f
    val isPositiveChange = changePercent >= 0f
    val changeColor = if (isPositiveChange) Color(0xFF0ECB81) else Color(0xFFF6465D)
    val formattedChange = String.format(Locale.US, "%s%.2f%%", if (isPositiveChange) "+" else "", changePercent)

    // Funding Rate & Countdown
    val fundingInfo = fundingInfoMap[currentSymbol] ?: fundingInfoMap[currentSymbol.uppercase()]
    val fundingRatePct = (fundingInfo?.fundingRate ?: 0f) * 100f
    val isFundingPositive = fundingRatePct >= 0f
    val fundingColor = if (isFundingPositive) Color(0xFF0ECB81) else Color(0xFFF6465D)
    val formattedFundingRate = String.format(Locale.US, "%s%.4f%%", if (isFundingPositive) "+" else "", fundingRatePct)
    val fundingCountdown = fundingInfo?.let {
        val diff = (it.nextFundingTime - countdownTick).coerceAtLeast(0L)
        val h = diff / 3600000L
        val m = (diff % 3600000L) / 60000L
        val s = (diff % 60000L) / 1000L
        String.format(Locale.US, "%02d:%02d:%02d", h, m, s)
    } ?: ""

    // Price uptick / downtick flashing animation
    var prevPrice by remember { mutableFloatStateOf(0f) }
    var priceColor by remember { mutableStateOf(Color(0xFF0ECB81)) }

    LaunchedEffect(livePriceFloat) {
        if (livePriceFloat > 0f) {
            if (prevPrice > 0f) {
                if (livePriceFloat > prevPrice) {
                    priceColor = Color(0xFF0ECB81) // Green uptick
                } else if (livePriceFloat < prevPrice) {
                    priceColor = Color(0xFFF6465D) // Red downtick
                }
            }
            prevPrice = livePriceFloat
        }
    }

    val animatedPriceColor by animateColorAsState(
        targetValue = priceColor,
        animationSpec = tween(durationMillis = 180),
        label = "PriceColor"
    )

    // Chart Engine Mode: "tv" (TradingView) vs "fast" (100ms ultra speed)
    var chartMode by remember { mutableStateOf("tv") }
    // Selected interval: "1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"
    var activeInterval by remember { mutableStateOf("15m") }
    // Drawing Toolbar Toggle (Default hidden on mobile so chart isn't covered)
    var isDrawingToolbarVisible by remember { mutableStateOf(false) }
    // Chart Style: "1": Candle, "3": Line, "8": Heikin Ashi
    var activeChartStyle by remember { mutableStateOf("1") }

    // Technical Indicators Toggle State (Fast Mode & Indicators bar)
    var isMaActive by remember { mutableStateOf(true) }
    var isEmaActive by remember { mutableStateOf(false) }
    var isBollActive by remember { mutableStateOf(false) }
    var isVolActive by remember { mutableStateOf(true) }

    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var showSymbolSearchSheet by remember { mutableStateOf(false) }
    var showDepthSheet by remember { mutableStateOf(false) }

    // Battery Optimization: Freeze WebView JS, canvas and timers when paused or tab disposed
    DisposableEffect(lifecycleOwner, webViewRef) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> {
                    try {
                        webViewRef?.onPause()
                        webViewRef?.pauseTimers()
                    } catch (_: Exception) {}
                }
                Lifecycle.Event.ON_RESUME -> {
                    try {
                        webViewRef?.onResume()
                        webViewRef?.resumeTimers()
                    } catch (_: Exception) {}
                }
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            try {
                webViewRef?.onPause()
                webViewRef?.pauseTimers()
                (context as? Activity)?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            } catch (_: Exception) {}
        }
    }

    // Bridge live ticks directly into chart.html
    LaunchedEffect(livePriceFloat) {
        if (livePriceFloat > 0f && webViewRef != null) {
            webViewRef?.evaluateJavascript("if (window.updateLiveTick) { window.updateLiveTick($livePriceFloat); }", null)
        }
    }

    val timeframes = listOf(
        "1m" to "1",
        "3m" to "3",
        "5m" to "5",
        "15m" to "15",
        "30m" to "30",
        "1h" to "60",
        "4h" to "240",
        "1d" to "D"
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF131722))
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Pro Exchange Live Ticker & Control Header (Hidden in Fullscreen for maximum viewing)
            if (!isFullscreen) {
                Surface(
                    color = Color(0xFF1E222D),
                    shadowElevation = 6.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        // Row 1: Symbol Pill (Clickable Dropdown), 100ms Live Price & 24h Change, Mode Toggle, Drawing, Rotate, Fullscreen
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Left: Clickable Symbol Selector with Badge + Live Price
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable { showSymbolSearchSheet = true }
                                    .padding(vertical = 2.dp)
                            ) {
                                Column {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = currentSymbol.uppercase(),
                                            color = Color.White,
                                            fontSize = 15.sp,
                                            fontWeight = FontWeight.Bold,
                                            fontFamily = FontFamily.Monospace
                                        )
                                        Spacer(modifier = Modifier.width(3.dp))
                                        Text(
                                            text = "▾",
                                            color = Color(0xFF848E9C),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(Color(0xFF2A2E39))
                                                .padding(horizontal = 4.dp, vertical = 1.dp)
                                        ) {
                                            Text(
                                                text = "PERP",
                                                color = Color(0xFFF0B90B),
                                                fontSize = 9.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = formattedPrice,
                                            color = animatedPriceColor,
                                            fontSize = 17.sp,
                                            fontWeight = FontWeight.Black,
                                            fontFamily = FontFamily.Monospace
                                        )
                                        if (ticker24h != null) {
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Box(
                                                modifier = Modifier
                                                    .clip(RoundedCornerShape(3.dp))
                                                    .background(changeColor.copy(alpha = 0.15f))
                                                    .padding(horizontal = 4.dp, vertical = 1.dp)
                                            ) {
                                                Text(
                                                    text = formattedChange,
                                                    color = changeColor,
                                                    fontSize = 10.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    fontFamily = FontFamily.Monospace
                                                )
                                            }
                                        }
                                    }
                                }
                            }

                            // Right: Engine Selector, Drawing Toggle, Rotate, Fullscreen, Web
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                // Engine Mode Selector (100ms 초고속 vs 트레이딩뷰)
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(if (chartMode == "fast") Color(0xFF0ECB81).copy(alpha = 0.2f) else Color(0xFF2962FF).copy(alpha = 0.2f))
                                        .border(
                                            1.dp,
                                            if (chartMode == "fast") Color(0xFF0ECB81) else Color(0xFF2962FF),
                                            RoundedCornerShape(6.dp)
                                        )
                                        .clickable {
                                            val newMode = if (chartMode == "tv") "fast" else "tv"
                                            chartMode = newMode
                                            webViewRef?.evaluateJavascript("window.setChartMode('$newMode');", null)
                                        }
                                        .padding(horizontal = 7.dp, vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            imageVector = if (chartMode == "fast") Icons.Default.Speed else Icons.Default.Star,
                                            contentDescription = null,
                                            tint = if (chartMode == "fast") Color(0xFF0ECB81) else Color(0xFF2962FF),
                                            modifier = Modifier.size(11.dp)
                                        )
                                        Spacer(modifier = Modifier.width(3.dp))
                                        Text(
                                            text = if (chartMode == "fast") "100ms" else "TV",
                                            color = if (chartMode == "fast") Color(0xFF0ECB81) else Color(0xFF2962FF),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }

                                // Instant Drawing Toolbar Toggle Button (✏️ 드로잉)
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(
                                            if (isDrawingToolbarVisible) Color(0xFFF0B90B).copy(alpha = 0.25f)
                                            else Color(0xFF2A2E39)
                                        )
                                        .border(
                                            1.dp,
                                            if (isDrawingToolbarVisible) Color(0xFFF0B90B)
                                            else Color(0xFF363C4E),
                                            RoundedCornerShape(6.dp)
                                        )
                                        .clickable {
                                            isDrawingToolbarVisible = !isDrawingToolbarVisible
                                            webViewRef?.evaluateJavascript("window.setDrawingToolbar($isDrawingToolbarVisible);", null)
                                        }
                                        .padding(horizontal = 7.dp, vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            imageVector = Icons.Default.Edit,
                                            contentDescription = "그리기 도구",
                                            tint = if (isDrawingToolbarVisible) Color(0xFFF0B90B) else Color(0xFF848E9C),
                                            modifier = Modifier.size(11.dp)
                                        )
                                        Spacer(modifier = Modifier.width(3.dp))
                                        Text(
                                            text = if (isDrawingToolbarVisible) "드로잉 ON" else "드로잉",
                                            color = if (isDrawingToolbarVisible) Color(0xFFF0B90B) else Color(0xFF848E9C),
                                            fontSize = 11.sp,
                                            fontWeight = if (isDrawingToolbarVisible) FontWeight.Bold else FontWeight.Medium
                                        )
                                    }
                                }

                                // Landscape Rotation
                                IconButton(
                                    onClick = {
                                        val activity = context as? Activity
                                        if (activity != null) {
                                            val current = activity.requestedOrientation
                                            activity.requestedOrientation = if (current == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
                                                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                                            } else {
                                                ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                                            }
                                        }
                                    },
                                    modifier = Modifier.size(30.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.ScreenRotation,
                                        contentDescription = "회전",
                                        tint = Color(0xFFB2B5BE),
                                        modifier = Modifier.size(17.dp)
                                    )
                                }

                                // Fullscreen Button
                                IconButton(
                                    onClick = onToggleFullscreen,
                                    modifier = Modifier.size(30.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Fullscreen,
                                        contentDescription = "전체화면",
                                        tint = Color(0xFF2962FF),
                                        modifier = Modifier.size(19.dp)
                                    )
                                }

                                // External Link
                                IconButton(
                                    onClick = {
                                        val clean = currentSymbol.trim().uppercase()
                                        val sym = if (clean.endsWith("USDT")) "BINANCE:${clean}.P" else "BINANCE:$clean"
                                        val intent = Intent(
                                            Intent.ACTION_VIEW,
                                            Uri.parse("https://kr.tradingview.com/chart/?symbol=$sym")
                                        )
                                        context.startActivity(intent)
                                    },
                                    modifier = Modifier.size(30.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.OpenInBrowser,
                                        contentDescription = "외부 웹",
                                        tint = Color(0xFF848E9C),
                                        modifier = Modifier.size(17.dp)
                                    )
                                }
                            }
                        }

                        // Row 2: Compact 24h Stats Summary & Funding Rate + Depth/Spread Snapshot Button
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                modifier = Modifier
                                    .weight(1f)
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (ticker24h != null) {
                                    Text(
                                        text = "고가 ${PriceFormatter.formatPrice(ticker24h.highPrice.toBigDecimal(), currentInfo?.tickSize)}",
                                        color = Color(0xFF848E9C),
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    Text(
                                        text = "저가 ${PriceFormatter.formatPrice(ticker24h.lowPrice.toBigDecimal(), currentInfo?.tickSize)}",
                                        color = Color(0xFF848E9C),
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    if (ticker24h.volume > 0f) {
                                        Text(
                                            text = "거래량 ${String.format(Locale.US, "%.1f", ticker24h.volume)}",
                                            color = Color(0xFF848E9C),
                                            fontSize = 10.sp,
                                            fontFamily = FontFamily.Monospace
                                        )
                                    }
                                }
                                if (fundingInfo != null && fundingInfo.fundingRate != 0f) {
                                    Text(
                                        text = "펀딩 $formattedFundingRate ($fundingCountdown)",
                                        color = fundingColor,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Medium,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            }

                            // Orderbook / Market Depth snapshot sheet toggle
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(Color(0xFF2A2E39))
                                    .clickable { showDepthSheet = true }
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = "호가/스프레드 ▾",
                                    color = Color(0xFFD1D4DC),
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(5.dp))

                        // Row 3: Timeframe Quick Pills, Chart Styles, Technical Indicator Toggles, Fit Screen
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(5.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            timeframes.forEach { (label, code) ->
                                val isSelected = activeInterval == label
                                val pillBg = if (isSelected) Color(0xFF2962FF) else Color(0xFF2A2E39)
                                val pillText = if (isSelected) Color.White else Color(0xFF848E9C)

                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(pillBg)
                                        .clickable {
                                            activeInterval = label
                                            webViewRef?.evaluateJavascript("window.setInterval('$code');", null)
                                        }
                                        .padding(horizontal = 7.dp, vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = label,
                                        color = pillText,
                                        fontSize = 11.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                                    )
                                }
                            }

                            // Chart Type Styles (캔들, 라인, 하이킨아시)
                            val chartStyles = listOf("1" to "캔들", "3" to "라인", "8" to "하이킨")
                            chartStyles.forEach { (code, label) ->
                                val isSelected = activeChartStyle == code
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(if (isSelected) Color(0xFFF0B90B).copy(alpha = 0.2f) else Color(0xFF2A2E39))
                                        .border(1.dp, if (isSelected) Color(0xFFF0B90B) else Color.Transparent, RoundedCornerShape(4.dp))
                                        .clickable {
                                            activeChartStyle = code
                                            webViewRef?.evaluateJavascript("window.setChartStyle('$code');", null)
                                        }
                                        .padding(horizontal = 6.dp, vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = label,
                                        color = if (isSelected) Color(0xFFF0B90B) else Color(0xFF848E9C),
                                        fontSize = 11.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            }

                            // Technical Indicator Quick Chips (MA, EMA, BOLL, VOL)
                            val indicators = listOf(
                                "MA" to isMaActive,
                                "EMA" to isEmaActive,
                                "BOLL" to isBollActive,
                                "VOL" to isVolActive
                            )
                            indicators.forEach { (indName, isActive) ->
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(if (isActive) Color(0xFF2962FF).copy(alpha = 0.25f) else Color(0xFF2A2E39))
                                        .border(1.dp, if (isActive) Color(0xFF2962FF) else Color.Transparent, RoundedCornerShape(4.dp))
                                        .clickable {
                                            when (indName) {
                                                "MA" -> {
                                                    isMaActive = !isMaActive
                                                    webViewRef?.evaluateJavascript("window.toggleIndicator('MA', $isMaActive);", null)
                                                }
                                                "EMA" -> {
                                                    isEmaActive = !isEmaActive
                                                    webViewRef?.evaluateJavascript("window.toggleIndicator('EMA', $isEmaActive);", null)
                                                }
                                                "BOLL" -> {
                                                    isBollActive = !isBollActive
                                                    webViewRef?.evaluateJavascript("window.toggleIndicator('BOLL', $isBollActive);", null)
                                                }
                                                "VOL" -> {
                                                    isVolActive = !isVolActive
                                                    webViewRef?.evaluateJavascript("window.toggleIndicator('VOL', $isVolActive);", null)
                                                }
                                            }
                                        }
                                        .padding(horizontal = 6.dp, vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = indName,
                                        color = if (isActive) Color(0xFF5B8DEF) else Color(0xFF848E9C),
                                        fontSize = 10.sp,
                                        fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            }

                            // Reset Zoom / Fit Screen Button
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFF2A2E39))
                                    .clickable {
                                        webViewRef?.evaluateJavascript("window.resetChartZoom();", null)
                                    }
                                    .padding(horizontal = 6.dp, vertical = 4.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = Icons.Default.Refresh,
                                        contentDescription = "화면 맞춤",
                                        tint = Color(0xFF848E9C),
                                        modifier = Modifier.size(11.dp)
                                    )
                                    Spacer(modifier = Modifier.width(2.dp))
                                    Text(text = "맞춤", color = Color(0xFF848E9C), fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }

            // Intuitive Drawing Active Banner with Instant 1-Tap "✕ 드로잉 숨기기" Button
            AnimatedVisibility(visible = isDrawingToolbarVisible) {
                Surface(
                    color = Color(0xFF252932),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF363C4E)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Edit,
                                contentDescription = null,
                                tint = Color(0xFFF0B90B),
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "드로잉 모드 켜짐 (차트 좌측 도구바 사용 가능)",
                                fontSize = 11.sp,
                                color = Color(0xFFD1D4DC),
                                fontWeight = FontWeight.Medium
                            )
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFFF6465D).copy(alpha = 0.2f))
                                .border(1.dp, Color(0xFFF6465D), RoundedCornerShape(4.dp))
                                .clickable {
                                    isDrawingToolbarVisible = false
                                    webViewRef?.evaluateJavascript("window.setDrawingToolbar(false);", null)
                                }
                                .padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            Text(
                                text = "✕ 드로잉 숨기기",
                                color = Color(0xFFF6465D),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }

            // Main High-Performance Android WebView
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            setLayerType(View.LAYER_TYPE_HARDWARE, null)
                            layoutParams = android.view.ViewGroup.LayoutParams(
                                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                                android.view.ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            WebView.setWebContentsDebuggingEnabled(true)
                            setBackgroundColor(android.graphics.Color.parseColor("#131722"))
                            tag = currentSymbol

                            val cookieManager = CookieManager.getInstance()
                            cookieManager.setAcceptCookie(true)
                            cookieManager.setAcceptThirdPartyCookies(this, true)

                            settings.apply {
                                javaScriptEnabled = true
                                domStorageEnabled = true
                                databaseEnabled = true
                                allowFileAccess = true
                                allowContentAccess = true
                                allowFileAccessFromFileURLs = true
                                allowUniversalAccessFromFileURLs = true
                                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                                loadWithOverviewMode = false
                                useWideViewPort = false
                                cacheMode = WebSettings.LOAD_DEFAULT
                                builtInZoomControls = false
                                displayZoomControls = false
                                setSupportZoom(false)
                            }

                            // Two-way bridge for drawing toolbar state sync
                            addJavascriptInterface(object {
                                @JavascriptInterface
                                fun onToolbarVisibilityChanged(visible: Boolean) {
                                    post {
                                        isDrawingToolbarVisible = visible
                                    }
                                }
                            }, "AndroidBridge")

                            webViewClient = object : WebViewClient() {
                                override fun onPageFinished(view: WebView?, url: String?) {
                                    super.onPageFinished(view, url)
                                    val code = timeframes.find { it.first == activeInterval }?.second ?: "15"
                                    view?.evaluateJavascript("window.loadSymbol('$currentSymbol', '$code');", null)
                                    view?.evaluateJavascript("window.setChartMode('$chartMode');", null)
                                    view?.evaluateJavascript("window.setDrawingToolbar($isDrawingToolbarVisible);", null)
                                }
                            }

                            loadUrl("file:///android_asset/chart.html")
                            webViewRef = this
                        }
                    },
                    update = { webView ->
                        val tag = webView.tag as? String
                        if (tag != currentSymbol) {
                            webView.tag = currentSymbol
                            val code = timeframes.find { it.first == activeInterval }?.second ?: "15"
                            webView.evaluateJavascript("window.loadSymbol('$currentSymbol', '$code');", null)
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }

            // Bottom Watchlist Quick Switcher Bar (Hidden in Fullscreen)
            if (!isFullscreen) {
                Surface(
                    color = Color(0xFF1E222D),
                    shadowElevation = 4.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 5.dp)
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        selectedSymbols.forEach { symbol ->
                            val isSelected = symbol.equals(currentSymbol, ignoreCase = true)
                            val chipPrice = marketPrices[symbol]?.price ?: marketPrices[symbol.uppercase()]?.price
                            val chipPriceStr = if (chipPrice != null) PriceFormatter.formatPrice(chipPrice, "0.01") else ""

                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(if (isSelected) Color(0xFF2962FF) else Color(0xFF252932))
                                    .border(
                                        1.dp,
                                        if (isSelected) Color(0xFF5B8DEF) else Color.Transparent,
                                        RoundedCornerShape(12.dp)
                                    )
                                    .clickable {
                                        onSymbolSelected(symbol)
                                        webViewRef?.evaluateJavascript(
                                            "window.loadSymbol('$symbol', '${timeframes.find { it.first == activeInterval }?.second ?: "15"}');",
                                            null
                                        )
                                    }
                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = symbol.uppercase(),
                                        color = if (isSelected) Color.White else Color(0xFFD1D4DC),
                                        fontSize = 11.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    if (chipPriceStr.isNotBlank()) {
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text(
                                            text = chipPriceStr,
                                            color = if (isSelected) Color(0xFFF0B90B) else Color(0xFF848E9C),
                                            fontSize = 10.sp,
                                            fontFamily = FontFamily.Monospace
                                        )
                                    }
                                }
                            }
                        }

                        // Quick '+' button to search & add coins directly from chart
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF252932))
                                .clickable { showSymbolSearchSheet = true }
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.Add,
                                    contentDescription = "심볼 추가",
                                    tint = Color(0xFF848E9C),
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(2.dp))
                                Text(
                                    text = "종목 추가",
                                    color = Color(0xFF848E9C),
                                    fontSize = 11.sp
                                )
                            }
                        }
                    }
                }
            }
        }

        // Fullscreen Mode Floating Action Bar (Exit, Rotate, Next/Prev Coin, Drawing Toggle)
        AnimatedVisibility(
            visible = isFullscreen,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(12.dp)
        ) {
            Surface(
                color = Color(0xDD1E222D),
                shape = RoundedCornerShape(20.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF363C4E)),
                shadowElevation = 8.dp
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (selectedSymbols.size > 1) {
                        IconButton(
                            onClick = {
                                val currentIdx = selectedSymbols.indexOf(currentSymbol)
                                val prevIdx = if (currentIdx <= 0) selectedSymbols.size - 1 else currentIdx - 1
                                val nextSym = selectedSymbols[prevIdx]
                                onSymbolSelected(nextSym)
                                webViewRef?.evaluateJavascript(
                                    "window.loadSymbol('$nextSym', '${timeframes.find { it.first == activeInterval }?.second ?: "15"}');",
                                    null
                                )
                            },
                            modifier = Modifier.size(26.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ChevronLeft,
                                contentDescription = "이전 코인",
                                tint = Color.White,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }

                    Text(
                        text = "${currentSymbol.uppercase()} $formattedPrice",
                        color = animatedPriceColor,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )

                    if (selectedSymbols.size > 1) {
                        IconButton(
                            onClick = {
                                val currentIdx = selectedSymbols.indexOf(currentSymbol)
                                val nextIdx = (currentIdx + 1) % selectedSymbols.size
                                val nextSym = selectedSymbols[nextIdx]
                                onSymbolSelected(nextSym)
                                webViewRef?.evaluateJavascript(
                                    "window.loadSymbol('$nextSym', '${timeframes.find { it.first == activeInterval }?.second ?: "15"}');",
                                    null
                                )
                            },
                            modifier = Modifier.size(26.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ChevronRight,
                                contentDescription = "다음 코인",
                                tint = Color.White,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }

                    // Rotate Screen
                    IconButton(
                        onClick = {
                            val activity = context as? Activity
                            if (activity != null) {
                                val current = activity.requestedOrientation
                                activity.requestedOrientation = if (current == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
                                    ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                                } else {
                                    ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                                }
                            }
                        },
                        modifier = Modifier.size(26.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ScreenRotation,
                            contentDescription = "회전",
                            tint = Color.White,
                            modifier = Modifier.size(15.dp)
                        )
                    }

                    // Drawing Toolbar Toggle in Fullscreen
                    IconButton(
                        onClick = {
                            isDrawingToolbarVisible = !isDrawingToolbarVisible
                            webViewRef?.evaluateJavascript("window.setDrawingToolbar($isDrawingToolbarVisible);", null)
                        },
                        modifier = Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(if (isDrawingToolbarVisible) Color(0xFFF0B90B) else Color(0xFF2A2E39))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = "그리기 도구",
                            tint = if (isDrawingToolbarVisible) Color.Black else Color.White,
                            modifier = Modifier.size(14.dp)
                        )
                    }

                    // Fit Screen in Fullscreen
                    IconButton(
                        onClick = {
                            webViewRef?.evaluateJavascript("window.resetChartZoom();", null)
                        },
                        modifier = Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF2A2E39))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "화면 맞춤",
                            tint = Color.White,
                            modifier = Modifier.size(14.dp)
                        )
                    }

                    // Exit Fullscreen
                    IconButton(
                        onClick = onToggleFullscreen,
                        modifier = Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF2962FF))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "전체화면 종료",
                            tint = Color.White,
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }
            }
        }

        // Fullscreen Mode Floating Timeframe Bar at Bottom
        AnimatedVisibility(
            visible = isFullscreen,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 12.dp)
        ) {
            Surface(
                color = Color(0xCC1E222D),
                shape = RoundedCornerShape(16.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF363C4E)),
                shadowElevation = 6.dp
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    timeframes.forEach { (label, code) ->
                        val isSelected = activeInterval == label
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(if (isSelected) Color(0xFF2962FF) else Color.Transparent)
                            .clickable {
                                activeInterval = label
                                webViewRef?.evaluateJavascript("window.setInterval('$code');", null)
                            }
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = label,
                                color = if (isSelected) Color.White else Color(0xFF848E9C),
                                fontSize = 10.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }
            }
        }
    }

    // Mini Orderbook & Market Depth / 24h Range Modal Bottom Sheet
    if (showDepthSheet) {
        ModalBottomSheet(
            onDismissRequest = { showDepthSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Color(0xFF1E222D),
            contentColor = Color.White
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "${currentSymbol.uppercase()} 호가 & 시장 요약",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                        Text(
                            text = "Binance USDT 무기한 선물",
                            fontSize = 11.sp,
                            color = Color(0xFF848E9C)
                        )
                    }
                    IconButton(onClick = { showDepthSheet = false }) {
                        Icon(imageVector = Icons.Default.Close, contentDescription = "닫기", tint = Color(0xFF848E9C))
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))

                // 24h High/Low Visual Range Bar
                if (ticker24h != null) {
                    val high = ticker24h.highPrice
                    val low = ticker24h.lowPrice
                    val current = livePriceFloat.takeIf { it > 0f } ?: low
                    val range = (high - low).coerceAtLeast(0.0001f)
                    val ratio = ((current - low) / range).coerceIn(0f, 1f)

                    Text(
                        text = "24시간 시세 범위 (현재 위치 ${(ratio * 100).toInt()}%)",
                        fontSize = 11.sp,
                        color = Color(0xFF848E9C),
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(text = "저가 $low", fontSize = 10.sp, color = Color(0xFFF6465D), fontFamily = FontFamily.Monospace)
                        Text(text = "현재 $current", fontSize = 10.sp, color = Color.White, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                        Text(text = "고가 $high", fontSize = 10.sp, color = Color(0xFF0ECB81), fontFamily = FontFamily.Monospace)
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    // Progress bar track
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(Color(0xFF2A2E39))
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(ratio)
                                .fillMaxHeight()
                                .background(
                                    androidx.compose.ui.graphics.Brush.horizontalGradient(
                                        listOf(Color(0xFFF6465D), Color(0xFFF0B90B), Color(0xFF0ECB81))
                                    )
                                )
                        )
                    }
                    Spacer(modifier = Modifier.height(14.dp))
                }

                // Estimated Bid / Ask & Spread Card
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF252932)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(text = "실시간 매수/매도 스프레드", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFFD1D4DC))
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column {
                                Text(text = "매수 1호가 (Bid)", fontSize = 11.sp, color = Color(0xFF848E9C))
                                Text(text = formattedPrice, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0ECB81), fontFamily = FontFamily.Monospace)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(text = "매도 1호가 (Ask)", fontSize = 11.sp, color = Color(0xFF848E9C))
                                val tickF = currentInfo?.tickSize?.toFloatOrNull() ?: 0.01f
                                val askPrice = (livePriceFloat + tickF).takeIf { livePriceFloat > 0f } ?: 0f
                                Text(
                                    text = if (askPrice > 0f) PriceFormatter.formatPrice(askPrice.toBigDecimal(), currentInfo?.tickSize) else "—",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFFF6465D),
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        HorizontalDivider(color = Color(0xFF2A2E39))
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "호가 단위 (Tick Size)", fontSize = 11.sp, color = Color(0xFF848E9C))
                            Text(text = currentInfo?.tickSize ?: "0.01", fontSize = 11.sp, color = Color.White, fontFamily = FontFamily.Monospace)
                        }
                        if (ticker24h != null && ticker24h.quoteVolume > 0f) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(text = "24h 거래대금", fontSize = 11.sp, color = Color(0xFF848E9C))
                                Text(text = String.format(Locale.US, "%,.0f USDT", ticker24h.quoteVolume), fontSize = 11.sp, color = Color.White, fontFamily = FontFamily.Monospace)
                            }
                        }
                        if (fundingInfo != null) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(text = "펀딩비 정산까지", fontSize = 11.sp, color = Color(0xFF848E9C))
                                Text(text = "$formattedFundingRate ($fundingCountdown)", fontSize = 11.sp, color = fundingColor, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }

    // Quick Symbol Search Modal Bottom Sheet
    if (showSymbolSearchSheet) {
        var query by remember { mutableStateOf("") }
        var searchResults by remember { mutableStateOf<List<SymbolInfo>>(emptyList()) }

        LaunchedEffect(query) {
            searchResults = if (query.isNotBlank()) onSearchSymbols(query) else emptyList()
        }

        ModalBottomSheet(
            onDismissRequest = { showSymbolSearchSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Color(0xFF1E222D),
            contentColor = Color.White
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text(
                    text = "차트 종목 검색 (Binance USDT 선물)",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("종목명 검색 (예: SOL, XRP, DOGE)", color = Color(0xFF787B86)) },
                    leadingIcon = {
                        Icon(imageVector = Icons.Default.Search, contentDescription = null, tint = Color(0xFF848E9C))
                    },
                    trailingIcon = {
                        if (query.isNotEmpty()) {
                            IconButton(onClick = { query = "" }) {
                                Icon(imageVector = Icons.Default.Clear, contentDescription = "지우기", tint = Color(0xFF848E9C))
                            }
                        }
                    },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(10.dp))

                if (searchResults.isNotEmpty()) {
                    Text(
                        text = "검색 결과 (${searchResults.size}건)",
                        fontSize = 12.sp,
                        color = Color(0xFF2962FF),
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(6.dp))

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 350.dp)
                    ) {
                        items(searchResults) { item ->
                            val isAdded = selectedSymbols.contains(item.symbol)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onSymbolSelected(item.symbol)
                                        webViewRef?.evaluateJavascript(
                                            "window.loadSymbol('${item.symbol}', '${timeframes.find { it.first == activeInterval }?.second ?: "15"}');",
                                            null
                                        )
                                        showSymbolSearchSheet = false
                                    }
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = item.symbol,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White
                                    )
                                    Text(
                                        text = "${item.baseAsset} / ${item.quoteAsset} · tick ${item.tickSize}",
                                        fontSize = 11.sp,
                                        color = Color(0xFF848E9C)
                                    )
                                }

                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (isAdded) {
                                        Text(
                                            text = "관심종목",
                                            fontSize = 11.sp,
                                            color = Color(0xFF0ECB81),
                                            fontWeight = FontWeight.Medium
                                        )
                                    } else {
                                        Button(
                                            onClick = { onAddSymbolToWatchlist(item.symbol) },
                                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2962FF)),
                                            contentPadding = ButtonDefaults.TextButtonContentPadding,
                                            modifier = Modifier.height(30.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Add,
                                                contentDescription = null,
                                                modifier = Modifier.size(14.dp)
                                            )
                                            Spacer(modifier = Modifier.width(2.dp))
                                            Text("관심 추가", fontSize = 11.sp)
                                        }
                                    }
                                }
                            }
                            HorizontalDivider(color = Color(0xFF2A2E39))
                        }
                    }
                } else if (query.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(text = "검색 결과가 없습니다.", color = Color(0xFF848E9C), fontSize = 13.sp)
                    }
                } else {
                    Text(
                        text = "현재 관심 종목 바로가기",
                        fontSize = 12.sp,
                        color = Color(0xFF848E9C),
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(6.dp))

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 280.dp)
                    ) {
                        items(selectedSymbols) { sym ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onSymbolSelected(sym)
                                        webViewRef?.evaluateJavascript(
                                            "window.loadSymbol('$sym', '${timeframes.find { it.first == activeInterval }?.second ?: "15"}');",
                                            null
                                        )
                                        showSymbolSearchSheet = false
                                    }
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = sym,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (sym.equals(currentSymbol, true)) Color(0xFF2962FF) else Color.White
                                )
                                Text(
                                    text = "차트 열기 →",
                                    fontSize = 12.sp,
                                    color = Color(0xFF2962FF)
                                )
                            }
                            HorizontalDivider(color = Color(0xFF2A2E39))
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}
