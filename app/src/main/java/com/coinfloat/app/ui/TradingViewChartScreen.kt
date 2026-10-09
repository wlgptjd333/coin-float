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
private val PanelBg = Color(0xFF1E222D)
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
    marketPrices: Map<String, MarketPrice> = emptyMap(),
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

    // --- live price (native 100 ms stream) -------------------------------------------------------
    val currentPrice = marketPrices[currentSymbol]?.price
    val formattedPrice = PriceFormatter.formatPrice(currentPrice, tickSize)
    val livePriceFloat = currentPrice?.toFloat() ?: 0f

    var prevPrice by remember(currentSymbol) { mutableFloatStateOf(0f) }
    var priceColor by remember(currentSymbol) { mutableStateOf(Color.White) }
    LaunchedEffect(livePriceFloat) {
        if (livePriceFloat > 0f) {
            if (prevPrice > 0f) {
                if (livePriceFloat > prevPrice) priceColor = UpColor
                else if (livePriceFloat < prevPrice) priceColor = DownColor
            }
            prevPrice = livePriceFloat
        }
    }
    val animatedPriceColor by animateColorAsState(
        targetValue = priceColor,
        animationSpec = tween(durationMillis = 180),
        label = "PriceColor"
    )

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
                delay(TICKER_REFRESH_MS)
            }
        }
    }

    val webViewHolder = remember { WebViewHolder() }

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

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(ChartBg)
    ) {
        if (!immersive) {
            ChartHeader(
                symbol = currentSymbol,
                formattedPrice = formattedPrice,
                priceColor = animatedPriceColor,
                ticker24h = ticker24h,
                fundingInfo = fundingInfo,
                tickSize = tickSize,
                statsExpanded = statsExpanded,
                onToggleStats = { statsExpanded = !statsExpanded },
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

// ---------------------------------------------------------------------------------------------------
// Header: one line (symbol, price, 24h change); the stats row is folded away until asked for
// ---------------------------------------------------------------------------------------------------

@Composable
private fun ChartHeader(
    symbol: String,
    formattedPrice: String,
    priceColor: Color,
    ticker24h: Ticker24h?,
    fundingInfo: FundingInfo?,
    tickSize: String?,
    statsExpanded: Boolean,
    onToggleStats: () -> Unit,
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
                Spacer(Modifier.width(10.dp))
                Text(
                    text = formattedPrice,
                    color = priceColor,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1
                )
                if (ticker24h != null) {
                    Spacer(Modifier.width(8.dp))
                    ChangeBadge(ticker24h.priceChangePercent)
                }
                Spacer(Modifier.weight(1f))
                HeaderIconButton(
                    if (statsExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    "시장 정보", onToggleStats
                )
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
private fun ChangeBadge(changePercent: Float) {
    val positive = changePercent >= 0f
    val color = if (positive) UpColor else DownColor
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 5.dp, vertical = 1.dp)
    ) {
        Text(
            text = String.format(Locale.US, "%s%.2f%%", if (positive) "+" else "", changePercent),
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace
        )
    }
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
                color = if (positive) UpColor else DownColor,
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

private class WebViewHolder {
    var view: WebView? = null
}

@Composable
private fun ChartWebView(
    symbol: String,
    defaultInterval: String,
    immersive: Boolean,
    holder: WebViewHolder,
    onOpenSymbolSearch: () -> Unit,
    onExitImmersive: () -> Unit,
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

    LaunchedEffect(immersive, generation) {
        holder.view?.evaluateJavascript("window.setImmersive && window.setImmersive($immersive);", null)
    }

    key(generation) {
        AndroidView(
            modifier = modifier,
            factory = { ctx ->
                createChartWebView(
                    ctx = ctx,
                    symbol = { latestSymbol },
                    defaultInterval = { latestInterval },
                    immersive = { latestImmersive },
                    onOpenSymbolSearch = { latestOpenSearch() },
                    onExitImmersive = { latestExit() },
                    onRendererGone = { generation++ }
                ).also { holder.view = it }
            },
            update = { webView ->
                if (webView.tag != symbol) {
                    webView.tag = symbol
                    webView.loadChart(symbol, defaultInterval)
                }
            },
            onRelease = { webView ->
                if (holder.view === webView) holder.view = null
                webView.destroyChart()
            }
        )
    }
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
    private val exitImmersive: () -> Unit
) {
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
    onRendererGone: () -> Unit
): WebView {
    val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

    return WebView(ctx).apply {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setLayerType(View.LAYER_TYPE_HARDWARE, null)
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
        }

        addJavascriptInterface(ChartBridge(this, onOpenSymbolSearch, onExitImmersive), "AndroidBridge")

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
