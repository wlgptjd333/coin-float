(function () {
'use strict';

// =====================================================================================================
// Constants & small helpers
// =====================================================================================================
var C = { up: '#0ECB81', down: '#F6465D', bg: '#131722', grid: '#1E222D', text: '#848E9C', border: '#2A2E39', accent: '#2962FF', gold: '#F0B90B' };
var INTERVALS = [
    ['1m', '1m', 60], ['3m', '3m', 180], ['5m', '5m', 300], ['15m', '15m', 900], ['30m', '30m', 1800],
    ['1h', '1h', 3600], ['2h', '2h', 7200], ['4h', '4h', 14400], ['1d', '1D', 86400], ['1w', '1W', 604800]
];
var SEC = {}; INTERVALS.forEach(function (i) { SEC[i[0]] = i[2]; });
var REST = 'https://fapi.binance.com/fapi/v1/klines';
var WS_URL = 'wss://fstream.binance.com/market/stream';
var MAX_BARS = 3000;
// Multiple moving averages: periods are in candles of the current interval. Colors: red, yellow, green, blue, white, purple.
var MA_DEFAULT = [[5, '#F6465D'], [10, '#F0B90B'], [50, '#0ECB81'], [100, '#2962FF'], [200, '#FFFFFF'], [400, '#B388FF']];
var EMA_P = [20, 50], EMA_COL = ['#FF9800', '#2962FF'];
var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('cf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('cf.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
function $(id) { return document.getElementById(id); }
function bridge(name, arg) {
    try { if (window.AndroidBridge && typeof window.AndroidBridge[name] === 'function') window.AndroidBridge[name](arg == null ? '' : String(arg)); } catch (e) { /* ignore */ }
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }

// =====================================================================================================
// State
// =====================================================================================================
var symbol = 'BTCUSDT';
var interval = normInterval(LS.get('interval', '15m'));
var chartType = LS.get('type', 'candle');                       // candle | ha | line | area
var ind = Object.assign({
    vol: true, ma: true, ema: false, boll: false, rsi: false, macd: false,
    cvd: false, oi: false, liq: false, trades: false, depth: false, heat: false, liqmap: false
}, LS.get('ind', {}));
var maCfg = (function () {
    var saved = LS.get('ma6', null);
    return MA_DEFAULT.map(function (d, k) {
        var s = saved && saved[k] ? saved[k] : {};
        return { p: s.p > 0 ? Math.min(2000, Math.floor(s.p)) : d[0], c: d[1], on: s.on !== false };
    });
})();
var railOpen = LS.get('rail', false);
var active = true, immersive = false, started = false;
var precision = 2;

var candles = [];            // { time(sec), open, high, low, close, volume, buy(taker-buy volume) }
var haBars = [];             // heikin-ashi view of candles (same indexes)
var loadSeq = 0, loadingOlder = false, noMoreOlder = false;

function normInterval(v) { v = String(v || '').toLowerCase(); return SEC[v] ? v : '15m'; }
function curSec() { return SEC[interval] || 900; }

// =====================================================================================================
// Formatting
// =====================================================================================================
function fmtPrice(p) {
    if (p == null || isNaN(p)) return '—';
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}
function fmtVol(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(2);
}
function tickFmt(time, type) {
    var d = new Date(time * 1000);
    switch (type) {
        case 0: return String(d.getFullYear());
        case 1: return (d.getMonth() + 1) + '월';
        case 2: return d.getDate() + '일';
        default: return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
}
function crosshairTimeFmt(time) {
    var d = new Date(time * 1000);
    var date = (d.getMonth() + 1) + '/' + d.getDate();
    return curSec() >= 86400 ? d.getFullYear() + '/' + date : date + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// =====================================================================================================
// Chart
// =====================================================================================================
var LW = window.LightweightCharts;
var chart = LW.createChart($('chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, panes: { separatorColor: C.border, separatorHoverColor: 'rgba(41,98,255,.35)' } },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    crosshair: { mode: LW.CrosshairMode.Normal, vertLine: { labelBackgroundColor: '#2A2E39' }, horzLine: { labelBackgroundColor: '#2A2E39' } },
    rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.2 } },
    timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 1.5, tickMarkFormatter: tickFmt },
    localization: { timeFormatter: crosshairTimeFmt, priceFormatter: fmtPrice },
    kineticScroll: { touch: true, mouse: false },
    trackingMode: { exitMode: LW.TrackingModeExitMode.OnTouchEnd },
    handleScale: { axisPressedMouseMove: { time: true, price: false }, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }
});

var candleSeries = chart.addSeries(LW.CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
var lineSeries = chart.addSeries(LW.LineSeries, { color: C.accent, lineWidth: 2, visible: false });
var areaSeries = chart.addSeries(LW.AreaSeries, { lineColor: C.accent, topColor: 'rgba(41,98,255,.35)', bottomColor: 'rgba(41,98,255,0)', lineWidth: 2, visible: false });
var volSeries = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

// Long averages (200/400) sit far from price; keeping them out of auto-scaling stops them squashing the candles.
function overlayLine(color, width, noScale) {
    return chart.addSeries(LW.LineSeries, {
        color: color, lineWidth: width || 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible: false,
        autoscaleInfoProvider: noScale ? function () { return null; } : undefined
    });
}
var maS = maCfg.map(function (m) { return overlayLine(m.c, 1, true); });
var emaS = EMA_COL.map(function (c) { return overlayLine(c, 1, true); });
var bUpS = overlayLine('rgba(41,98,255,.9)'), bMidS = overlayLine('rgba(255,152,0,.9)'), bLoS = overlayLine('rgba(41,98,255,.9)');

function mainSeries() { return chartType === 'line' ? lineSeries : chartType === 'area' ? areaSeries : candleSeries; }
function barOf(c) { return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }; }
function volOf(c) { return { time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(14,203,129,.38)' : 'rgba(246,70,93,.38)' }; }

// =====================================================================================================
// Indicators
// =====================================================================================================
function newD() {
    return { ma: maCfg.map(function () { return []; }), ema: [[], []], bMid: [], bUp: [], bLo: [], rsi: [], rsiG: [], rsiL: [], e12: [], e26: [], macd: [], sig: [], hist: [], cvd: [], delta: [] };
}
var D = newD();
var RSI_P = 14, A12 = 2 / 13, A26 = 2 / 27, A9 = 2 / 10;

function stepInd(i) {
    var close = candles[i].close, k, j, s;
    for (k = 0; k < maCfg.length; k++) {
        var p = maCfg[k].p;
        if (maCfg[k].on && i >= p - 1) { s = 0; for (j = i - p + 1; j <= i; j++) s += candles[j].close; D.ma[k][i] = s / p; } else D.ma[k][i] = null;
    }
    // order flow: the candle's taker-buy volume against the rest is the bar's delta; its running sum is CVD
    D.delta[i] = 2 * candles[i].buy - candles[i].volume;
    D.cvd[i] = (i > 0 ? D.cvd[i - 1] : 0) + D.delta[i];
    for (k = 0; k < 2; k++) {
        var pe = EMA_P[k], a = 2 / (pe + 1);
        var prev = i > 0 ? D.ema[k][i - 1] : null;
        var e = i === 0 ? close : (prev == null ? close : prev + a * (close - prev));
        D.ema[k][i] = e;
    }
    if (i >= 19) {
        s = 0; for (j = i - 19; j <= i; j++) s += candles[j].close;
        var mean = s / 20, sq = 0;
        for (j = i - 19; j <= i; j++) { var df = candles[j].close - mean; sq += df * df; }
        var sd = Math.sqrt(sq / 20);
        D.bMid[i] = mean; D.bUp[i] = mean + 2 * sd; D.bLo[i] = mean - 2 * sd;
    } else { D.bMid[i] = D.bUp[i] = D.bLo[i] = null; }
    if (i === 0) { D.rsiG[0] = 0; D.rsiL[0] = 0; D.rsi[0] = null; }
    else {
        var ch = close - candles[i - 1].close, g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
        if (i <= RSI_P) { D.rsiG[i] = (D.rsiG[i - 1] * (i - 1) + g) / i; D.rsiL[i] = (D.rsiL[i - 1] * (i - 1) + l) / i; }
        else { D.rsiG[i] = (D.rsiG[i - 1] * (RSI_P - 1) + g) / RSI_P; D.rsiL[i] = (D.rsiL[i - 1] * (RSI_P - 1) + l) / RSI_P; }
        D.rsi[i] = i >= RSI_P ? (D.rsiL[i] === 0 ? 100 : 100 - 100 / (1 + D.rsiG[i] / D.rsiL[i])) : null;
    }
    D.e12[i] = i === 0 ? close : D.e12[i - 1] + A12 * (close - D.e12[i - 1]);
    D.e26[i] = i === 0 ? close : D.e26[i - 1] + A26 * (close - D.e26[i - 1]);
    D.macd[i] = i >= 25 ? D.e12[i] - D.e26[i] : null;
    if (D.macd[i] == null) { D.sig[i] = null; D.hist[i] = null; }
    else {
        var ps = D.sig[i - 1];
        D.sig[i] = ps == null ? D.macd[i] : ps + A9 * (D.macd[i] - ps);
        D.hist[i] = D.macd[i] - D.sig[i];
    }
}
function computeAllInd() { for (var i = 0; i < candles.length; i++) stepInd(i); }
function pts(arr, from) {
    var out = [];
    for (var i = from || 0; i < candles.length; i++) if (arr[i] != null) out.push({ time: candles[i].time, value: arr[i] });
    return out;
}
function ptAt(arr, i) { return arr[i] == null ? null : { time: candles[i].time, value: arr[i] }; }

function toHA() {
    haBars = [];
    for (var i = 0; i < candles.length; i++) haBars.push(haAt(i));
}
function haAt(i) {
    var c = candles[i], close = (c.open + c.high + c.low + c.close) / 4;
    var open = i === 0 ? (c.open + c.close) / 2 : (haBars[i - 1].open + haBars[i - 1].close) / 2;
    return { time: c.time, open: open, close: close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close) };
}
function mainBar(i) { return chartType === 'ha' ? haBars[i] : barOf(candles[i]); }
function mainData() {
    if (chartType === 'line' || chartType === 'area') return candles.map(function (c) { return { time: c.time, value: c.close }; });
    if (chartType === 'ha') return haBars.slice();
    return candles.map(barOf);
}

// push the complete data set into every series (initial load, type/indicator change, older history)
function setAllData() {
    candleSeries.setData(chartType === 'candle' || chartType === 'ha' ? mainData() : []);
    lineSeries.setData(chartType === 'line' ? mainData() : []);
    areaSeries.setData(chartType === 'area' ? mainData() : []);
    volSeries.setData(ind.vol ? candles.map(volOf) : []);
    maS.forEach(function (s, k) { s.setData(ind.ma && maCfg[k].on ? pts(D.ma[k]) : []); });
    emaS.forEach(function (s, k) { s.setData(ind.ema ? pts(D.ema[k]) : []); });
    bUpS.setData(ind.boll ? pts(D.bUp) : []); bMidS.setData(ind.boll ? pts(D.bMid) : []); bLoS.setData(ind.boll ? pts(D.bLo) : []);
    subsSetData();
}
function histPts() {
    var out = [];
    for (var i = 0; i < candles.length; i++) if (D.hist[i] != null) out.push({ time: candles[i].time, value: D.hist[i], color: D.hist[i] >= 0 ? 'rgba(14,203,129,.6)' : 'rgba(246,70,93,.6)' });
    return out;
}
// incremental update of the last (forming) bar or a freshly appended bar
function pushLast() {
    var i = candles.length - 1, c = candles[i];
    stepInd(i);
    if (chartType === 'ha') haBars[i] = haAt(i);
    if (chartType === 'line' || chartType === 'area') mainSeries().update({ time: c.time, value: c.close });
    else candleSeries.update(mainBar(i));
    if (ind.vol) volSeries.update(volOf(c));
    if (ind.ma) maS.forEach(function (s, k) { var p = maCfg[k].on ? ptAt(D.ma[k], i) : null; if (p) s.update(p); });
    if (ind.ema) emaS.forEach(function (s, k) { var p = ptAt(D.ema[k], i); if (p) s.update(p); });
    if (ind.boll) { var u = ptAt(D.bUp, i); if (u) { bUpS.update(u); bMidS.update(ptAt(D.bMid, i)); bLoS.update(ptAt(D.bLo, i)); } }
    subsUpdate(i);
}

// ---- bottom panes (RSI, MACD, CVD, OI, liquidations ...) -----------------------------------------------------
var SUBS = {}, subLive = {};
function applySubs() {
    Object.keys(SUBS).forEach(function (key) {
        var on = !!ind[key];
        if (on && !subLive[key]) subLive[key] = SUBS[key].create(chart.panes().length);
        else if (!on && subLive[key]) { removeSubSeries(subLive[key]); delete subLive[key]; }
    });
    var ps = chart.panes(); for (var i = 1; i < ps.length; i++) ps[i].setStretchFactor(0.3);
}
function removeSubSeries(o) { Object.keys(o).forEach(function (k) { try { chart.removeSeries(o[k]); } catch (e) { /* ignore */ } }); }
function subsSetData() { Object.keys(subLive).forEach(function (key) { SUBS[key].setData(subLive[key]); }); }
function subsUpdate(i) { Object.keys(subLive).forEach(function (key) { if (SUBS[key].update) SUBS[key].update(subLive[key], i); }); }
function panePriceLines(series) {
    [70, 30].forEach(function (v) { series.createPriceLine({ price: v, color: 'rgba(132,142,156,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }); });
}
function lineOpts(color, last) { return { color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: !!last, crosshairMarkerVisible: false }; }
function signedVol(v) { return (v < 0 ? '-' : '+') + fmtVol(Math.abs(v)); }
var UPFILL = 'rgba(14,203,129,.55)', DOWNFILL = 'rgba(246,70,93,.55)';
SUBS.rsi = {
    create: function (pane) { var l = chart.addSeries(LW.LineSeries, lineOpts('#B388FF', true), pane); panePriceLines(l); return { line: l }; },
    setData: function (o) { o.line.setData(pts(D.rsi)); },
    update: function (o, i) { var r = ptAt(D.rsi, i); if (r) o.line.update(r); },
    legend: function (i) { return D.rsi[i] != null ? '<span style="color:#B388FF">RSI ' + D.rsi[i].toFixed(1) + '</span>' : ''; }
};
SUBS.macd = {
    create: function (pane) {
        return {
            hist: chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane),
            macd: chart.addSeries(LW.LineSeries, lineOpts('#2962FF'), pane),
            sig: chart.addSeries(LW.LineSeries, lineOpts('#FF9800'), pane)
        };
    },
    setData: function (o) { o.macd.setData(pts(D.macd)); o.sig.setData(pts(D.sig)); o.hist.setData(histPts()); },
    update: function (o, i) {
        var m = ptAt(D.macd, i);
        if (m) { o.macd.update(m); o.sig.update(ptAt(D.sig, i)); o.hist.update({ time: candles[i].time, value: D.hist[i], color: D.hist[i] >= 0 ? 'rgba(14,203,129,.6)' : 'rgba(246,70,93,.6)' }); }
    },
    legend: function (i) { return D.macd[i] != null ? '<span style="color:#2962FF">MACD ' + D.macd[i].toFixed(precision) + '</span> <span style="color:#FF9800">' + D.sig[i].toFixed(precision) + '</span>' : ''; }
};
SUBS.cvd = {
    create: function (pane) {
        return {
            delta: chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceScaleId: '' }, pane),
            line: chart.addSeries(LW.LineSeries, { color: '#00BCD4', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'volume' } }, pane)
        };
    },
    setData: function (o) {
        o.delta.priceScale().applyOptions({ scaleMargins: { top: 0.55, bottom: 0 } });
        o.line.setData(pts(D.cvd));
        o.delta.setData(candles.map(function (c, i) { return { time: c.time, value: D.delta[i], color: D.delta[i] >= 0 ? UPFILL : DOWNFILL }; }));
    },
    update: function (o, i) {
        o.line.update({ time: candles[i].time, value: D.cvd[i] });
        o.delta.update({ time: candles[i].time, value: D.delta[i], color: D.delta[i] >= 0 ? UPFILL : DOWNFILL });
    },
    legend: function (i) {
        return D.cvd[i] == null ? '' : '<span style="color:#00BCD4">CVD ' + signedVol(D.cvd[i]) + '</span> <span class="' + (D.delta[i] >= 0 ? 'up' : 'down') + '">Δ ' + signedVol(D.delta[i]) + '</span>';
    }
};

// ---- features: self-contained data feeds/overlays (order book, liquidations ...) -----------------------------------
var features = {};
function syncFeatures() {
    Object.keys(features).forEach(function (key) {
        var f = features[key], want = !!ind[key] && active && candles.length > 0;
        if (want && !f.running) { f.running = true; try { f.start(); } catch (e) { console.error(e); } }
        else if (!want && f.running) { f.running = false; try { f.stop(); } catch (e) { console.error(e); } }
    });
}
// all=true: symbol changed (everything restarts); otherwise only interval-dependent features restart
function stopFeatures(all) {
    Object.keys(features).forEach(function (key) {
        var f = features[key];
        if (f.running && (all || f.byInterval)) { f.running = false; try { f.stop(); } catch (e) { console.error(e); } }
    });
}

function applyType() {
    candleSeries.applyOptions({ visible: chartType === 'candle' || chartType === 'ha' });
    lineSeries.applyOptions({ visible: chartType === 'line' });
    areaSeries.applyOptions({ visible: chartType === 'area' });
    if (chartType === 'ha') toHA();
    DR.attachTo(mainSeries());
    setAllData();
}
function applyIndicators() {
    var vis = function (s, on) { s.applyOptions({ visible: !!on }); };
    vis(volSeries, ind.vol); maS.forEach(function (s, k) { vis(s, ind.ma && maCfg[k].on); }); emaS.forEach(function (s) { vis(s, ind.ema); });
    vis(bUpS, ind.boll); vis(bMidS, ind.boll); vis(bLoS, ind.boll);
    applySubs();
    setAllData();
    var extra = Object.keys(ind).some(function (k) { return k !== 'vol' && ind[k]; });
    $('ind_btn').className = 'tb-btn' + (extra ? ' on' : '');
    syncFeatures();
    scheduleLegend();
}

// =====================================================================================================
// Time <-> logical-index mapping (drawings are anchored to real time + price)
// =====================================================================================================
function logicalOfTime(t) {
    var n = candles.length; if (!n) return 0;
    var first = candles[0].time, last = candles[n - 1].time, sec = curSec();
    if (t >= last) return (n - 1) + (t - last) / sec;
    if (t <= first) return (t - first) / sec;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (candles[mid].time <= t) lo = mid; else hi = mid; }
    var a = candles[lo].time, b = candles[hi].time;
    return lo + (t - a) / (b - a);
}
function timeOfLogical(l) {
    var n = candles.length; if (!n) return 0;
    var sec = curSec();
    if (l >= n - 1) return Math.round(candles[n - 1].time + (l - (n - 1)) * sec);
    if (l <= 0) return Math.round(candles[0].time + l * sec);
    var i = Math.floor(l), f = l - i;
    return Math.round(candles[i].time + f * (candles[i + 1].time - candles[i].time));
}
// The library's logical<->coordinate conversions only accept/return whole bar indexes (fractions collapse to 0 or are
// rounded), so fractional positions are interpolated from the bar spacing.
function barSpacingPx() {
    var ts = chart.timeScale(), a = ts.logicalToCoordinate(0), b = ts.logicalToCoordinate(1);
    return (a == null || b == null || b === a) ? null : b - a;
}
function logicalToX(l) {
    var i = Math.round(l), x = chart.timeScale().logicalToCoordinate(i), bs = barSpacingPx();
    return (x == null || bs == null) ? null : x + (l - i) * bs;
}
function xToLogical(x) {
    var ts = chart.timeScale(), i = ts.coordinateToLogical(x); if (i == null) return null;
    var xi = ts.logicalToCoordinate(i), bs = barSpacingPx();
    return (xi == null || bs == null) ? null : i + (x - xi) / bs;
}
function xOf(time) { return logicalToX(logicalOfTime(time)); }
function yOf(price) { return mainSeries().priceToCoordinate(price); }

// =====================================================================================================
// Drawings
// =====================================================================================================
var FIB = [[0, '#787B86'], [0.236, '#F23645'], [0.382, '#FF9800'], [0.5, '#4CAF50'], [0.618, '#089981'], [0.786, '#00BCD4'], [1, '#787B86']];
var DR = {
    list: [], sel: null, tool: null, draft: null, measure: null, nextId: 1,
    attachTo: function (s) { attachLayers(s); },
    redraw: function () { redrawLayers(); },
    load: function () {
        this.list = LS.get('dr.' + symbol, []).filter(function (d) { return d && d.a && isFinite(d.a.time) && isFinite(d.a.price); });
        this.nextId = this.list.reduce(function (m, d) { return Math.max(m, d.id || 0); }, 0) + 1;
        this.sel = null; this.draft = null; this.measure = null; this.redraw();
    },
    save: function () { LS.set('dr.' + symbol, this.list.slice(-100)); }
};

// ---- paint layers ---------------------------------------------------------------------------------
// Everything that is drawn on top of / behind the candles (drawings, heatmap, bubbles, profiles) renders
// inside the chart's own canvas through two series primitives, so it always stays in sync with pan/zoom.
var layers = { bottom: [], top: [] };
var layerPrims = [], layerSeries = null;
function makeLayerPrimitive(z) {
    var prim = {
        _req: null,
        attached: function (p) { prim._req = p.requestUpdate; },
        detached: function () { prim._req = null; },
        updateAllViews: function () {},
        paneViews: function () { return [view]; }
    };
    var view = { zOrder: function () { return z; }, renderer: function () { return renderer; } };
    var renderer = {
        draw: function (target) {
            target.useBitmapCoordinateSpace(function (scope) {
                if (!candles.length || !layers[z].length) return;
                var ctx = scope.context, w = scope.mediaSize.width, h = scope.mediaSize.height;
                layers[z].forEach(function (fn) {
                    ctx.save(); ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
                    try { fn(ctx, w, h); } catch (e) { /* a broken layer must not take the chart down */ }
                    ctx.restore();
                });
            });
        }
    };
    return prim;
}
function attachLayers(series) {
    if (layerSeries === series) return;
    if (layerSeries) layerPrims.forEach(function (p) { try { layerSeries.detachPrimitive(p); } catch (e) { /* already gone */ } });
    layerSeries = series; layerPrims = [makeLayerPrimitive('bottom'), makeLayerPrimitive('top')];
    layerPrims.forEach(function (p) { series.attachPrimitive(p); });
}
function redrawLayers() { layerPrims.forEach(function (p) { if (p._req) p._req(); }); }
function addLayer(z, fn) { layers[z].push(fn); redrawLayers(); return function () { var i = layers[z].indexOf(fn); if (i >= 0) layers[z].splice(i, 1); redrawLayers(); }; }

function px(a) { var x = xOf(a.time), y = yOf(a.price); return (x == null || y == null) ? null : { x: x, y: y }; }

function label(ctx, text, x, y, bg, fg, align) {
    ctx.font = '600 10.5px -apple-system, Roboto, sans-serif';
    var w = ctx.measureText(text).width + 10, h = 17;
    var lx = align === 'right' ? x - w : x;
    ctx.fillStyle = bg; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx, y - h / 2, w, h, 4); else ctx.rect(lx, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, lx + 5, y + 0.5);
}
function handle(ctx, p) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke();
}

function paint(ctx, d, selected, w, h) {
    var a = px(d.a), b = d.b ? px(d.b) : null;
    if (!a) return;
    ctx.lineWidth = selected ? 2.2 : 1.6; ctx.setLineDash([]);
    if (d.type === 'hline') {
        ctx.strokeStyle = C.gold; ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(w, a.y); ctx.stroke();
        label(ctx, fmtPrice(d.a.price), w - 4, a.y - 11, C.gold, '#1a1a1a', 'right');
        if (selected) handle(ctx, { x: Math.min(40, w / 3), y: a.y });
    } else if (d.type === 'trend' && b) {
        ctx.strokeStyle = C.accent; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'rect' && b) {
        var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), rw = Math.abs(a.x - b.x), rh = Math.abs(a.y - b.y);
        ctx.fillStyle = 'rgba(41,98,255,.14)'; ctx.fillRect(x, y, rw, rh);
        ctx.strokeStyle = C.accent; ctx.strokeRect(x, y, rw, rh);
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'fib' && b) {
        var x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        if (x2 - x1 < 60) x2 = x1 + 60;
        var span = d.b.price - d.a.price, prev = null;
        FIB.forEach(function (lv) {
            var price = d.b.price - span * lv[0], y = yOf(price);
            if (y == null) return;
            if (prev) { ctx.fillStyle = hexA(lv[1], 0.07); ctx.fillRect(x1, Math.min(prev, y), x2 - x1, Math.abs(y - prev)); }
            prev = y;
            ctx.strokeStyle = lv[1]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
            label(ctx, lv[0] + '  ' + fmtPrice(price), x1 + 2, y - 10, 'rgba(19,23,34,.85)', lv[1] === '#787B86' ? '#B2B5BE' : lv[1]);
        });
        ctx.strokeStyle = 'rgba(120,123,134,.8)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'measure' && b) {
        var up = d.b.price >= d.a.price, col = up ? C.up : C.down;
        var mx = Math.min(a.x, b.x), my = Math.min(a.y, b.y), mw = Math.abs(a.x - b.x), mh = Math.abs(a.y - b.y);
        ctx.fillStyle = hexA(col, 0.12); ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.strokeRect(mx, my, mw, mh); ctx.setLineDash([]);
        var diff = d.b.price - d.a.price, pct = d.a.price ? diff / d.a.price * 100 : 0;
        var bars = Math.round(logicalOfTime(d.b.time) - logicalOfTime(d.a.time));
        var secs = Math.abs(d.b.time - d.a.time), dur = secs >= 86400 ? (secs / 86400).toFixed(1) + '일' : secs >= 3600 ? (secs / 3600).toFixed(1) + '시간' : Math.round(secs / 60) + '분';
        var txt = (diff >= 0 ? '+' : '') + fmtPrice(diff) + ' (' + (diff >= 0 ? '+' : '') + pct.toFixed(2) + '%)  ' + Math.abs(bars) + '봉 · ' + dur;
        var cx = mx + mw / 2, cy = up ? my - 14 : my + mh + 14;
        ctx.font = '600 10.5px -apple-system, Roboto, sans-serif';
        var tw = ctx.measureText(txt).width + 12, lx = Math.max(2, Math.min(w - tw - 2, cx - tw / 2));
        label(ctx, txt, lx, Math.max(11, Math.min(h - 11, cy)), col, '#0b0e11');
    }
}
function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

addLayer('top', function (ctx, w, h) {
    DR.list.forEach(function (d) { paint(ctx, d, d.id === DR.sel, w, h); });
    if (DR.draft) paint(ctx, DR.draft, false, w, h);
    if (DR.measure) paint(ctx, DR.measure, false, w, h);
});

// ---- hit testing ----------------------------------------------------------------------------------
function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function distTo(d, p) {
    var a = px(d.a), b = d.b ? px(d.b) : null;
    if (!a) return Infinity;
    if (d.type === 'hline') return Math.abs(p.y - a.y);
    if (!b) return Infinity;
    if (d.type === 'trend') return segDist(p, a, b);
    if (d.type === 'rect') {
        var x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        return Math.min(segDist(p, { x: x1, y: y1 }, { x: x2, y: y1 }), segDist(p, { x: x2, y: y1 }, { x: x2, y: y2 }),
                        segDist(p, { x: x2, y: y2 }, { x: x1, y: y2 }), segDist(p, { x: x1, y: y2 }, { x: x1, y: y1 }));
    }
    if (d.type === 'fib') {
        var fx1 = Math.min(a.x, b.x), fx2 = Math.max(a.x, b.x); if (fx2 - fx1 < 60) fx2 = fx1 + 60;
        var best = segDist(p, a, b), span = d.b.price - d.a.price;
        FIB.forEach(function (lv) { var y = yOf(d.b.price - span * lv[0]); if (y != null) best = Math.min(best, segDist(p, { x: fx1, y: y }, { x: fx2, y: y })); });
        return best;
    }
    return Infinity;
}
function handlesOf(d) {
    var a = px(d.a), b = d.b ? px(d.b) : null, ps = chart.paneSize(0);
    if (d.type === 'hline') return a ? [{ k: 'a', x: Math.min(40, ps.width / 3), y: a.y }] : [];
    return [a && { k: 'a', x: a.x, y: a.y }, b && { k: 'b', x: b.x, y: b.y }].filter(Boolean);
}
var HIT_PX = 18;
function hitHandle(d, p) {
    if (!d) return null;
    var hs = handlesOf(d);
    for (var i = 0; i < hs.length; i++) if (Math.hypot(p.x - hs[i].x, p.y - hs[i].y) <= HIT_PX + 4) return hs[i].k;
    return null;
}
function hitDrawing(p) {
    var best = null, bd = HIT_PX;
    DR.list.forEach(function (d) { var dd = distTo(d, p); if (dd < bd) { bd = dd; best = d; } });
    return best;
}

// ---- pointer -> anchor (with a light magnet to OHLC) -----------------------------------------------------
function anchorAt(p, snap) {
    var l = xToLogical(p.x), price = mainSeries().coordinateToPrice(p.y);
    if (l == null || price == null) return null;
    var time = timeOfLogical(l);
    if (snap) {
        var i = Math.round(l);
        if (i >= 0 && i < candles.length) {
            var bx = xOf(candles[i].time);
            if (bx != null && Math.abs(bx - p.x) < 12) {
                time = candles[i].time;
                var c = candles[i], bestP = null, bestD = 11;
                [c.open, c.high, c.low, c.close].forEach(function (v) { var vy = yOf(v); if (vy != null && Math.abs(vy - p.y) < bestD) { bestD = Math.abs(vy - p.y); bestP = v; } });
                if (bestP != null) price = bestP;
            }
        }
    }
    return { time: time, price: price };
}

// ---- interaction ---------------------------------------------------------------------------------------------
var wrap = $('chart_wrap'), chartEl = $('chart');
var gesture = null;               // { mode, d, startP, orig, moved, pointerId }
var swallowUntil = 0;

function local(e) { var r = chartEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function inMain(p) { var ps = chart.paneSize(0); return p.x >= 0 && p.y >= 0 && p.x <= ps.width && p.y <= ps.height; }
function cloneA(a) { return { time: a.time, price: a.price }; }

function setTool(t) {
    DR.tool = t; DR.draft = null;
    var hints = { trend: '시작점을 누르세요', hline: '가격 위치를 누르세요', fib: '시작점을 누르세요', rect: '한쪽 모서리를 누르세요', measure: '시작점을 누르세요' };
    showHint(t ? hints[t] : '');
    refreshRail(); DR.redraw();
}
function showHint(msg) { var h = $('hint'); h.textContent = msg || ''; h.className = msg ? 'show' : ''; }

function onDown(e) {
    if (e.target.closest && e.target.closest('button')) return;
    if (gesture) { cancelGesture(); return; }                       // second finger: let the chart pinch
    if (!e.isPrimary) return;
    var p = local(e);
    if (!inMain(p) || !candles.length) return;
    if (DR.tool) {
        var a = anchorAt(p, true); if (!a) return;
        if (DR.draft && DR.draft.awaiting) { DR.draft.b = a; DR.draft.awaiting = false; gesture = { mode: 'create', startP: p, moved: true }; }
        else if (DR.tool === 'hline') { DR.draft = { id: 0, type: 'hline', a: a }; gesture = { mode: 'create', startP: p, moved: true }; }
        else { DR.draft = { id: 0, type: DR.tool, a: a, b: cloneA(a) }; gesture = { mode: 'create', startP: p, moved: false }; }
    } else {
        var sel = DR.list.filter(function (d) { return d.id === DR.sel; })[0];
        var hk = hitHandle(sel, p);
        if (hk) gesture = { mode: 'handle', d: sel, which: hk, startP: p, moved: false };
        else {
            var d = hitDrawing(p);
            if (!d) { return; }
            DR.sel = d.id; refreshRail();
            gesture = { mode: 'move', d: d, startP: p, moved: false, orig: { a: px(d.a), b: d.b ? px(d.b) : null } };
        }
    }
    gesture.id = e.pointerId;
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.stopPropagation(); e.preventDefault();
    DR.redraw();
}
function onMove(e) {
    var p = local(e);
    if (!gesture) {
        if (DR.tool && DR.draft && DR.draft.awaiting && inMain(p)) { var h = anchorAt(p, true); if (h) { DR.draft.b = h; DR.redraw(); } }   // mouse hover preview
        return;
    }
    if (e.pointerId !== gesture.id) return;
    e.stopPropagation(); e.preventDefault();
    if (!gesture.moved && Math.hypot(p.x - gesture.startP.x, p.y - gesture.startP.y) > 8) gesture.moved = true;
    if (gesture.mode === 'create') {
        var a = anchorAt(p, true); if (!a) return;
        if (DR.draft.type === 'hline') DR.draft.a = a; else if (gesture.moved) DR.draft.b = a;
    } else if (gesture.mode === 'handle' && gesture.moved) {
        var ah = anchorAt(p, true); if (!ah) return;
        if (gesture.d.type === 'hline') gesture.d.a.price = ah.price; else gesture.d[gesture.which] = ah;
    } else if (gesture.mode === 'move' && gesture.moved) {
        var dx = p.x - gesture.startP.x, dy = p.y - gesture.startP.y, d = gesture.d;
        var na = anchorAt({ x: gesture.orig.a.x + dx, y: gesture.orig.a.y + dy }, false);
        if (d.type === 'hline') { if (na) d.a.price = na.price; }
        else if (na && gesture.orig.b) {
            var nb = anchorAt({ x: gesture.orig.b.x + dx, y: gesture.orig.b.y + dy }, false);
            if (nb) { d.a = na; d.b = nb; }
        }
    }
    DR.redraw();
}
function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    e.stopPropagation(); e.preventDefault();
    var g = gesture; gesture = null; swallowUntil = Date.now() + 350;
    if (g.mode === 'create') {
        var dr = DR.draft;
        if (dr.type !== 'hline' && !g.moved) { dr.awaiting = true; showHint('끝점을 누르세요'); DR.redraw(); return; }       // tap-tap flow
        DR.draft = null;
        if (dr.type === 'measure') { DR.measure = dr; setTool(null); return; }
        dr.id = DR.nextId++; delete dr.awaiting;
        DR.list.push(dr); DR.sel = dr.id; DR.save(); setTool(null);
    } else if (g.moved) { DR.save(); }
    DR.redraw();
}
function cancelGesture() { gesture = null; DR.draft = null; showHint(''); DR.redraw(); }
function swallow(e) {
    if (gesture || Date.now() < swallowUntil) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
}
wrap.addEventListener('pointerdown', onDown, true);
wrap.addEventListener('pointermove', onMove, true);
wrap.addEventListener('pointerup', onUp, true);
wrap.addEventListener('pointercancel', function () { if (gesture) cancelGesture(); }, true);
['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach(function (t) {
    wrap.addEventListener(t, swallow, { capture: true, passive: false });
});
chart.subscribeClick(function (param) {                            // tap on empty chart: clear selection / measurement
    var changed = false;
    if (DR.sel != null) { DR.sel = null; changed = true; }
    if (DR.measure) { DR.measure = null; changed = true; }
    if (changed) { refreshRail(); DR.redraw(); }
});

// =====================================================================================================
// Rail (drawing tools) & toolbar
// =====================================================================================================
var ICON = {
    cursor: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2 4 7-3 1-4-7-5 4z"/></svg>',
    trend: '<svg viewBox="0 0 24 24"><path d="M5 19L19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/></svg>',
    hline: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><circle cx="7" cy="12" r="2"/></svg>',
    fib: '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h16M4 14h16M4 19h16"/></svg>',
    rect: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="10" rx="1"/></svg>',
    measure: '<svg viewBox="0 0 24 24"><path d="M4 16l12-12 4 4L8 20z"/><path d="M8 12l2 2M11 9l2 2M14 6l2 2"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>',
    candle: '<svg viewBox="0 0 24 24"><path d="M7 4v3M7 17v3M17 7v3M17 20v-3"/><rect x="5" y="7" width="4" height="10" rx=".5"/><rect x="15" y="10" width="4" height="7" rx=".5"/></svg>',
    ha: '<svg viewBox="0 0 24 24"><path d="M7 3v3M7 18v3M17 6v3M17 21v-3"/><rect x="5" y="6" width="4" height="12" rx=".5"/><rect x="15" y="9" width="4" height="9" rx=".5"/></svg>',
    line: '<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-10"/></svg>',
    area: '<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-10v12H3z"/></svg>'
};
var TOOLS = [['cursor', '선택'], ['trend', '추세선'], ['hline', '수평선'], ['fib', '피보나치'], ['rect', '사각형'], ['measure', '측정']];
var trashArmed = null;

function buildRail() {
    var r = $('rail'); r.innerHTML = '';
    TOOLS.forEach(function (t) {
        var b = document.createElement('button'); b.className = 'tool'; b.setAttribute('data-tool', t[0]);
        b.innerHTML = ICON[t[0]] + '<span>' + t[1] + '</span>';
        b.onclick = function () { setTool(t[0] === 'cursor' ? null : (DR.tool === t[0] ? null : t[0])); };
        r.appendChild(b);
    });
    var sep = document.createElement('div'); sep.className = 'rail-sep'; r.appendChild(sep);
    var tr = document.createElement('button'); tr.className = 'tool danger'; tr.id = 'trash'; tr.innerHTML = ICON.trash + '<span>삭제</span>';
    tr.onclick = onTrash; r.appendChild(tr);
    refreshRail();
}
function refreshRail() {
    var btns = document.querySelectorAll('#rail .tool[data-tool]');
    for (var i = 0; i < btns.length; i++) {
        var t = btns[i].getAttribute('data-tool');
        btns[i].className = 'tool' + ((t === 'cursor' ? !DR.tool : DR.tool === t) ? ' active' : '');
    }
    var tr = $('trash'); if (tr) { tr.className = 'tool danger' + (trashArmed ? ' armed' : ''); tr.querySelector('span').textContent = trashArmed ? '전체삭제?' : (DR.sel != null ? '선택삭제' : '삭제'); }
}
function onTrash() {
    if (DR.sel != null) {
        DR.list = DR.list.filter(function (d) { return d.id !== DR.sel; }); DR.sel = null; DR.save(); DR.redraw(); refreshRail(); return;
    }
    if (!DR.list.length && !DR.measure) { toast('지울 그림이 없습니다'); return; }
    if (trashArmed) { clearTimeout(trashArmed); trashArmed = null; DR.list = []; DR.measure = null; DR.save(); DR.redraw(); refreshRail(); return; }
    trashArmed = setTimeout(function () { trashArmed = null; refreshRail(); }, 2500);
    refreshRail();
}
function setRail(open) {
    railOpen = open; LS.set('rail', open);
    $('app').classList.toggle('rail-closed', !open);
    if (!open && DR.tool) setTool(null);
}
$('rail_toggle').onclick = function () { setRail(!railOpen); };

function buildIntervals() {
    var box = $('intervals'); box.innerHTML = '';
    INTERVALS.forEach(function (it) {
        var b = document.createElement('button'); b.className = 'chip'; b.setAttribute('data-i', it[0]); b.textContent = it[1];
        b.onclick = function () { changeInterval(it[0]); };
        box.appendChild(b);
    });
    markInterval();
}
function markInterval() {
    var chips = document.querySelectorAll('#intervals .chip');
    for (var i = 0; i < chips.length; i++) {
        var on = chips[i].getAttribute('data-i') === interval;
        chips[i].className = 'chip' + (on ? ' active' : '');
        if (on && chips[i].scrollIntoView) chips[i].scrollIntoView({ inline: 'center', block: 'nearest' });
    }
}
function changeInterval(i) {
    if (i === interval) return;
    interval = i; LS.set('interval', i); markInterval(); reload(false);
}

// ---- sheets ---------------------------------------------------------------------------------------------------------
function openSheet(title, rows, footer) {
    var s = $('sheet'); s.innerHTML = '<h3>' + title + '</h3>';
    rows.forEach(function (r) { s.appendChild(r); });
    if (footer) s.appendChild(footer);
    $('sheet_bg').classList.add('show');
}
function closeSheet() { $('sheet_bg').classList.remove('show'); }
$('sheet_bg').addEventListener('click', function (e) { if (e.target === $('sheet_bg')) closeSheet(); });

function switchRow(text, sub, key, gear) {
    var b = document.createElement('div'); b.className = 'row-opt'; b.setAttribute('role', 'button');
    b.innerHTML = '<span style="flex:1">' + text + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
        (gear ? '<button class="gear" aria-label="설정">⚙</button>' : '') + '<span class="switch' + (ind[key] ? ' on' : '') + '"></span>';
    b.onclick = function (e) {
        if (gear && e.target.closest('.gear')) { gear(); return; }
        ind[key] = !ind[key]; LS.set('ind', ind);
        b.querySelector('.switch').classList.toggle('on', ind[key]);
        applyIndicators();
    };
    return b;
}
function sectionTitle(t) { var d = document.createElement('div'); d.className = 'sec'; d.textContent = t; return d; }
function noteRow(t) { var d = document.createElement('div'); d.className = 'note'; d.textContent = t; return d; }

// the MA list: period + on/off per line, colors are fixed (red, yellow, green, blue, white, purple)
function openMaSettings() {
    var rows = maCfg.map(function (m) {
        var r = document.createElement('div'); r.className = 'row-opt ma-row';
        r.innerHTML = '<span class="dot" style="background:' + m.c + '"></span><span style="flex:1">MA</span>' +
            '<input type="number" inputmode="numeric" min="1" max="2000" value="' + m.p + '"><span class="switch' + (m.on ? ' on' : '') + '"></span>';
        var input = r.querySelector('input'), sw = r.querySelector('.switch');
        input.onclick = function (e) { e.stopPropagation(); };
        input.onchange = function () {
            var v = Math.max(1, Math.min(2000, Math.floor(+input.value) || m.p)); input.value = v; m.p = v; saveMa();
        };
        r.onclick = function (e) { if (e.target === input) return; m.on = !m.on; sw.classList.toggle('on', m.on); saveMa(); };
        return r;
    });
    var reset = document.createElement('button'); reset.className = 'row-opt'; reset.style.color = '#2962FF'; reset.textContent = '기본값으로 되돌리기 (5·10·50·100·200·400)';
    reset.onclick = function () { maCfg.forEach(function (m, k) { m.p = MA_DEFAULT[k][0]; m.on = true; }); saveMa(); openMaSettings(); };
    openSheet('이동평균선 설정', rows.concat([noteRow('기간은 현재 차트의 봉 개수 기준입니다. 일봉(1D)에서 보면 일 단위 이동평균입니다.'), reset]));
}
function saveMa() {
    LS.set('ma6', maCfg.map(function (m) { return { p: m.p, on: m.on }; }));
    D = newD(); computeAllInd(); applyIndicators();
}
$('ind_btn').onclick = function () {
    openSheet('지표', [
        sectionTitle('기본'),
        switchRow('거래량', '', 'vol'),
        switchRow('이동평균선', maCfg.map(function (m) { return m.p; }).join(' · '), 'ma', openMaSettings),
        switchRow('지수이동평균', 'EMA 20 · 50', 'ema'),
        switchRow('볼린저 밴드', '20, 2', 'boll'),
        switchRow('RSI', '14 · 별도 창', 'rsi'),
        switchRow('MACD', '12, 26, 9 · 별도 창', 'macd'),
        sectionTitle('오더플로우'),
        switchRow('CVD · 델타', '누적 체결 델타 (매수-매도 체결량)', 'cvd'),
        switchRow('미결제약정 (OI)', 'Binance 선물 · 별도 창', 'oi'),
        switchRow('실시간 청산', '청산 주문 버블 + 봉별 청산량', 'liq'),
        switchRow('대량 체결', '큰 체결만 버블로 표시', 'trades'),
        sectionTitle('호가창 · 청산맵'),
        switchRow('호가 벽', '매수/매도 벽 · 우측 깊이 막대', 'depth'),
        switchRow('호가 히트맵', '유동성 변화를 시간별 색으로', 'heat'),
        switchRow('추정 청산맵', 'OI·레버리지 기반 추정(모델)', 'liqmap'),
        noteRow('실시간 항목은 켜 둔 동안에만 데이터를 받습니다. 차트를 벗어나면 자동으로 멈춰 배터리를 아낍니다.')
    ]);
};
var TYPE_NAMES = [['candle', '캔들'], ['ha', '하이킨 아시'], ['line', '라인'], ['area', '에어리어']];
function refreshTypeBtn() { $('type_btn').innerHTML = ICON[chartType]; }
$('type_btn').onclick = function () {
    var rows = TYPE_NAMES.map(function (t) {
        var b = document.createElement('button'); b.className = 'row-opt';
        b.innerHTML = '<span style="display:flex;align-items:center;gap:10px"><span style="width:20px">' + ICON[t[0]].replace('<svg', '<svg width="20" height="20"') + '</span>' + t[1] + '</span><span class="check">' + (chartType === t[0] ? '✓' : '') + '</span>';
        b.onclick = function () { chartType = t[0]; LS.set('type', chartType); refreshTypeBtn(); applyType(); closeSheet(); scheduleLegend(); };
        return b;
    });
    openSheet('차트 종류', rows);
};
$('sym_btn').onclick = function () { bridge('openSymbolSearch'); };
$('exit_btn').onclick = function () { bridge('exitImmersive'); };

function toast(msg, btnText, action) {
    var t = $('toast'); $('toast_msg').textContent = msg;
    var b = $('toast_btn'); b.style.display = btnText ? 'inline-block' : 'none'; if (btnText) { b.textContent = btnText; b.onclick = function () { t.className = ''; action && action(); }; }
    t.className = 'show'; clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, btnText ? 8000 : 2200);
}

// =====================================================================================================
// Legend, price header, countdown
// =====================================================================================================
var legendPending = false, crossTime = null, lastTickDir = 0;
function scheduleLegend() { if (legendPending) return; legendPending = true; requestAnimationFrame(function () { legendPending = false; renderLegend(); }); }
function indexOfTime(t) {
    var lo = 0, hi = candles.length - 1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (candles[m].time === t) return m; if (candles[m].time < t) lo = m + 1; else hi = m - 1; }
    return -1;
}
function val(arr, i, dig) { return arr[i] == null ? null : (dig == null ? fmtPrice(arr[i]) : arr[i].toFixed(dig)); }
function renderLegend() {
    var n = candles.length; if (!n) { $('legend').innerHTML = ''; return; }
    var i = crossTime != null ? indexOfTime(crossTime) : -1; if (i < 0) i = n - 1;
    var c = candles[i], b = chartType === 'ha' && haBars[i] ? haBars[i] : c;
    var cls = c.close >= c.open ? 'up' : 'down', chg = c.open ? (c.close - c.open) / c.open * 100 : 0;
    var l1 = '<div class="row">O <span class="' + cls + '">' + fmtPrice(b.open) + '</span> H <span class="' + cls + '">' + fmtPrice(b.high) +
        '</span> L <span class="' + cls + '">' + fmtPrice(b.low) + '</span> C <span class="' + cls + '">' + fmtPrice(b.close) + '</span> <span class="' + cls + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>';
    l1 += '</div>';
    var parts = [];
    if (ind.vol) parts.push('Vol <b>' + fmtVol(c.volume) + '</b>');
    if (i === n - 1) parts.push('<span id="cd" style="color:#B2B5BE"></span>');
    if (ind.ma) maCfg.forEach(function (m, k) { if (!m.on) return; var v = val(D.ma[k], i); if (v) parts.push('<span style="color:' + m.c + '">MA' + m.p + ' ' + v + '</span>'); });
    if (ind.ema) EMA_P.forEach(function (p, k) { if (i >= p - 1) parts.push('<span style="color:' + EMA_COL[k] + '">EMA' + p + ' ' + fmtPrice(D.ema[k][i]) + '</span>'); });
    if (ind.boll && D.bMid[i] != null) parts.push('<span style="color:#FF9800">BOLL ' + fmtPrice(D.bMid[i]) + '</span> <span style="color:#7aa2ff">' + fmtPrice(D.bUp[i]) + ' / ' + fmtPrice(D.bLo[i]) + '</span>');
    Object.keys(subLive).forEach(function (key) { var h = SUBS[key].legend && SUBS[key].legend(i, c); if (h) parts.push(h); });
    var l2 = parts.length ? '<div class="row">' + parts.join(' &nbsp;') + '</div>' : '';
    $('legend').innerHTML = l1 + l2;
    updateCountdown();
}
chart.subscribeCrosshairMove(function (param) { crossTime = param && param.time ? param.time : null; scheduleLegend(); });

function updateCountdown() {
    var el = $('cd'); if (!el || !candles.length) return;
    var left = candles[candles.length - 1].time + curSec() - Math.floor(Date.now() / 1000);
    if (left < 0) left = 0;
    var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    el.textContent = (h ? h + ':' + pad2(m) : pad2(m)) + ':' + pad2(s);
}
var cdTimer = null;
function startTimers() { stopTimers(); cdTimer = setInterval(updateCountdown, 1000); }
function stopTimers() { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } }

function showPrice(p, dir) {
    var el = $('top_price'); if (!el) return;
    el.textContent = fmtPrice(p);
    if (dir) el.style.color = dir > 0 ? C.up : C.down;
}

// "jump to latest" button
chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
    if (!r || !candles.length) return;
    $('to_latest').classList.toggle('show', r.to < candles.length - 4);
    if (r.from < 25) loadOlder();
});
$('to_latest').onclick = function () { chart.timeScale().scrollToRealTime(); };

// =====================================================================================================
// Data: REST history + live WebSocket
// =====================================================================================================
function parseRows(raw) {
    var out = [], dec = 0;
    for (var i = 0; i < raw.length; i++) {
        var k = raw[i];
        out.push({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], buy: +k[9] });
        if (i < 100) { var s = String(k[4]), dot = s.indexOf('.'); if (dot >= 0) dec = Math.max(dec, s.length - dot - 1); }
    }
    return { rows: out, dec: dec };
}
function setPrecision(dec) {
    dec = Math.max(0, Math.min(8, dec));
    if (dec === precision && started) return;
    precision = dec;
    var pf = { type: 'price', precision: dec, minMove: Math.pow(10, -dec) };
    [candleSeries, lineSeries, areaSeries].forEach(function (s) { s.applyOptions({ priceFormat: pf }); });
    chart.applyOptions({ localization: { priceFormatter: fmtPrice } });
}
function showLoading(on) { $('loading').className = on ? '' : 'hide'; }

function reload(symbolChanged) {
    var seq = ++loadSeq;
    unsubKline(); stopFeatures(symbolChanged !== false); noMoreOlder = false; loadingOlder = false;
    showLoading(true); crossTime = null;
    fetch(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=1000')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (raw) {
            if (seq !== loadSeq) return;
            if (!Array.isArray(raw) || !raw.length) throw new Error('empty');
            var res = parseRows(raw);
            candles = res.rows; setPrecision(res.dec);
            D = newD();
            computeAllInd(); if (chartType === 'ha') toHA();
            setAllData();
            var n = candles.length, ts = chart.timeScale();
            ts.applyOptions({ barSpacing: Math.max(3.5, Math.min(10, ts.width() / 64)) });     // ~64 bars across, like exchange apps
            ts.scrollToRealTime();
            showLoading(false); scheduleLegend(); DR.redraw();
            showPrice(candles[n - 1].close, 0);
            if (active) subscribeKline();
            syncFeatures();
        })
        .catch(function () {
            if (seq !== loadSeq) return;
            showLoading(false);
            toast('차트 데이터를 불러오지 못했어요', '다시 시도', function () { reload(false); });
        });
}

function loadOlder() {
    if (loadingOlder || noMoreOlder || !candles.length || candles.length >= MAX_BARS) return;
    loadingOlder = true;
    var seq = loadSeq, endTime = candles[0].time * 1000 - 1;
    fetch(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=500&endTime=' + endTime)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (raw) {
            if (seq !== loadSeq) return;
            if (!Array.isArray(raw) || !raw.length) { noMoreOlder = true; return; }
            var rows = parseRows(raw).rows, added = rows.length;
            var range = chart.timeScale().getVisibleLogicalRange();
            candles = rows.concat(candles);
            D = newD();
            computeAllInd(); if (chartType === 'ha') toHA();
            setAllData();
            if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });   // keep the view where it was
            DR.redraw();
        })
        .catch(function () { /* try again on the next scroll */ })
        .then(function () { loadingOlder = false; });
}

// One websocket per Binance endpoint (market data / public book data). Features subscribe to the streams they need;
// a stream with no subscribers holds no connection, and everything pauses while the chart is not visible.
function Stream(path) { this.path = path; this.ws = null; this.subs = {}; this.gen = 0; this.delay = 1000; this.timer = null; this.open = false; this.opened = false; this.hooks = []; }
Stream.prototype.names = function () { return Object.keys(this.subs); };
Stream.prototype.connect = function () {
    if (this.ws || !active || !this.names().length) return;
    var self = this, gen = ++this.gen, sock;
    try { sock = new WebSocket('wss://fstream.binance.com/' + this.path); } catch (e) { this.retry(); return; }
    this.ws = sock;
    sock.onopen = function () {
        if (gen !== self.gen) return;
        self.open = true; self.delay = 1000;
        sock.send(JSON.stringify({ method: 'SUBSCRIBE', params: self.names(), id: 1 }));
        if (self.opened) self.hooks.forEach(function (h) { try { h(); } catch (e) { console.error(e); } });   // re-opened: callers re-sync their data
        self.opened = true;
    };
    sock.onmessage = function (e) {
        if (gen !== self.gen) return;
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        var h = m && m.stream && self.subs[m.stream];
        if (h) { try { h(m.data); } catch (err2) { console.error(err2); } }
    };
    sock.onclose = function () { if (gen !== self.gen) return; self.ws = null; self.open = false; self.retry(); };
    sock.onerror = function () { /* onclose follows */ };
};
Stream.prototype.retry = function () {
    var self = this; clearTimeout(this.timer);
    if (!active || !this.names().length) return;
    this.timer = setTimeout(function () { self.connect(); }, this.delay);
    this.delay = Math.min(this.delay * 2, 15000);
};
Stream.prototype.send = function (method, params) { try { this.ws.send(JSON.stringify({ method: method, params: params, id: 2 })); } catch (e) { /* socket gone */ } };
Stream.prototype.sub = function (name, handler) {
    var had = !!this.subs[name]; this.subs[name] = handler;
    if (this.open) { if (!had) this.send('SUBSCRIBE', [name]); } else this.connect();
};
Stream.prototype.unsub = function (name) {
    if (!this.subs[name]) return;
    delete this.subs[name];
    if (this.open) this.send('UNSUBSCRIBE', [name]);
    if (!this.names().length) this.shutdown(true);
};
Stream.prototype.shutdown = function (reset) {
    this.gen++; clearTimeout(this.timer); this.open = false; if (reset) this.opened = false;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } this.ws = null; }
};
var streams = { market: new Stream('market/stream'), pub: new Stream('public/stream') };
streams.market.hooks.push(function () { resync(); });

var klineName = null;
function unsubKline() { if (klineName) { streams.market.unsub(klineName); klineName = null; } }
function subscribeKline() {
    unsubKline();
    klineName = symbol.toLowerCase() + '@kline_' + interval;
    var sym = symbol, intv = interval;
    streams.market.sub(klineName, function (d) { var k = d && d.k; if (k && k.s === sym && k.i === intv) onKline(k); });
}

// fill the gap after a pause/reconnect with the most recent candles
function resync() {
    var seq = loadSeq;
    return fetch(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=60')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (raw) {
            if (seq !== loadSeq || !Array.isArray(raw) || !raw.length || !candles.length) return;
            var rows = parseRows(raw).rows, firstNew = rows[0].time, cut = candles.length;
            while (cut > 0 && candles[cut - 1].time >= firstNew) cut--;
            candles = candles.slice(0, cut).concat(rows);
            if (candles.length > MAX_BARS + 600) candles = candles.slice(candles.length - MAX_BARS);
            D = newD();
            computeAllInd(); if (chartType === 'ha') toHA();
            setAllData(); scheduleLegend(); DR.redraw();
        })
        .catch(function () { /* the websocket will keep us going */ });
}
function onKline(k) {
    var t = Math.floor(k.t / 1000), n = candles.length, last = candles[n - 1];
    var bar = { time: t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, buy: +k.V };
    if (t === last.time) candles[n - 1] = bar;
    else if (t > last.time) candles.push(bar);
    else return;
    pushLast();
    var prev = n > 1 ? candles[candles.length - 2].close : bar.open;
    showPrice(bar.close, bar.close === last.close ? 0 : (bar.close > last.close ? 1 : -1));
    if (crossTime == null) scheduleLegend();
}

// =====================================================================================================
// Native API
// =====================================================================================================
window.loadSymbol = function (sym, defaultInterval) {
    var next = String(sym || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!next) return;
    if (defaultInterval && !started && !LS.get('interval', null)) { interval = normInterval(defaultInterval); markInterval(); }
    if (started && next === symbol && candles.length) return;
    started = true;
    symbol = next; $('sym_name').textContent = next;
    DR.load(); reload(true);
};
window.setActive = function (on) {
    if (on === active) return;
    active = !!on;
    if (active) {
        startTimers();
        if (candles.length) { resync(); streams.market.connect(); streams.pub.connect(); syncFeatures(); }
    } else {
        stopTimers(); streams.market.shutdown(false); streams.pub.shutdown(false); syncFeatures();
    }
};
window.setImmersive = function (on) {
    immersive = !!on;
    $('app').classList.toggle('immersive', immersive);
    scheduleLegend();
};
document.addEventListener('visibilitychange', function () { window.setActive(!document.hidden); });

// =====================================================================================================
// Public hooks for the order-flow feature scripts (flow.js)
// =====================================================================================================
window.CF = {
    LW: LW, chart: chart, C: C, ind: ind, streams: streams, D: function () { return D; },
    candles: function () { return candles; }, symbol: function () { return symbol; }, interval: function () { return interval; },
    secs: curSec, precision: function () { return precision; }, active: function () { return active; },
    fmtPrice: fmtPrice, fmtVol: fmtVol, pad2: pad2, LS: LS, mainSeries: mainSeries,
    xOf: xOf, yOf: yOf, priceAt: function (y) { return mainSeries().coordinateToPrice(y); }, logicalOfTime: logicalOfTime,
    layer: addLayer, redraw: redrawLayers, toast: toast, label: label,
    registerSub: function (key, def) { SUBS[key] = def; },
    registerFeature: function (key, def) { features[key] = def; def.running = false; },
    subSeries: function (key) { return subLive[key]; },
    refreshSub: function (key) { if (subLive[key]) SUBS[key].setData(subLive[key]); scheduleLegend(); },
    scheduleLegend: scheduleLegend, hexA: hexA
};

// =====================================================================================================
// Boot
// =====================================================================================================
function boot() {
    buildRail(); buildIntervals(); refreshTypeBtn();
    $('app').classList.toggle('rail-closed', !railOpen);
    DR.attachTo(mainSeries());
    applyType(); applyIndicators();
    startTimers();
    // The native layer calls loadSymbol() as soon as the page has loaded; standalone, start anyway.
    setTimeout(function () { if (!started) window.loadSymbol(symbol); }, 700);
}
window.addEventListener('DOMContentLoaded', boot);
window.__cf = { chart: chart, DR: DR, get candles() { return candles; }, get interval() { return interval; }, setTool: setTool, ind: ind, get D() { return D; }, features: features, subs: SUBS, get live() { return subLive; }, maCfg: maCfg };
})();
