package com.coinfloat.app.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.SideEffect
import com.coinfloat.app.market.dayChangePercent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.repeatOnLifecycle
import com.coinfloat.app.market.FundingInfo
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.Ticker24h
import kotlinx.coroutines.delay
import java.util.Locale

private val ChartBg = Color(0xFF131722)
private val PanelBg = Color(0xFF131722)       // same as the chart page: header and chart read as one surface
private val LineColor = Color(0xFF2A2E39)
private val MutedText = Color(0xFF848E9C)
private val MainText = Color(0xFFD1D4DC)
private val UpColor = Color(0xFF0ECB81)
private val DownColor = Color(0xFFF6465D)
private val AccentColor = Color(0xFF2962FF)

private const val CHART_PAGE_URL = "file:///android_asset/chart.html"
private const val TICKER_REFRESH_MS = 30_000L

/**
 * In-app chart. The chart itself (candles, indicators, drawing tools, order-flow layers) is chart.html, built on the
 * open-source lightweight-charts engine; this screen only adds a one-line live-price header and the symbol picker.
 */
@Composable
fun TradingViewChartScreen(
    selectedSymbols: List<String>,
    activeSymbol: String,
    onSymbolSelected: (String) -> Unit,
    marketPrices: StateFlow<Map<String, MarketPrice>> = MutableStateFlow(emptyMap()),
    symbolInfoMap: Map<String, SymbolInfo> = emptyMap(),
    ticker24hMap: Map<String, Ticker24h> = emptyMap(),
    fundingInfoMap: Map<String, FundingInfo> = emptyMap(),
    defaultInterval: String = "15m",
    onSearchSymbols: (String) -> List<SymbolInfo> = { emptyList() },
    onAddSymbolToWatchlist: (String) -> Unit = {},
    onRefreshTicker: (String) -> Unit = {},
    onRefreshFunding: (String) -> Unit = {},
    isFullscreen: Boolean = false,
    onToggleFullscreen: () -> Unit = {},
    webHolder: ChartWebHolder,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val isLandscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    // Landscape is always a full-bleed chart, like exchange apps: the page itself shows symbol and price in its toolbar.
    val immersive = isFullscreen || isLandscape

    val currentSymbol = activeSymbol.ifBlank { selectedSymbols.firstOrNull() ?: "BTCUSDT" }.uppercase()
    val tickSize = symbolInfoMap[currentSymbol]?.tickSize
    val chartInterval = remember(defaultInterval) { ChartInterval.normalize(defaultInterval) }

    // --- 24h change always; the funding details only while the stats row is open ------------------------------------
    var statsExpanded by rememberSaveable { mutableStateOf(false) }
    val ticker24h = ticker24hMap[currentSymbol]
    val fundingInfo = fundingInfoMap[currentSymbol]
    val refreshTicker by rememberUpdatedState(onRefreshTicker)
    val refreshFunding by rememberUpdatedState(onRefreshFunding)
    LaunchedEffect(currentSymbol, statsExpanded, lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                refreshTicker(currentSymbol)
                if (statsExpanded) refreshFunding(currentSymbol)
                // the header's 24h change is live from the stream; the REST stats only matter while the row is open
                delay(if (statsExpanded) TICKER_REFRESH_MS else 300_000L)
            }
        }
    }

    val webViewHolder = webHolder

    // The page stops its sockets/timers (and the WebView itself is frozen) whenever the app is not in the foreground.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> webViewHolder.view?.let { view ->
                    view.evaluateJavascript("window.setActive && window.setActive(false);") {
                        view.onPause()
                        view.pauseTimers()
                    }
                }
                Lifecycle.Event.ON_RESUME -> webViewHolder.view?.let { view ->
                    view.onResume()
                    view.resumeTimers()
                    view.evaluateJavascript("window.setActive && window.setActive(true);", null)
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            // Leaving the chart gives rotation back to the system.
            (context as? Activity)?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    // Hide the system bars while the chart is immersive.
    val hostView = LocalView.current
    DisposableEffect(immersive) {
        val window = (context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, hostView) }
        if (immersive && controller != null) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        }
        onDispose { controller?.show(WindowInsetsCompat.Type.systemBars()) }
    }

    var showSearchSheet by remember { mutableStateOf(false) }

    fun toggleOrientation() {
        val activity = context as? Activity ?: return
        activity.requestedOrientation = if (isLandscape) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        } else {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }
    fun leaveImmersive() {
        if (isFullscreen) onToggleFullscreen() else toggleOrientation()
    }

    BackHandler(enabled = immersive) { leaveImmersive() }
    // Registered last so it wins: Back first closes what is open inside the chart page.
    var chartCanGoBack by remember { mutableStateOf(false) }
    BackHandler(enabled = chartCanGoBack) {
        webViewHolder.view?.evaluateJavascript("window.cfBack && window.cfBack();", null)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(ChartBg)
    ) {
        if (!immersive) {
            LiveChartHeader(
                symbol = currentSymbol,
                marketPrices = marketPrices,
                ticker24h = ticker24h,
                fundingInfo = fundingInfo,
                tickSize = tickSize,
                statsExpanded = statsExpanded,
                onToggleStats = { statsExpanded = !statsExpanded },
                candleClose = webViewHolder.candleClose,
                onSymbolClick = { showSearchSheet = true },
                onRotate = ::toggleOrientation,
                onFullscreen = onToggleFullscreen
            )
        }

        ChartWebView(
            symbol = currentSymbol,
            defaultInterval = chartInterval,
            immersive = immersive,
            holder = webViewHolder,
            onOpenSymbolSearch = { showSearchSheet = true },
            onExitImmersive = ::leaveImmersive,
            onBackState = { chartCanGoBack = it },
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        )
    }

    if (showSearchSheet) {
        SymbolSearchSheet(
            selectedSymbols = selectedSymbols,
            currentSymbol = currentSymbol,
            symbolInfoCount = symbolInfoMap.size,
            onSearchSymbols = onSearchSymbols,
            onAddSymbolToWatchlist = onAddSymbolToWatchlist,
            onSelect = {
                onSymbolSelected(it)
                showSearchSheet = false
            },
            onDismiss = { showSearchSheet = false }
        )
    }
}

// The live price is collected here, so a price tick recomposes only the header, never the chart screen or its WebView.
@Composable
private fun LiveChartHeader(
    symbol: String,
    marketPrices: StateFlow<Map<String, MarketPrice>>,
    ticker24h: Ticker24h?,
    fundingInfo: FundingInfo?,
    tickSize: String?,
    statsExpanded: Boolean,
    onToggleStats: () -> Unit,
    candleClose: CandleClose?,
    onSymbolClick: () -> Unit,
    onRotate: () -> Unit,
    onFullscreen: () -> Unit
) {
    val prices by marketPrices.collectAsState()
    val updown = com.coinfloat.app.ui.theme.LocalUpDown.current
    val currentPrice = prices[symbol]?.price
    val liveChange = prices[symbol]?.dayChangePercent() ?: ticker24h?.priceChangePercent
    val formattedPrice = PriceFormatter.formatPrice(currentPrice, tickSize)
    val livePriceFloat = currentPrice?.toFloat() ?: 0f

    var prevPrice by remember(symbol) { mutableFloatStateOf(0f) }
    var priceColor by remember(symbol) { mutableStateOf(Color.White) }
    LaunchedEffect(livePriceFloat) {
        if (livePriceFloat > 0f) {
            if (prevPrice > 0f) {
                if (livePriceFloat > prevPrice) priceColor = updown.up
                else if (livePriceFloat < prevPrice) priceColor = updown.down
            }
            prevPrice = livePriceFloat
        }
    }
    val animatedPriceColor by animateColorAsState(
        targetValue = priceColor,
        animationSpec = tween(durationMillis = 180),
        label = "PriceColor"
    )
    ChartHeader(
        symbol = symbol,
        formattedPrice = formattedPrice,
        priceColor = animatedPriceColor,
        changePercent = liveChange,
        ticker24h = ticker24h,
        fundingInfo = fundingInfo,
        tickSize = tickSize,
        statsExpanded = statsExpanded,
        onToggleStats = onToggleStats,
        candleClose = candleClose,
        onSymbolClick = onSymbolClick,
        onRotate = onRotate,
        onFullscreen = onFullscreen
    )
}

// ---------------------------------------------------------------------------------------------------
// Header: one line (symbol, price, 24h change); the stats row is folded away until asked for
// ---------------------------------------------------------------------------------------------------

@Composable
internal fun ChartHeader(
    symbol: String,
    formattedPrice: String,
    priceColor: Color,
    changePercent: Float?,
    ticker24h: Ticker24h?,
    fundingInfo: FundingInfo?,
    tickSize: String?,
    statsExpanded: Boolean,
    onToggleStats: () -> Unit,
    candleClose: CandleClose? = null,
    onSymbolClick: () -> Unit,
    onRotate: () -> Unit,
    onFullscreen: () -> Unit
) {
    // The one-line header is dense by design; a large system font scale would truncate the symbol.
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = minOf(density.fontScale, 1.0f))) {
        ChartHeaderContent(symbol, formattedPrice, priceColor, changePercent, ticker24h, fundingInfo, tickSize, statsExpanded, onToggleStats, candleClose, onSymbolClick, onRotate, onFullscreen)
    }
}

@Composable
private fun ChartHeaderContent(
    symbol: String,
    formattedPrice: String,
    priceColor: Color,
    changePercent: Float?,
    ticker24h: Ticker24h?,
    fundingInfo: FundingInfo?,
    tickSize: String?,
    statsExpanded: Boolean,
    onToggleStats: () -> Unit,
    candleClose: CandleClose?,
    onSymbolClick: () -> Unit,
    onRotate: () -> Unit,
    onFullscreen: () -> Unit
) {
    Surface(color = PanelBg) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(42.dp)
                    .padding(start = 12.dp, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
              // symbol + price take the free width (the price block is measured first, the symbol shrinks only when
              // there is truly no room); the buttons stay at the end
              Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(onClick = onSymbolClick)
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = symbol,
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    Text(text = " ▾", color = MutedText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(6.dp))
                // price, then 24h change over the time left in the candle, like exchange tickers; tapping it opens the
                // market stats row (24h high/low, volume, funding)
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(onClickLabel = "시장 정보", onClick = onToggleStats)
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = formattedPrice,
                        color = priceColor,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        maxLines = 1
                    )
                    if (changePercent != null || candleClose != null) {
                        Spacer(Modifier.width(7.dp))
                        Column(verticalArrangement = Arrangement.Center) {
                            if (changePercent != null) ChangeText(changePercent)
                            if (candleClose != null) CandleCountdown(candleClose)
                        }
                    }
                    Icon(
                        if (statsExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                        contentDescription = null,
                        tint = MutedText,
                        modifier = Modifier.padding(start = 2.dp).size(16.dp)
                    )
                }
              }
                HeaderIconButton(Icons.Default.ScreenRotation, "화면 회전", onRotate)
                HeaderIconButton(Icons.Default.Fullscreen, "전체화면", onFullscreen)
            }
            AnimatedVisibility(visible = statsExpanded) {
                Box(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 6.dp)) {
                    StatsRow(ticker24h = ticker24h, fundingInfo = fundingInfo, tickSize = tickSize)
                }
            }
        }
    }
}

/**
 * Time left in the forming candle, next to the price like exchange apps (it used to sit on the price axis, under the
 * last-price label, where it covered the axis prices). Ticks on its own, so only this text recomposes every second.
 */
@Composable
private fun CandleCountdown(close: CandleClose) {
    val lifecycleOwner = LocalLifecycleOwner.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                now = System.currentTimeMillis()
                delay(1000L - now % 1000L)          // on the second boundary, in step with the exchange clock
            }
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = ChartInterval.label(close.interval),
            color = MutedText,
            fontSize = 10.5.sp,
            lineHeight = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1
        )
        Spacer(Modifier.width(3.dp))
        Text(
            text = ChartInterval.formatTimeLeft(close.closeAtMs - now),
            color = MainText,
            fontSize = 10.5.sp,
            lineHeight = 13.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            maxLines = 1
        )
    }
}

@Composable
private fun HeaderIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick, modifier = Modifier.size(34.dp)) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            tint = MutedText,
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun ChangeText(changePercent: Float) {
    val positive = changePercent >= 0f
    val updown = com.coinfloat.app.ui.theme.LocalUpDown.current
    Text(
        text = String.format(Locale.US, "%s%.2f%%", if (positive) "+" else "", changePercent),
        color = if (positive) updown.up else updown.down,
        fontSize = 11.sp,
        lineHeight = 13.sp,
        fontWeight = FontWeight.Bold,
        fontFamily = FontFamily.Monospace,
        maxLines = 1
    )
}

@Composable
private fun StatsRow(ticker24h: Ticker24h?, fundingInfo: FundingInfo?, tickSize: String?) {
    if (ticker24h == null && fundingInfo == null) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (ticker24h != null) {
            Stat("24h 고가", PriceFormatter.formatPrice(ticker24h.highPrice.toBigDecimal(), tickSize))
            Stat("24h 저가", PriceFormatter.formatPrice(ticker24h.lowPrice.toBigDecimal(), tickSize))
            if (ticker24h.quoteVolume > 0f) {
                Stat("거래대금", PriceFormatter.formatCompactVolume(ticker24h.quoteVolume) + " USDT")
            }
        }
        if (fundingInfo != null) {
            FundingStat(fundingInfo)
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(label, color = MutedText, fontSize = 10.sp)
        Text(
            text = value,
            color = MainText,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace
        )
    }
}

/** Funding rate with its own 1 s countdown so the rest of the screen does not recompose every second. */
@Composable
private fun FundingStat(info: FundingInfo) {
    val lifecycleOwner = LocalLifecycleOwner.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                now = System.currentTimeMillis()
                delay(1000L)
            }
        }
    }
    val ratePct = info.fundingRate * 100f
    val positive = ratePct >= 0f
    val diff = (info.nextFundingTime - now).coerceAtLeast(0L)
    val countdown = String.format(
        Locale.US, "%02d:%02d:%02d",
        diff / 3_600_000L, (diff % 3_600_000L) / 60_000L, (diff % 60_000L) / 1000L
    )
    Column {
        Text("펀딩 / 남은 시간", color = MutedText, fontSize = 10.sp)
        Row {
            Text(
                text = String.format(Locale.US, "%s%.4f%%", if (positive) "+" else "", ratePct),
                color = if (positive) com.coinfloat.app.ui.theme.LocalUpDown.current.up else com.coinfloat.app.ui.theme.LocalUpDown.current.down,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = FontFamily.Monospace
            )
            if (info.nextFundingTime > 0L) {
                Text(
                    text = " / $countdown",
                    color = MainText,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }
        }
    }
}


// ---------------------------------------------------------------------------------------------------
// Symbol search
// ---------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SymbolSearchSheet(
    selectedSymbols: List<String>,
    currentSymbol: String,
    symbolInfoCount: Int,
    onSearchSymbols: (String) -> List<SymbolInfo>,
    onAddSymbolToWatchlist: (String) -> Unit,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SymbolInfo>>(emptyList()) }

    // symbolInfoCount re-runs the search once the exchange info finishes loading.
    LaunchedEffect(query, symbolInfoCount) {
        results = if (query.isNotBlank()) onSearchSymbols(query) else emptyList()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = PanelBg,
        contentColor = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text("종목 선택", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text("Binance USDT 무기한 선물", fontSize = 11.sp, color = MutedText)
            Spacer(Modifier.height(10.dp))

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("종목 검색 (예: SOL, XRP, DOGE)", color = MutedText) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = MutedText) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { query = "" }) {
                            Icon(Icons.Default.Clear, contentDescription = "지우기", tint = MutedText)
                        }
                    }
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))

            if (query.isBlank()) {
                Text("관심 종목", fontSize = 12.sp, color = MutedText, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
                    items(selectedSymbols) { sym ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(sym) }
                                .padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = sym,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (sym.equals(currentSymbol, true)) AccentColor else Color.White
                            )
                            Text("차트 열기", fontSize = 12.sp, color = AccentColor)
                        }
                        HorizontalDivider(color = LineColor)
                    }
                }
            } else if (results.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (symbolInfoCount == 0) "종목 목록을 불러오는 중..." else "검색 결과가 없습니다.",
                        color = MutedText,
                        fontSize = 13.sp
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
                    items(results) { item ->
                        val added = selectedSymbols.contains(item.symbol)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(item.symbol) }
                                .padding(vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(item.symbol, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                                Text(
                                    text = "${item.baseAsset} / ${item.quoteAsset} · tick ${item.tickSize}",
                                    fontSize = 11.sp,
                                    color = MutedText
                                )
                            }
                            if (added) {
                                Text("관심종목", fontSize = 11.sp, color = UpColor, fontWeight = FontWeight.Medium)
                            } else {
                                Button(
                                    onClick = { onAddSymbolToWatchlist(item.symbol) },
                                    colors = ButtonDefaults.buttonColors(containerColor = AccentColor),
                                    contentPadding = ButtonDefaults.TextButtonContentPadding,
                                    modifier = Modifier.height(30.dp)
                                ) {
                                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(2.dp))
                                    Text("관심 추가", fontSize = 11.sp)
                                }
                            }
                        }
                        HorizontalDivider(color = LineColor)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

// ---------------------------------------------------------------------------------------------------
// WebView
// ---------------------------------------------------------------------------------------------------

/**
 * Keeps the chart WebView alive while the app is open: leaving the chart tab only pauses the page, so coming back is
 * instant and keeps zoom, scroll, drawings and loaded data (it used to rebuild the page and refetch everything). The
 * page's callbacks go through this holder, so a re-created chart screen never talks to a disposed one.
 */
data class CandleClose(val interval: String, val closeAtMs: Long)

class ChartWebHolder {
    var view: WebView? = null
    var symbol: () -> String = { "BTCUSDT" }
    var interval: () -> String = { ChartInterval.DEFAULT }
    var immersive: () -> Boolean = { false }
    var onOpenSearch: () -> Unit = {}
    var onExitImmersive: () -> Unit = {}
    var onBackState: (Boolean) -> Unit = {}

    /** Interval and close time of the candle the page is forming (null while it loads), for the header countdown. */
    var candleClose by mutableStateOf<CandleClose?>(null)

    fun destroy() {
        view?.destroyChart()
        view = null
    }
}

@Composable
private fun ChartWebView(
    symbol: String,
    defaultInterval: String,
    immersive: Boolean,
    holder: ChartWebHolder,
    onOpenSymbolSearch: () -> Unit,
    onExitImmersive: () -> Unit,
    onBackState: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    // Bumped when the WebView's renderer process dies, which rebuilds the WebView instead of letting
    // Android take the whole app (and the overlay service) down with it.
    var generation by remember { mutableIntStateOf(0) }
    val latestSymbol by rememberUpdatedState(symbol)
    val latestInterval by rememberUpdatedState(defaultInterval)
    val latestImmersive by rememberUpdatedState(immersive)
    val latestOpenSearch by rememberUpdatedState(onOpenSymbolSearch)
    val latestExit by rememberUpdatedState(onExitImmersive)
    val latestBackState by rememberUpdatedState(onBackState)

    // the (long-lived) page always calls back into the screen that is showing it now
    SideEffect {
        holder.symbol = { latestSymbol }
        holder.interval = { latestInterval }
        holder.immersive = { latestImmersive }
        holder.onOpenSearch = { latestOpenSearch() }
        holder.onExitImmersive = { latestExit() }
        holder.onBackState = { latestBackState(it) }
    }

    LaunchedEffect(immersive, generation) {
        holder.view?.evaluateJavascript("window.setImmersive && window.setImmersive($immersive);", null)
    }

    key(generation) {
        AndroidView(
            modifier = modifier,
            factory = { ctx ->
                val kept = holder.view
                if (kept != null) {
                    (kept.parent as? ViewGroup)?.removeView(kept)
                    kept.onResume()
                    kept.resumeTimers()
                    kept.evaluateJavascript("window.setActive && window.setActive(true);", null)
                    kept
                } else {
                    createChartWebView(
                        ctx = ctx,
                        symbol = { holder.symbol() },
                        defaultInterval = { holder.interval() },
                        immersive = { holder.immersive() },
                        onOpenSymbolSearch = { holder.onOpenSearch() },
                        onExitImmersive = { holder.onExitImmersive() },
                        onBackState = { holder.onBackState(it) },
                        onCandleClose = { holder.candleClose = parseCandleClose(it) },
                        onRendererGone = {
                            // the renderer died: throw this WebView away and build a fresh one
                            holder.view?.destroyChart()
                            holder.view = null
                            generation++
                            holder.onBackState(false)
                            holder.candleClose = null
                        }
                    ).also { holder.view = it }
                }
            },
            update = { webView ->
                if (webView.tag != symbol) {
                    webView.tag = symbol
                    webView.loadChart(symbol, defaultInterval)
                }
            },
            onRelease = { webView ->
                // leaving the chart tab: pause the page (sockets, timers), keep it for next time
                if (holder.view === webView) {
                    runCatching {
                        webView.evaluateJavascript("window.setActive && window.setActive(false);", null)
                        webView.onPause()
                        webView.pauseTimers()
                    }
                }
            }
        )
    }
}

internal fun parseCandleClose(arg: String): CandleClose? {
    val parts = arg.split('|')
    if (parts.size != 2) return null
    val at = parts[1].toLongOrNull() ?: return null
    val interval = parts[0].takeIf { ChartInterval.isValid(it) } ?: return null
    return CandleClose(interval, at)
}

private fun WebView.loadChart(symbol: String, interval: String) {
    val safeSymbol = ChartInterval.sanitizeSymbol(symbol)
    val safeInterval = ChartInterval.normalize(interval)
    evaluateJavascript("window.loadSymbol && window.loadSymbol('$safeSymbol','$safeInterval');", null)
}

private fun WebView.destroyChart() {
    try {
        stopLoading()
        removeJavascriptInterface("AndroidBridge")
        (parent as? ViewGroup)?.removeView(this)
        destroy()
    } catch (_: Exception) {
    }
}

/** Calls from the page into the app. */
private class ChartBridge(
    private val webView: WebView,
    private val openSearch: () -> Unit,
    private val exitImmersive: () -> Unit,
    private val backState: (Boolean) -> Unit,
    private val candleClose: (String) -> Unit
) {
    // "<interval>|<close time ms>" of the forming candle, or "" while the page loads
    @JavascriptInterface
    fun candleClose(arg: String?) {
        val value = arg.orEmpty()
        webView.post { candleClose(value) }
    }

    // The page reports whether it has something Back should close first (settings sheet, drawing tool, selection).
    @JavascriptInterface
    fun backState(arg: String?) {
        val consume = arg == "1"
        webView.post { backState(consume) }
    }

    @JavascriptInterface
    fun openSymbolSearch(arg: String?) {
        webView.post { openSearch() }
    }

    @JavascriptInterface
    fun exitImmersive(arg: String?) {
        webView.post { exitImmersive() }
    }
}

@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
private fun createChartWebView(
    ctx: Context,
    symbol: () -> String,
    defaultInterval: () -> String,
    immersive: () -> Boolean,
    onOpenSymbolSearch: () -> Unit,
    onExitImmersive: () -> Unit,
    onBackState: (Boolean) -> Unit,
    onCandleClose: (String) -> Unit,
    onRendererGone: () -> Unit
): WebView {
    val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

    return WebView(ctx).apply {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(android.graphics.Color.parseColor("#131722"))
        overScrollMode = View.OVER_SCROLL_NEVER
        isLongClickable = false
        setOnLongClickListener { true }
        isHapticFeedbackEnabled = false

        // Keep pan/zoom gestures on the chart instead of letting a parent scroll container steal them.
        setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE ->
                    v.parent?.requestDisallowInterceptTouchEvent(true)
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                    v.parent?.requestDisallowInterceptTouchEvent(false)
            }
            false
        }

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // indicator choices and drawings live in localStorage
            // The page is an app asset (still reachable with file access off); it only talks to Binance over
            // https/wss, so no local-file or cross-scheme access is needed.
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            textZoom = 100                      // the dense chart layout must not reflow with the system font scale
        }

        addJavascriptInterface(ChartBridge(this, onOpenSymbolSearch, onExitImmersive, onBackState, onCandleClose), "AndroidBridge")

        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                view?.loadChart(symbol(), defaultInterval())
                view?.evaluateJavascript("window.setImmersive && window.setImmersive(${immersive()});", null)
            }

            // Links must never replace the chart page.
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val req = request ?: return false
                if (!req.isForMainFrame || req.url.scheme == "file") return false
                runCatching {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, req.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                return true
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                onRendererGone()
                return true
            }
        }

        tag = symbol()
        loadUrl(CHART_PAGE_URL)
    }
}
