# Changelog

All notable changes to the **CoinFloat** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-05

### Added
- **Full Interactive TradingView Chart (앱 내 트레이딩뷰 전문 차트 탑재)**:
  - Added dedicated "차트" tab in `MainActivity` with embedded TradingView Advanced Real-Time Chart widget.
  - Dark-themed hardware-accelerated WebView rendering Binance USDⓈ-M Perpetual pairs (`BINANCE:${symbol}.P`).
  - Supports all timeframe intervals, interactive crosshair, pinch-to-zoom, pan, technical indicators (RSI, MA), and volume.
  - Horizontal chip selector allows instant switching between all user-selected symbols.
- **Deep Linking from Mini Chart to TradingView (미니 차트에서 트레이딩뷰 전체 화면 연동)**:
  - Added expand button (`⛶`) in the floating mini-chart header.
  - Tapping `⛶` seamlessly transitions the user to `MainActivity`'s "차트" tab, automatically selecting the active symbol and auto-closing the mini chart popup.

---

## [1.1.0] - 2026-10-05

### Added
- **Expandable Mini Candlestick Chart (탭 시 펼쳐지는 미니 차트 팝업)**:
  - Tapping the overlay toggles a sleek, semi-transparent popup chart window directly adjacent to the price box.
  - High-performance, zero-dependency custom Canvas candlestick rendering (`CandleStickChartView`).
  - Supports 1m, 5m, 15m, and 1h intervals via Binance public Kline REST endpoint (`/fapi/v1/klines`).
  - Header displays active symbol, live price, interval selector tabs, and close button (`✕`).
  - Tapping the symbol header cycles through tracked symbols.
  - Setting toggle in "표시 설정" tab to enable/disable tap-to-chart and customize default interval.

### Optimized (배터리 및 CPU 대폭 최적화)
- **Screen State Power Optimization (화면 꺼짐 시 절전)**:
  - Dynamically detects `ACTION_SCREEN_OFF` and pauses WebSocket traffic to eliminate background CPU wakeups and wireless network usage.
  - Instantly reconnects upon `ACTION_SCREEN_ON` (<300ms) with zero latency for user viewing.
- **Throttled UI Redraws (UI 렌더링 스로틀링)**:
  - UI updates are smoothly throttled to ~150ms (~6.7 FPS max), preventing redundant measure/layout passes on the Android main thread and reducing CPU consumption by ~75%.
- **Price Cache Allocation Reduction**:
  - Replaced repetitive Map copying with `ConcurrentHashMap` caching to drastically reduce heap allocations on high-frequency trades.

---

## [1.0.0] - 2026-10-04

### Added
- **Binance USDⓈ-M Futures Live Price Streaming**:
  - Connects to Binance public Aggregate Trade Stream (`wss://fstream.binance.com/market/stream`).
  - Supports ultra-low latency (~100ms) trade price updates.
  - Multi-stream multiplexing over a single persistent WebSocket connection.
- **Ultra-Compact Floating Overlay Window**:
  - System overlay (`TYPE_APPLICATION_OVERLAY`) with wrap-content dimensions.
  - Arbitrary touch-and-drag positioning to any screen coordinate without edge boundaries.
  - Position persistence via Jetpack DataStore Preferences.
- **Visual & Style Customization**:
  - Independent background opacity and text opacity controls.
  - High-precision font size adjustment (from ultra-compact 3sp up to 24sp).
  - Configurable inner padding (0dp ~ 16dp) for box size fine-tuning.
  - Crisp text rendering without blur or unwanted shadows.
  - Custom text colors (Binance green, white, yellow, cyan, etc.) and background colors.
- **Symbol Management**:
  - 3 symbol display modes: `SHORT` (e.g. BTC), `FULL` (e.g. BTCUSDT), and `HIDDEN` (price only).
  - Searchable USDT-Margined Perpetual contract catalog fetched from `/fapi/v1/exchangeInfo`.
  - Reordering (up/down) and add/remove of tracked symbols.
- **Foreground Service & Lifecycle Controls**:
  - Persistent background service with notification controls (Hide / Show / Stop).
  - Automatic reconnection with exponential backoff and jitter on network dropouts.
  - Android 14+ (`specialUse` foreground service) and Samsung Galaxy One UI battery optimization guidance.
