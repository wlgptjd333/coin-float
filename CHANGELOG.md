# Changelog

All notable changes to the **CoinFloat** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.1] - 2026-10-11

### Changed
- **Mini chart candles are fully live.** While a mini chart is open it subscribes to Binance's candle stream for that coin
  and interval (a few updates per second), so the forming candle's volume and exact high/low are live too. 1.9.0 built the
  candle from the price stream only, so volume and the extreme wicks waited for the once-a-minute REST refresh. The stream
  is dropped as soon as the chart closes; REST now only loads the history and runs as a 5-minute safety refresh.

## [1.9.0] - 2026-10-11

### Floating window
- **24h change next to the price** (setting "24시간 등락률 함께 표시"), colored up/down. The option already existed in
  the saved settings but nothing showed it. It comes live from Binance's mini-ticker stream (1 message/s per coin, far
  lighter than the trade stream), and the home watchlist uses the same live value.
- **Tapping a row opens that coin's mini chart** (it always opened the first coin); tapping another row while the chart is
  open switches coins, tapping the same one closes it.
- Dropped near a screen edge, the window snaps flush to it.

### Mini chart
- **The forming candle rolls over live**: a new candle opens from the price stream when its period starts, instead of the
  last candle stretching until the next REST refresh.
- Volume bars under the candles, and as many candles as the window is wide (80 loaded, about 5 dp each).
- Touching a candle shows time and OHLC inside the chart; the header keeps the live price and 24h change.
- The chart window keeps a nearly opaque background so it stays readable with a see-through price box.
- The header only redraws when its text changes; "BTCUSDT ›" hints that a tap switches coins.

### Battery
- The mini chart refreshes from REST once a minute instead of every 15 s (the live candle no longer depends on it).
- The home screen's REST 24h snapshot runs every 5 minutes instead of every minute (the stream keeps it live).

### Developer
- Screenshot tests also render the floating price window and the mini chart.

## [1.8.0] - 2026-10-11

### Changed - redesigned app
- **One dark design for the whole app**, matching the chart: the screens used Material You wallpaper colors and the
  system light/dark mode, so on most phones they were white with random accent colors next to a dark chart and a dark
  status bar. The window is dark from the first frame (no white flash at launch).
- **Bottom navigation** (홈 · 차트 · 종목 · 설정) instead of five top tabs; the guide tab is now part of settings.
- **Home**: status pill (실시간 / 연결 중 / 꺼짐), switches for the floating window and its visibility, and a watchlist
  with live prices, 24h change and coin badges; tap a coin to open its chart. Prices now stream on the home screen even
  while the floating window is off.
- **Symbols**: search field with results and one-tap add; your list with reorder and remove.
- **Settings**: grouped list with a live preview of the floating window, segmented controls instead of long radio lists,
  color swatches with a custom HEX option, refresh rate with a plain-language hint, mini chart, a stability guide
  (Samsung / Android 13+) and app info (version, licenses, privacy) as dialogs.
- Permission notices are calm amber cards with a short "허용이 안 될 때" guide instead of a red error box.
- Prices use tabular digits, so they do not jitter while ticking.
- Chart: the header is flush with the chart; lower-pane tags show only the name (tap for settings / close); the heatmap
  color key appears for a few seconds after switching it on instead of staying on screen.

### Fixed
- Switching tabs could open a tab already scrolled down (all tabs shared one scroll position).

### Developer
- Paparazzi screenshot tests render every screen on the JVM (`./gradlew :app:recordPaparazziDebug`), so the UI can be
  reviewed without a device.

## [1.7.0] - 2026-10-11

### Battery / heat
- **App screens no longer redraw 10 times a second.** The live price was read at the top of the whole settings screen, so
  every tick recomposed the entire UI (chart tab included). Prices now reach the screens at most 4 times a second and only
  the card or header that shows them updates; nothing flows while no screen is visible.
- **Overlay default refresh is 5 FPS** (was 10). It still reads as live, but the always-on window is redrawn half as often.
  An explicit choice in the display settings is kept.
- **The feed stays paused on the lock screen.** It used to resume on screen-on even though the overlay cannot be seen
  behind the lock screen; it now waits for the unlock.
- Chart WebView: removed a forced hardware layer that added an extra GPU copy to every frame.
- Chart page: repaints caused by data feeds are merged (at most 4 per second), the forming candle is applied at most every
  0.4 s, the legend and countdown only touch the DOM when their text changes, depth bars are re-binned only when the book or
  the visible range changes, and large-trade sizes use a ring buffer instead of shifting a 2,000-item array per trade.
- **Bid/Ask uses the top-5 book (2 updates/s)** instead of the book ticker, which sends about 250 messages per second for
  BTC that the page had to parse.

### Added
- **Volume profile (매물대)**: volume by price for the visible (or all loaded) candles, buy/sell split, POC line and 70 %
  value area, with its own settings.
- Intervals **6h, 12h, 3D, 1M** (month candles count down to the real month end).
- Drawing tools **ray (연장선)** and **vertical line (수직선)**.

### Fixed
- Heatmap colors were scaled against the median row; the dense rows next to the price then saturated and covered the
  candles. They are now relative to the 90th percentile and never fully opaque, so only real walls turn warm.
- Lower panes kept snapping back to their default height whenever any setting changed.
- The drawing rail was cut off in landscape; it scrolls now.

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
