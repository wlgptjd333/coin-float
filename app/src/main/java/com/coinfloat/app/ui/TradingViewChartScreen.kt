package com.coinfloat.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.ConsoleMessage
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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
    val context = LocalContext.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF131722)) // TradingView dark canvas
    ) {
        // 1. Symbol Selection Chips & Header Bar
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
                            text = "Binance (${currentSymbol.uppercase()})",
                            color = Color(0xFFD1D4DC),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
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

                        Spacer(modifier = Modifier.width(6.dp))

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF2962FF))
                                .clickable {
                                    val clean = currentSymbol.trim().uppercase()
                                    val sym = if (clean.endsWith("USDT")) "BINANCE:${clean}.P" else "BINANCE:$clean"
                                    val intent = Intent(
                                        Intent.ACTION_VIEW,
                                        Uri.parse("https://kr.tradingview.com/chart/?symbol=$sym")
                                    )
                                    context.startActivity(intent)
                                }
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = "웹 정식차트 ↗",
                                color = Color.White,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
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

        // 2. High-Performance TradingView Lightweight Chart WebView
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        layoutParams = android.view.ViewGroup.LayoutParams(
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        WebView.setWebContentsDebuggingEnabled(true)
                        setBackgroundColor(android.graphics.Color.parseColor("#131722"))
                        tag = currentSymbol

                        val cookieManager = android.webkit.CookieManager.getInstance()
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
                            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                                super.onPageStarted(view, url, favicon)
                                android.util.Log.e("CoinFloat_TV", "onPageStarted: $url")
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                super.onPageFinished(view, url)
                                android.util.Log.e("CoinFloat_TV", "onPageFinished: $url")
                                view?.evaluateJavascript("window.loadSymbol('$currentSymbol');", null)
                            }

                            override fun onReceivedError(
                                view: WebView?,
                                request: android.webkit.WebResourceRequest?,
                                error: android.webkit.WebResourceError?
                            ) {
                                super.onReceivedError(view, request, error)
                                android.util.Log.e(
                                    "CoinFloat_TV",
                                    "onReceivedError: ${error?.description} (${error?.errorCode}) url: ${request?.url}"
                                )
                            }

                            override fun onReceivedHttpError(
                                view: WebView?,
                                request: android.webkit.WebResourceRequest?,
                                errorResponse: android.webkit.WebResourceResponse?
                            ) {
                                super.onReceivedHttpError(view, request, errorResponse)
                                android.util.Log.e(
                                    "CoinFloat_TV",
                                    "onReceivedHttpError: ${errorResponse?.statusCode} url: ${request?.url}"
                                )
                            }
                        }

                        webChromeClient = object : WebChromeClient() {
                            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                                android.util.Log.e(
                                    "CoinFloat_TV",
                                    "[JS] ${consoleMessage?.message()} (line ${consoleMessage?.lineNumber()})"
                                )
                                return true
                            }
                        }

                        loadUrl("file:///android_asset/chart.html")
                    }
                },
                update = { webView ->
                    val tag = webView.tag as? String
                    if (tag != currentSymbol) {
                        webView.tag = currentSymbol
                        webView.evaluateJavascript("window.loadSymbol('$currentSymbol');", null)
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}
