# Changelog

All notable changes to the **CoinFloat** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.6.0] - 2026-10-10

### Added
- **Bid / Ask**: best bid and ask lines with price/size tags, spread and (with walls/heatmap on) book imbalance. Free
  Binance public book-ticker data.
- **Merge lower panes**: RSI, MACD, CVD, OI and liquidations can share a single pane (chart settings or indicator list).
  Every lower pane has a tag row with name, settings and close.
- **Candle countdown** under the last-price label on the axis; the OHLC line is collapsible (tap the chevron, or hold the
  crosshair) so the indicator values no longer eat chart space.
- Drawings: hide/show all, undo after delete, style bar. Android Back closes sheets / tools / selection inside the chart first.
- Connection banner when the live feed drops, offline hint.
- About card: open-source licenses, privacy policy and a not-investment-advice notice. PRIVACY.md, THIRD_PARTY_NOTICES.md.

### Changed
- **Large trades no longer cover the chart**: bubbles fade out after a configurable time (default 15 min), smaller and more
  transparent by default, optional "sum per candle" (one buy + one sell bubble per candle) and outline-only style.
  Liquidation bubbles fade the same way (default 1 h).
- **Heatmap is readable**: sampling follows the candle interval, the current book is carried across the empty history so
  it is visible at once, three palettes, sensitivity/opacity, a color key, and history survives price re-centering.
- Release builds are minified (R8 + resource shrinking): APK 11 MB -> 1.6 MB.
- CI: unit tests, lint, release build and script syntax check on every push; release workflow only attaches an APK to a
  release when a stable signing key is configured (otherwise every CI build would be signed with a different throw-away key and
  could not update an installed copy).
- Header ignores the system font scale so the symbol is no longer truncated; chart text size is fixed.

### Fixed
- Candle/price panes: OHLC legend can be read over busy overlays (soft backdrop).

## [1.5.0] - 2026-10-10

### Added
- **Per-indicator settings.** Every indicator has its own ⚙ sheet (indicator list, or the gear in the chart toolbar for the
  chart itself) with live preview: colors, line width, periods, levels, fills and more. Bollinger bands: period,
  deviation, band/mid colors, width, band fill. MA/EMA: period, SMA/EMA type, color and width per line. RSI, MACD, CVD,
  OI, liquidations, large trades, wall profile, heatmap and liquidation map each have their own options.
- **Price axis zoom** - drag the price axis up/down to scale it (finger or mouse); drag the chart body vertically to move
  the price range (can be switched off); double-tap the axis to reset.
- Compact **A** (auto-fit) and **L** (log scale) buttons in the corner under the price axis.
- Chart settings: red/blue ("Korean") or custom candle colors, hollow candles, black background, grid, magnet crosshair,
  % scale, margins, legend detail, last-price line.
- Selected drawings get a small style bar (color, thickness, dash, delete).

### Fixed
- **Order-book walls no longer blink.** Re-syncing the book keeps the old picture until the new one is ready, walls must
  persist 1.2 s and linger briefly, depth bars sit on a fixed price grid and the scale changes smoothly.
- **Walls on the wrong side of the price.** Buy walls are only shown under the market and sell walls above it; bars
  never reach across the best bid/ask and a crossed book is repaired instead of drawn.
- Wall labels sit next to the bar (not on top of it) as small text with a halo.
- Open-interest and liquidation panes could shift every overlay on 1m/3m/1w charts (their timestamps were not on the
  candle grid).
- Volume-style panes show compact axis labels (7.63B) instead of 7,625,082,330.90.
- The TradingView logo is removed from the chart; the required attribution is in the chart settings sheet and README.

## [1.4.0] - 2026-10-10

### Changed
- **In-app chart rebuilt without TradingView's widget.** It now runs on TradingView's open-source `lightweight-charts`
  engine bundled in the app: it works offline, uses far less battery and no longer shows duplicated timeframe/tool bars.
  - One-line native header (symbol, live price, 24h change); funding/high/low/turnover fold away behind a chevron.
  - Slim in-chart toolbar: scrollable intervals (1m-1W), chart type (candle, Heikin-Ashi, line, area), indicators.
  - **Drawing tools sit in a rail with a collapse arrow** - folded away the chart uses the full width. Trend line,
    horizontal line, Fibonacci, rectangle, measure; select/move/delete; saved per symbol, anchored to time and price.
  - Landscape/fullscreen give the chart the whole window and hide the system bars.
- **Moving averages: 5, 10, 50, 100, 200, 400** in red, yellow, green, blue, white and purple (periods and on/off per
  line in the indicator sheet). Long averages no longer squash the candles.
- Order flow & market data (all from Binance public USDT-M data, only active while switched on and the chart is visible):
  CVD + per-candle delta, open interest, live liquidations (bubbles + long/short volume), large-trade bubbles,
  order-book walls with depth profile, liquidity heatmap, and a modelled liquidation map (labelled as an estimate).
- Other indicators: EMA 20/50, Bollinger bands, RSI, MACD, volume.

### Battery
- The price publisher no longer wakes the CPU every 100 ms around the clock; it is event driven.
- The market feed now pauses while the overlay is hidden (it previously kept streaming for nothing) as well as while
  the screen is off; it resumes on show / screen on.
- Overlay rows that did not change are not re-formatted; the notification is only re-posted when it changed.
- Chart page stops all sockets and timers whenever the app is in the background.

### Fixed
- WebSocket: a late `onClosed`/`onFailure` from a replaced socket could tear down the new connection or schedule a
  needless reconnect (e.g. quick screen off/on).
- Overlay froze after Hide -> screen off/on -> Show because the feed was never resumed.
- Symbol list edits (add / remove / move up / move down) could lose updates when tapped quickly.
- `MainActivity` re-applied the launch tab/symbol after every recreation; rotation no longer reloads the chart.
- Prices of low-priced coins were shown with 2 decimals in the status tab; mini-chart axis labels showed `0.0000`
  for sub-cent coins.
- Mini chart: out-of-order kline responses could show another symbol/interval's candles.
- Overlay is re-clamped into the screen after rotation and dimmed while the market feed is disconnected.
- WebView: a renderer crash no longer takes the whole app (and the overlay service) down; links cannot replace the
  chart page; WebView is destroyed when leaving the chart tab; DevTools only in debuggable builds; file/universal
  access disabled.
- Settings sliders no longer lag/jump; the live-price flag shared between coroutines is atomic.

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
