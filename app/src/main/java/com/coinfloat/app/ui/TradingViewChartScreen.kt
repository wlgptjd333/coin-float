package com.coinfloat.app.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
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
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.market.SymbolInfo

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TradingViewChartScreen(
    selectedSymbols: List<String>,
    activeSymbol: String,
    onSymbolSelected: (String) -> Unit,
    marketPrices: Map<String, MarketPrice> = emptyMap(),
    symbolInfoMap: Map<String, SymbolInfo> = emptyMap(),
    isFullscreen: Boolean = false,
    onToggleFullscreen: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val currentSymbol = if (activeSymbol.isNotBlank()) activeSymbol else selectedSymbols.firstOrNull() ?: "BTCUSDT"
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Live Price state
    val currentMarketPrice = marketPrices[currentSymbol] ?: marketPrices[currentSymbol.uppercase()]
    val currentInfo = symbolInfoMap[currentSymbol] ?: symbolInfoMap[currentSymbol.uppercase()]
    val formattedPrice = PriceFormatter.formatPrice(currentMarketPrice?.price, currentInfo?.tickSize)
    val livePriceFloat = currentMarketPrice?.price?.toFloat() ?: 0f

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
        animationSpec = tween(durationMillis = 200),
        label = "PriceColor"
    )

    // Chart Engine Mode: "tv" (TradingView) vs "fast" (100ms ultra speed)
    var chartMode by remember { mutableStateOf("tv") }
    // Selected interval: "1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"
    var activeInterval by remember { mutableStateOf("15m") }

    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    // Battery Optimization: Pause WebView JS and timers when not visible or app backgrounded
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

    // Bridge 100ms live ticks directly into chart.html
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
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        // Row 1: Symbol Name, 100ms Live Price, Mode Toggle, Fullscreen & Rotate
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Left: Symbol Name & 100ms Live Price
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = currentSymbol.uppercase(),
                                            color = Color.White,
                                            fontSize = 15.sp,
                                            fontWeight = FontWeight.Bold,
                                            fontFamily = FontFamily.Monospace
                                        )
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(Color(0xFF2A2E39))
                                                .padding(horizontal = 4.dp, vertical = 1.dp)
                                        ) {
                                            Text(
                                                text = "선물 PERP",
                                                color = Color(0xFFF0B90B),
                                                fontSize = 9.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = formattedPrice,
                                        color = animatedPriceColor,
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Black,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            }

                            // Right: Engine Mode Selector & Fullscreen Actions
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                // Mode Toggle Button
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
                                        .padding(horizontal = 8.dp, vertical = 4.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            imageVector = if (chartMode == "fast") Icons.Default.Speed else Icons.Default.Star,
                                            contentDescription = null,
                                            tint = if (chartMode == "fast") Color(0xFF0ECB81) else Color(0xFF2962FF),
                                            modifier = Modifier.size(12.dp)
                                        )
                                        Spacer(modifier = Modifier.width(3.dp))
                                        Text(
                                            text = if (chartMode == "fast") "초고속 100ms" else "트레이딩뷰",
                                            color = if (chartMode == "fast") Color(0xFF0ECB81) else Color(0xFF2962FF),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }

                                // Landscape Rotation Button
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
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.ScreenRotation,
                                        contentDescription = "회전",
                                        tint = Color(0xFFB2B5BE),
                                        modifier = Modifier.size(18.dp)
                                    )
                                }

                                // Fullscreen Button
                                IconButton(
                                    onClick = onToggleFullscreen,
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Fullscreen,
                                        contentDescription = "전체화면",
                                        tint = Color(0xFF2962FF),
                                        modifier = Modifier.size(20.dp)
                                    )
                                }

                                // Web TradingView External Link
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
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.OpenInBrowser,
                                        contentDescription = "외부 웹",
                                        tint = Color(0xFF848E9C),
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(6.dp))

                        // Row 2: Timeframe Quick Pills (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
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
                                        .padding(horizontal = 9.dp, vertical = 4.dp),
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
                        }

                        Spacer(modifier = Modifier.height(6.dp))

                        // Row 3: Symbol Chips with Mini Price Tags
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            selectedSymbols.forEach { symbol ->
                                val isSelected = symbol.equals(currentSymbol, ignoreCase = true)
                                val chipPrice = marketPrices[symbol]?.price ?: marketPrices[symbol.uppercase()]?.price
                                val chipPriceStr = if (chipPrice != null) PriceFormatter.formatPrice(chipPrice, "0.01") else ""

                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(if (isSelected) Color(0xFF2962FF) else Color(0xFF252932))
                                        .border(
                                            1.dp,
                                            if (isSelected) Color(0xFF5B8DEF) else Color.Transparent,
                                            RoundedCornerShape(14.dp)
                                        )
                                        .clickable {
                                            onSymbolSelected(symbol)
                                            webViewRef?.evaluateJavascript("window.loadSymbol('$symbol', '${timeframes.find { it.first == activeInterval }?.second ?: "15"}');", null)
                                        }
                                        .padding(horizontal = 10.dp, vertical = 4.dp),
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
                        }
                    }
                }
            }

            // High-Performance Android WebView
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
                                setSupportZoom(true)
                            }

                            webViewClient = object : WebViewClient() {
                                override fun onPageFinished(view: WebView?, url: String?) {
                                    super.onPageFinished(view, url)
                                    val code = timeframes.find { it.first == activeInterval }?.second ?: "15"
                                    view?.evaluateJavascript("window.loadSymbol('$currentSymbol', '$code');", null)
                                    view?.evaluateJavascript("window.setChartMode('$chartMode');", null)
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
        }

        // Fullscreen Mode Floating Action Bar (Exit, Rotate, Price Tag)
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
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "${currentSymbol.uppercase()} $formattedPrice",
                        color = animatedPriceColor,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )

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
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ScreenRotation,
                            contentDescription = "회전",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    IconButton(
                        onClick = onToggleFullscreen,
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF2962FF))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "전체화면 종료",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        }
    }
}
