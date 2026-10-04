package com.coinfloat.app.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TradingViewChartScreen(
    selectedSymbols: List<String>,
    activeSymbol: String,
    onSymbolSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val currentSymbol = if (activeSymbol.isNotBlank()) activeSymbol else selectedSymbols.firstOrNull() ?: "BTCUSDT"
    var isLoading by remember { mutableStateOf(true) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF131722)) // Authentic TradingView dark canvas
    ) {
        // 1. Symbol Selection Chips Header
        Surface(
            color = Color(0xFF1E222D),
            shadowElevation = 4.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "TradingView",
                            color = Color(0xFF2962FF), // TradingView signature blue
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Binance Futures (${currentSymbol.uppercase()})",
                            color = Color(0xFFD1D4DC),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFF2A2E39))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "USDT-M",
                            color = Color(0xFFF0B90B), // Binance Gold
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Scrollable symbols chips
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    selectedSymbols.forEach { symbol ->
                        val isSelected = symbol.equals(currentSymbol, ignoreCase = true)
                        val chipBg = if (isSelected) Color(0xFF2962FF) else Color(0xFF2A2E39)
                        val chipText = if (isSelected) Color.White else Color(0xFFB2B5BE)
                        val borderStroke = if (isSelected) Color(0xFF5B8DEF) else Color.Transparent

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(16.dp))
                                .background(chipBg)
                                .border(1.dp, borderStroke, RoundedCornerShape(16.dp))
                                .clickable { onSymbolSelected(symbol) }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = symbol.uppercase(),
                                color = chipText,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        }

        // 2. Interactive TradingView Chart WebView
        Box(
            modifier = Modifier
                .fillMaxSize()
                .weight(1f)
        ) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        setLayerType(View.LAYER_TYPE_HARDWARE, null)
                        setBackgroundColor(android.graphics.Color.parseColor("#131722"))
                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            databaseEnabled = true
                            loadWithOverviewMode = true
                            useWideViewPort = true
                            cacheMode = WebSettings.LOAD_DEFAULT
                            builtInZoomControls = false
                            displayZoomControls = false
                            setSupportZoom(true)
                        }
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                isLoading = true
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                isLoading = false
                            }
                        }
                        webChromeClient = WebChromeClient()
                        loadDataWithBaseURL(
                            "https://www.tradingview.com",
                            buildTradingViewHtml(currentSymbol),
                            "text/html",
                            "UTF-8",
                            null
                        )
                    }
                },
                update = { webView ->
                    val tag = webView.tag as? String
                    if (tag != currentSymbol) {
                        webView.tag = currentSymbol
                        webView.loadDataWithBaseURL(
                            "https://www.tradingview.com",
                            buildTradingViewHtml(currentSymbol),
                            "text/html",
                            "UTF-8",
                            null
                        )
                    }
                },
                modifier = Modifier.fillMaxSize()
            )

            // Loading Overlay Indicator
            if (isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFF131722).copy(alpha = 0.7f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            color = Color(0xFF2962FF),
                            modifier = Modifier.size(36.dp)
                        )
                        Text(
                            text = "트레이딩뷰 차트 로딩 중...",
                            color = Color(0xFF848E9C),
                            fontSize = 12.sp
                        )
                    }
                }
            }
        }
    }
}

private fun buildTradingViewHtml(symbol: String): String {
    val clean = symbol.trim().uppercase()
    val tvSymbol = if (clean.endsWith("USDT")) {
        "BINANCE:${clean}.P"
    } else {
        "BINANCE:$clean"
    }

    return """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                html, body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    background-color: #131722;
                    overflow: hidden;
                }
                #tv_chart_container {
                    width: 100%;
                    height: 100%;
                }
            </style>
        </head>
        <body>
            <div id="tv_chart_container"></div>
            <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
            <script type="text/javascript">
                new TradingView.widget({
                    "autosize": true,
                    "symbol": "$tvSymbol",
                    "interval": "15",
                    "timezone": "Asia/Seoul",
                    "theme": "dark",
                    "style": "1",
                    "locale": "kr",
                    "toolbar_bg": "#1E222D",
                    "enable_publishing": false,
                    "allow_symbol_change": true,
                    "container_id": "tv_chart_container",
                    "hide_side_toolbar": false,
                    "studies": [
                        "MASimple@tv-basicstudies",
                        "RSI@tv-basicstudies"
                    ]
                });
            </script>
        </body>
        </html>
    """.trimIndent()
}
