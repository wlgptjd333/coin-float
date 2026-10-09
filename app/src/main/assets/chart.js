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
var EMA_DEFAULT = [[20, '#FF9800'], [50, '#2962FF']];
var PALETTE = ['#F6465D', '#FF7043', '#F0B90B', '#FFEB3B', '#0ECB81', '#00BCD4', '#2962FF', '#B388FF', '#E040FB', '#FFFFFF', '#B2B5BE', '#787B86'];
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
// Settings store: every indicator (and the chart itself) declares a schema; the same renderer builds each settings
// sheet from it, and only values the user changed are persisted.
// =====================================================================================================
var CFGS = LS.get('cfg', {}); if (!CFGS || typeof CFGS !== 'object') CFGS = {};
var SCHEMA = {}, cfgCache = {}, cfgSaveT = null, HEX = /^#[0-9a-fA-F]{6}$/;
(function migrate() {                                           // 1.4.0 stored only period/on per average
    var old = LS.get('ma6', null);
    if (old && old.map && !CFGS.ma) CFGS.ma = { lines: old.map(function (m) { return { p: m.p, on: m.on }; }) };
})();
function defineSettings(key, def) { SCHEMA[key] = def; delete cfgCache[key]; }
function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
function fixLines(f, v) {
    return f.def.map(function (d, i) {
        var s = v && v[i] || {};
        return {
            on: typeof s.on === 'boolean' ? s.on : d.on !== false,
            p: typeof s.p === 'number' && s.p >= 1 ? Math.min(2000, Math.floor(s.p)) : d.p,
            c: typeof s.c === 'string' && HEX.test(s.c) ? s.c : d.c,
            w: typeof s.w === 'number' ? clampN(Math.round(s.w), 1, 4) : (d.w || 1),
            t: s.t === 'ema' || s.t === 'sma' ? s.t : d.t
        };
    });
}
function fieldValue(f, v) {
    switch (f.t) {
        case 'color': return typeof v === 'string' && HEX.test(v) ? v : f.def;
        case 'bool': return typeof v === 'boolean' ? v : f.def;
        case 'num': case 'range': return typeof v === 'number' && isFinite(v) ? clampN(v, f.min, f.max) : f.def;
        case 'sel': return f.opts.some(function (o) { return o[0] === v; }) ? v : f.def;
        case 'lines': return fixLines(f, v);
    }
    return f.def;
}
function S(key) {
    var c = cfgCache[key]; if (c) return c;
    var saved = CFGS[key] || {}, o = {};
    SCHEMA[key].fields.forEach(function (f) { if (f.k) o[f.k] = fieldValue(f, saved[f.k]); });
    return (cfgCache[key] = o);
}
function saveCfg() { clearTimeout(cfgSaveT); cfgSaveT = setTimeout(function () { LS.set('cfg', CFGS); }, 250); }
function setCfg(key, k, v) {
    var o = CFGS[key] || (CFGS[key] = {}); o[k] = v; delete cfgCache[key]; saveCfg();
    var d = SCHEMA[key]; if (d.onChange) d.onChange(S(key), k);
}
function resetCfg(key) { delete CFGS[key]; delete cfgCache[key]; saveCfg(); var d = SCHEMA[key]; if (d.onChange) d.onChange(S(key), null); }

function lineDef(arr, type, width) { return arr.map(function (d) { return { p: d[0], c: d[1], w: width || 1, t: type, on: true }; }); }
var calcChanged = function () { scheduleRefresh(true); }, styleChanged = function () { scheduleRefresh(false); };

defineSettings('chart', {
    title: '차트 설정', onChange: function () { scheduleChartCfg(); },
    fields: [
        { t: 'sec', label: '캔들' },
        { k: 'palette', t: 'sel', label: '상승 / 하락 색', def: 'gr', opts: [['gr', '초록 / 빨강'], ['kr', '빨강 / 파랑'], ['custom', '직접 지정']] },
        { k: 'up', t: 'color', label: '상승 색', def: '#0ECB81', showIf: function (c) { return c.palette === 'custom'; } },
        { k: 'down', t: 'color', label: '하락 색', def: '#F6465D', showIf: function (c) { return c.palette === 'custom'; } },
        { k: 'hollow', t: 'bool', label: '상승 캔들 속 비우기', def: false },
        { t: 'sec', label: '가격 축 · 이동' },
        { k: 'scale', t: 'sel', label: '스케일', def: 'normal', opts: [['normal', '일반'], ['log', '로그'], ['pct', '퍼센트']] },
        { k: 'vdrag', t: 'bool', label: '차트를 위아래로 끌어 가격 이동', sub: '끄면 가격 축만 위아래로 끌어 확대·축소합니다 (A 버튼: 자동 맞춤)', def: true },
        { k: 'top', t: 'range', label: '위쪽 여백', def: 8, min: 0, max: 40, step: 1, unit: '%' },
        { k: 'bottom', t: 'range', label: '아래쪽 여백', def: 20, min: 0, max: 50, step: 1, unit: '%' },
        { k: 'lastLine', t: 'bool', label: '현재가 선 · 라벨', def: true },
        { t: 'sec', label: '화면' },
        { k: 'theme', t: 'sel', label: '배경', def: 'dark', opts: [['dark', '다크'], ['black', '블랙']] },
        { k: 'grid', t: 'sel', label: '격자', def: 'both', opts: [['both', '가로·세로'], ['horz', '가로만'], ['none', '없음']] },
        { k: 'cross', t: 'sel', label: '십자선', def: 'free', opts: [['free', '자유'], ['magnet', '캔들에 붙이기']] },
        { k: 'legend', t: 'sel', label: '상단 수치 표시', def: 'full', opts: [['full', '시세 + 지표 (탭하면 펼침)'], ['ohlc', '시세만'], ['off', '숨김']] },
        { t: 'sec', label: '하단 지표 창' },
        { k: 'merge', t: 'bool', label: '하단 지표를 한 창에 합치기', sub: 'RSI · MACD · CVD · OI · 청산을 한 창에 겹쳐 보여줍니다', def: false }
    ],
    credit: '차트 엔진: TradingView Lightweight Charts™ (Apache-2.0) · © TradingView, Inc. · https://www.tradingview.com'
});
defineSettings('vol', {
    title: '거래량 설정', onChange: styleChanged,
    fields: [
        { k: 'follow', t: 'bool', label: '캔들 색상 따르기', def: true },
        { k: 'up', t: 'color', label: '상승 거래량 색', def: '#0ECB81', showIf: function (c) { return !c.follow; } },
        { k: 'down', t: 'color', label: '하락 거래량 색', def: '#F6465D', showIf: function (c) { return !c.follow; } },
        { k: 'opacity', t: 'range', label: '진하기', def: 38, min: 10, max: 100, step: 1, unit: '%' },
        { k: 'height', t: 'range', label: '차지하는 높이', def: 18, min: 8, max: 50, step: 1, unit: '%' }
    ]
});
defineSettings('ma', {
    title: '이동평균선 설정', onChange: calcChanged,
    fields: [
        { k: 'lines', t: 'lines', def: lineDef(MA_DEFAULT, 'sma'), types: true },
        { k: 'labels', t: 'bool', label: '가격 축에 현재 값 표시', def: false },
        { t: 'note', label: '기간은 현재 차트 봉 개수 기준입니다 (일봉이면 일 단위). SMA = 단순, EMA = 지수 이동평균.' }
    ]
});
defineSettings('ema', {
    title: '지수이동평균(EMA) 설정', onChange: calcChanged,
    fields: [{ k: 'lines', t: 'lines', def: lineDef(EMA_DEFAULT, 'ema'), types: false }]
});
defineSettings('boll', {
    title: '볼린저 밴드 설정', onChange: calcChanged,
    fields: [
        { t: 'sec', label: '계산' },
        { k: 'period', t: 'num', label: '기간', def: 20, min: 2, max: 200, step: 1 },
        { k: 'mult', t: 'num', label: '표준편차 배수', def: 2, min: 0.5, max: 5, step: 0.1 },
        { t: 'sec', label: '스타일' },
        { k: 'cBand', t: 'color', label: '상단 · 하단 밴드 색', def: '#2962FF' },
        { k: 'midOn', t: 'bool', label: '중심선 표시', def: true },
        { k: 'cMid', t: 'color', label: '중심선 색', def: '#FF9800', showIf: function (c) { return c.midOn; } },
        { k: 'width', t: 'range', label: '선 두께', def: 1, min: 1, max: 4, step: 1, unit: 'px' },
        { k: 'fill', t: 'bool', label: '밴드 안쪽 채우기', def: true },
        { k: 'fillA', t: 'range', label: '채우기 진하기', def: 10, min: 2, max: 40, step: 1, unit: '%', showIf: function (c) { return c.fill; } }
    ]
});
defineSettings('rsi', {
    title: 'RSI 설정', onChange: calcChanged,
    fields: [
        { k: 'period', t: 'num', label: '기간', def: 14, min: 2, max: 100, step: 1 },
        { k: 'color', t: 'color', label: '선 색', def: '#B388FF' },
        { k: 'width', t: 'range', label: '선 두께', def: 1, min: 1, max: 4, step: 1, unit: 'px' },
        { k: 'levels', t: 'bool', label: '과매수 · 과매도 선', def: true },
        { k: 'ob', t: 'num', label: '과매수 기준', def: 70, min: 50, max: 99, step: 1, showIf: function (c) { return c.levels; } },
        { k: 'os', t: 'num', label: '과매도 기준', def: 30, min: 1, max: 50, step: 1, showIf: function (c) { return c.levels; } }
    ]
});
defineSettings('macd', {
    title: 'MACD 설정', onChange: calcChanged,
    fields: [
        { t: 'sec', label: '계산' },
        { k: 'fast', t: 'num', label: '단기 EMA', def: 12, min: 2, max: 100, step: 1 },
        { k: 'slow', t: 'num', label: '장기 EMA', def: 26, min: 3, max: 200, step: 1 },
        { k: 'signal', t: 'num', label: '시그널', def: 9, min: 2, max: 100, step: 1 },
        { t: 'sec', label: '스타일' },
        { k: 'cMacd', t: 'color', label: 'MACD 선 색', def: '#2962FF' },
        { k: 'cSig', t: 'color', label: '시그널 선 색', def: '#FF9800' },
        { k: 'width', t: 'range', label: '선 두께', def: 1, min: 1, max: 4, step: 1, unit: 'px' },
        { k: 'hist', t: 'bool', label: '히스토그램 표시', def: true }
    ]
});
defineSettings('cvd', {
    title: 'CVD · 델타 설정', onChange: calcChanged,
    fields: [
        { k: 'color', t: 'color', label: 'CVD 선 색', def: '#00BCD4' },
        { k: 'width', t: 'range', label: '선 두께', def: 2, min: 1, max: 4, step: 1, unit: 'px' },
        { k: 'delta', t: 'bool', label: '봉별 델타 막대', def: true },
        { k: 'reset', t: 'sel', label: '누적 기준', def: 'none', opts: [['none', '불러온 구간 전체'], ['day', '매일 0시(UTC) 리셋']] },
        { t: 'note', label: 'CVD = 매수 체결량 − 매도 체결량의 누적. 위로 가면 공격적 매수 우세입니다.' }
    ]
});

// =====================================================================================================
// State
// =====================================================================================================
var symbol = 'BTCUSDT';
var interval = normInterval(LS.get('interval', '15m'));
var chartType = LS.get('type', 'candle');                       // candle | ha | line | area
var ind = Object.assign({
    vol: true, ma: true, ema: false, boll: false, rsi: false, macd: false,
    cvd: false, oi: false, liq: false, trades: false, depth: false, heat: false, liqmap: false, bidask: false
}, LS.get('ind', {}));
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
function computeColors() {
    var c = S('chart');
    C.up = c.palette === 'kr' ? '#F6465D' : c.palette === 'custom' ? c.up : '#0ECB81';
    C.down = c.palette === 'kr' ? '#3B82F6' : c.palette === 'custom' ? c.down : '#F6465D';
    C.bg = c.theme === 'black' ? '#000000' : '#131722';
    C.grid = c.theme === 'black' ? '#171b24' : '#1E222D';
}
computeColors();
var chart = LW.createChart($('chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, attributionLogo: false, panes: { separatorColor: C.border, separatorHoverColor: 'rgba(41,98,255,.35)' } },
    grid: { vertLines: { color: C.grid, visible: S('chart').grid === 'both' }, horzLines: { color: C.grid, visible: S('chart').grid !== 'none' } },
    crosshair: { mode: S('chart').cross === 'magnet' ? LW.CrosshairMode.Magnet : LW.CrosshairMode.Normal, vertLine: { labelBackgroundColor: '#2A2E39' }, horzLine: { labelBackgroundColor: '#2A2E39' } },
    rightPriceScale: { borderColor: C.border, scaleMargins: { top: S('chart').top / 100, bottom: S('chart').bottom / 100 } },
    timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 1.5, tickMarkFormatter: tickFmt },
    localization: { timeFormatter: crosshairTimeFmt },
    kineticScroll: { touch: true, mouse: false },
    trackingMode: { exitMode: LW.TrackingModeExitMode.OnTouchEnd },
    handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: S('chart').vdrag }
});

var PRICE_FMT = { type: 'custom', minMove: 0.01, formatter: fmtPrice };
var candleSeries = chart.addSeries(LW.CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down, priceFormat: PRICE_FMT });
var lineSeries = chart.addSeries(LW.LineSeries, { color: C.accent, lineWidth: 2, visible: false, priceFormat: PRICE_FMT });
var areaSeries = chart.addSeries(LW.AreaSeries, { lineColor: C.accent, topColor: 'rgba(41,98,255,.35)', bottomColor: 'rgba(41,98,255,0)', lineWidth: 2, visible: false, priceFormat: PRICE_FMT });
var volSeries = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
volSeries.priceScale().applyOptions({ scaleMargins: { top: 1 - S('vol').height / 100, bottom: 0 } });

// Long averages (200/400) sit far from price; keeping them out of auto-scaling stops them squashing the candles.
function overlayLine(color, width, noScale) {
    return chart.addSeries(LW.LineSeries, {
        color: color, lineWidth: width || 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible: false,
        autoscaleInfoProvider: noScale ? function () { return null; } : undefined
    });
}
var maS = MA_DEFAULT.map(function (d) { return overlayLine(d[1], 1, true); });
var emaS = EMA_DEFAULT.map(function (d) { return overlayLine(d[1], 1, true); });
var bUpS = overlayLine('rgba(41,98,255,.9)'), bMidS = overlayLine('rgba(255,152,0,.9)'), bLoS = overlayLine('rgba(41,98,255,.9)');

function mainSeries() { return chartType === 'line' ? lineSeries : chartType === 'area' ? areaSeries : candleSeries; }
function barOf(c) { return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }; }
function volOf(c) {
    var v = S('vol'), up = c.close >= c.open;
    return { time: c.time, value: c.volume, color: hexA(v.follow ? (up ? C.up : C.down) : (up ? v.up : v.down), v.opacity / 100) };
}

// =====================================================================================================
// Indicators
// =====================================================================================================
var P = {};                                   // calculation parameters, refreshed together with D
function newD() {
    P.ma = S('ma').lines; P.ema = S('ema').lines;
    var b = S('boll'); P.bp = b.period; P.bm = b.mult;
    P.rsi = S('rsi').period;
    var m = S('macd'); P.fast = m.fast; P.slow = Math.max(m.slow, m.fast + 1); P.sig = m.signal;
    P.cvdDay = S('cvd').reset === 'day';
    return { cs: [], ma: P.ma.map(function () { return []; }), ema: P.ema.map(function () { return []; }), bMid: [], bUp: [], bLo: [], rsi: [], rsiG: [], rsiL: [], e12: [], e26: [], macd: [], sig: [], hist: [], cvd: [], delta: [] };
}
var D = newD();

// simple or exponential average of the closes ending at bar i (simple ones use the running sum)
function avgAt(arr, i, p, type) {
    if (i < p - 1) return null;
    if (type === 'ema' && i > 0 && arr[i - 1] != null) return arr[i - 1] + (2 / (p + 1)) * (candles[i].close - arr[i - 1]);
    return (D.cs[i] - (i >= p ? D.cs[i - p] : 0)) / p;
}
function stepInd(i) {
    var close = candles[i].close, k, j;
    D.cs[i] = (i > 0 ? D.cs[i - 1] : 0) + close;
    for (k = 0; k < P.ma.length; k++) D.ma[k][i] = P.ma[k].on ? avgAt(D.ma[k], i, P.ma[k].p, P.ma[k].t) : null;
    for (k = 0; k < P.ema.length; k++) D.ema[k][i] = P.ema[k].on ? avgAt(D.ema[k], i, P.ema[k].p, P.ema[k].t) : null;
    // order flow: the candle's taker-buy volume against the rest is the bar's delta; its running sum is CVD
    D.delta[i] = 2 * candles[i].buy - candles[i].volume;
    var newDay = P.cvdDay && i > 0 && Math.floor(candles[i].time / 86400) !== Math.floor(candles[i - 1].time / 86400);
    D.cvd[i] = (i > 0 && !newDay ? D.cvd[i - 1] : 0) + D.delta[i];
    var bp = P.bp;
    if (i >= bp - 1) {
        var mean = (D.cs[i] - (i >= bp ? D.cs[i - bp] : 0)) / bp, sq = 0;
        for (j = i - bp + 1; j <= i; j++) { var df = candles[j].close - mean; sq += df * df; }
        var sd = Math.sqrt(sq / bp);
        D.bMid[i] = mean; D.bUp[i] = mean + P.bm * sd; D.bLo[i] = mean - P.bm * sd;
    } else { D.bMid[i] = D.bUp[i] = D.bLo[i] = null; }
    var RP = P.rsi;
    if (i === 0) { D.rsiG[0] = 0; D.rsiL[0] = 0; D.rsi[0] = null; }
    else {
        var ch = close - candles[i - 1].close, g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
        if (i <= RP) { D.rsiG[i] = (D.rsiG[i - 1] * (i - 1) + g) / i; D.rsiL[i] = (D.rsiL[i - 1] * (i - 1) + l) / i; }
        else { D.rsiG[i] = (D.rsiG[i - 1] * (RP - 1) + g) / RP; D.rsiL[i] = (D.rsiL[i - 1] * (RP - 1) + l) / RP; }
        D.rsi[i] = i >= RP ? (D.rsiL[i] === 0 ? 100 : 100 - 100 / (1 + D.rsiG[i] / D.rsiL[i])) : null;
    }
    var af = 2 / (P.fast + 1), as = 2 / (P.slow + 1), ag = 2 / (P.sig + 1);
    D.e12[i] = i === 0 ? close : D.e12[i - 1] + af * (close - D.e12[i - 1]);
    D.e26[i] = i === 0 ? close : D.e26[i - 1] + as * (close - D.e26[i - 1]);
    D.macd[i] = i >= P.slow - 1 ? D.e12[i] - D.e26[i] : null;
    if (D.macd[i] == null) { D.sig[i] = null; D.hist[i] = null; }
    else {
        var ps = D.sig[i - 1];
        D.sig[i] = ps == null ? D.macd[i] : ps + ag * (D.macd[i] - ps);
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
    maS.forEach(function (s, k) { s.setData(ind.ma && P.ma[k].on ? pts(D.ma[k]) : []); });
    emaS.forEach(function (s, k) { s.setData(ind.ema && P.ema[k].on ? pts(D.ema[k]) : []); });
    var mid = ind.boll && S('boll').midOn;
    bUpS.setData(ind.boll ? pts(D.bUp) : []); bMidS.setData(mid ? pts(D.bMid) : []); bLoS.setData(ind.boll ? pts(D.bLo) : []);
    subsSetData();
}
function histPts() {
    var out = [];
    for (var i = 0; i < candles.length; i++) if (D.hist[i] != null) out.push({ time: candles[i].time, value: D.hist[i], color: histColor(D.hist[i]) });
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
    if (ind.ma) maS.forEach(function (s, k) { var p = P.ma[k].on ? ptAt(D.ma[k], i) : null; if (p) s.update(p); });
    if (ind.ema) emaS.forEach(function (s, k) { var p = P.ema[k].on ? ptAt(D.ema[k], i) : null; if (p) s.update(p); });
    if (ind.boll) { var u = ptAt(D.bUp, i); if (u) { bUpS.update(u); if (S('boll').midOn) bMidS.update(ptAt(D.bMid, i)); bLoS.update(ptAt(D.bLo, i)); } }
    subsUpdate(i);
}

// ---- bottom panes (RSI, MACD, CVD, OI, liquidations ...) -----------------------------------------------------
var SUBS = {}, subLive = {}, subShared = {};
function eachSeries(o, fn) { Object.keys(o).forEach(function (k) { if (k !== 'pl' && o[k] && o[k].priceScale) fn(o[k], k); }); }
function paneOf(key) {                                  // current pane index of a live sub-indicator (-1 when absent)
    var o = subLive[key], idx = -1;
    if (o) eachSeries(o, function (s) { if (idx < 0) { try { idx = s.getPane().paneIndex(); } catch (e) { /* ignore */ } } });
    return idx;
}
function sidOpt(sid) { return sid ? { priceScaleId: sid } : {}; }
function rebuildSubs() {
    Object.keys(subLive).forEach(function (k) { removeSubSeries(subLive[k]); delete subLive[k]; delete subShared[k]; });
}
function applySubs() {
    var merged = !!S('chart').merge;
    Object.keys(SUBS).forEach(function (key) {
        var on = !!ind[key];
        if (on && !subLive[key]) {
            var host = -1;                              // merged mode: join the pane a previous indicator already opened
            if (merged) Object.keys(subLive).forEach(function (k) { if (host < 0 && subShared[k]) host = paneOf(k); });
            subLive[key] = host >= 0 ? SUBS[key].create(host, 'm_' + key) : SUBS[key].create(chart.panes().length);
            subShared[key] = merged;
            if (host >= 0) eachSeries(subLive[key], function (se) { try { se.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0.12 } }); } catch (e) { /* ignore */ } });
        } else if (!on && subLive[key]) { removeSubSeries(subLive[key]); delete subLive[key]; delete subShared[key]; }
    });
    var ps = chart.panes();
    for (var i = 1; i < ps.length; i++) {
        ps[i].setStretchFactor(0.3);
        try { chart.priceScale('right', i).applyOptions({ scaleMargins: { top: 0.12, bottom: 0.1 } }); } catch (e) { /* older engine */ }
    }
    Object.keys(subLive).forEach(function (key) { if (SUBS[key].style) SUBS[key].style(subLive[key]); });
}
function removeSubSeries(o) { eachSeries(o, function (se) { try { chart.removeSeries(se); } catch (e) { /* ignore */ } }); }
function subsSetData() { Object.keys(subLive).forEach(function (key) { SUBS[key].setData(subLive[key]); }); }
function subsUpdate(i) { Object.keys(subLive).forEach(function (key) { if (SUBS[key].update) SUBS[key].update(subLive[key], i); }); }
function lineOpts(color, last, sid) { return Object.assign({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: !!last, crosshairMarkerVisible: false }, sidOpt(sid)); }
function signedVol(v) { return (v < 0 ? '-' : '+') + fmtVol(Math.abs(v)); }
// axis labels of the volume-like panes: 7.63B instead of 7,625,082,330.90 (the chart-wide formatter is for prices)
var COMPACT = { type: 'custom', minMove: 0.01, formatter: function (v) { return (v < 0 ? '-' : '') + fmtVol(Math.abs(v)); } };
function upFill() { return hexA(C.up, 0.55); }
function downFill() { return hexA(C.down, 0.55); }
function histColor(v) { return v >= 0 ? hexA(C.up, 0.6) : hexA(C.down, 0.6); }
SUBS.rsi = {
    create: function (pane, sid) { return { line: chart.addSeries(LW.LineSeries, lineOpts('#B388FF', true, sid), pane), pl: [] }; },
    style: function (o) {
        var c = S('rsi');
        o.line.applyOptions({ color: c.color, lineWidth: c.width });
        o.pl.forEach(function (l) { try { o.line.removePriceLine(l); } catch (e) { /* gone */ } }); o.pl = [];
        if (c.levels) [c.ob, c.os].forEach(function (v) { o.pl.push(o.line.createPriceLine({ price: v, color: 'rgba(132,142,156,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })); });
    },
    setData: function (o) { o.line.setData(pts(D.rsi)); },
    update: function (o, i) { var r = ptAt(D.rsi, i); if (r) o.line.update(r); },
    legend: function (i) { var c = S('rsi'); return D.rsi[i] != null ? '<span style="color:' + c.color + '">RSI ' + c.period + ' ' + D.rsi[i].toFixed(1) + '</span>' : ''; }
};
SUBS.macd = {
    create: function (pane, sid) {
        return {
            hist: chart.addSeries(LW.HistogramSeries, Object.assign({ priceLineVisible: false, lastValueVisible: false }, sidOpt(sid)), pane),
            macd: chart.addSeries(LW.LineSeries, lineOpts('#2962FF', false, sid), pane),
            sig: chart.addSeries(LW.LineSeries, lineOpts('#FF9800', false, sid), pane)
        };
    },
    style: function (o) {
        var c = S('macd');
        var dec = Math.min(8, precision + 1), pf = { type: 'custom', minMove: Math.pow(10, -dec), formatter: function (v) { return v.toFixed(dec); } };
        o.macd.applyOptions({ color: c.cMacd, lineWidth: c.width, priceFormat: pf }); o.sig.applyOptions({ color: c.cSig, lineWidth: c.width, priceFormat: pf });
        o.hist.applyOptions({ visible: c.hist, priceFormat: pf });
    },
    setData: function (o) { o.macd.setData(pts(D.macd)); o.sig.setData(pts(D.sig)); o.hist.setData(histPts()); },
    update: function (o, i) {
        var m = ptAt(D.macd, i);
        if (m) { o.macd.update(m); o.sig.update(ptAt(D.sig, i)); o.hist.update({ time: candles[i].time, value: D.hist[i], color: histColor(D.hist[i]) }); }
    },
    legend: function (i) {
        var c = S('macd');
        return D.macd[i] != null ? '<span style="color:' + c.cMacd + '">MACD ' + D.macd[i].toFixed(precision) + '</span> <span style="color:' + c.cSig + '">' + D.sig[i].toFixed(precision) + '</span>' : '';
    }
};
SUBS.cvd = {
    create: function (pane, sid) {
        return {
            delta: chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceScaleId: sid ? sid + '_d' : '' }, pane),
            line: chart.addSeries(LW.LineSeries, Object.assign({ color: '#00BCD4', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: COMPACT }, sidOpt(sid)), pane)
        };
    },
    style: function (o) {
        var c = S('cvd');
        o.line.applyOptions({ color: c.color, lineWidth: c.width }); o.delta.applyOptions({ visible: c.delta });
    },
    setData: function (o) {
        o.delta.priceScale().applyOptions({ scaleMargins: { top: 0.55, bottom: 0 } });
        o.line.setData(pts(D.cvd));
        o.delta.setData(candles.map(function (c, i) { return { time: c.time, value: D.delta[i], color: D.delta[i] >= 0 ? upFill() : downFill() }; }));
    },
    update: function (o, i) {
        o.line.update({ time: candles[i].time, value: D.cvd[i] });
        o.delta.update({ time: candles[i].time, value: D.delta[i], color: D.delta[i] >= 0 ? upFill() : downFill() });
    },
    legend: function (i) {
        return D.cvd[i] == null ? '' : '<span style="color:' + S('cvd').color + '">CVD ' + signedVol(D.cvd[i]) + '</span> <span class="' + (D.delta[i] >= 0 ? 'up' : 'down') + '">Δ ' + signedVol(D.delta[i]) + '</span>';
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
// Each lower pane gets a small tag row (name, ⚙, ✕) like pro charting apps; merged indicators share one row.
var PANE_NAME = { rsi: 'RSI', macd: 'MACD', cvd: 'CVD', oi: 'OI', liq: '청산' };
function paneTagColor(key) {
    try {
        if (key === 'rsi') return S('rsi').color;
        if (key === 'macd') return S('macd').cMacd;
        if (key === 'cvd') return S('cvd').color;
        if (key === 'oi') return S('oi').color;
        if (key === 'liq') return C.down;
    } catch (e) { /* schema not registered yet */ }
    return '#B2B5BE';
}
var tagsRaf = 0;
function scheduleTags() { if (tagsRaf) return; tagsRaf = requestAnimationFrame(function () { tagsRaf = 0; layoutPaneTags(); }); }
function layoutPaneTags() {
    var box = $('pane_tags'), ps = chart.panes(), rows = {}, html = '';
    if (!box) return;
    var base = chartEl.getBoundingClientRect().top;
    Object.keys(subLive).forEach(function (key) {
        var pi = paneOf(key); if (pi < 1) return;
        (rows[pi] = rows[pi] || []).push(key);
    });
    Object.keys(rows).forEach(function (pi) {
        var el = ps[pi] && ps[pi].getHTMLElement && ps[pi].getHTMLElement(); if (!el) return;
        var top = el.getBoundingClientRect().top - base + 3;
        html += '<div class="ptag-row" style="top:' + top.toFixed(0) + 'px">' + rows[pi].map(function (k) {
            return '<span class="ptag" style="color:' + paneTagColor(k) + '">' + (PANE_NAME[k] || k) +
                '<button data-k="' + k + '" data-a="cfg" aria-label="설정">⚙</button><button data-k="' + k + '" data-a="x" aria-label="닫기">✕</button></span>';
        }).join('') + '</div>';
    });
    box.innerHTML = html;
}
$('pane_tags').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b) return;
    var k = b.getAttribute('data-k');
    if (b.getAttribute('data-a') === 'cfg') openSettings(k);
    else if (b.getAttribute('data-a') === 'x') { ind[k] = false; LS.set('ind', ind); applyIndicators(); }
});
if (window.ResizeObserver) new ResizeObserver(function () { scheduleTags(); scheduleCd(); }).observe($('chart'));

function applyIndicators() {
    var vis = function (s, on) { s.applyOptions({ visible: !!on }); };
    vis(volSeries, ind.vol); maS.forEach(function (s, k) { vis(s, ind.ma && P.ma[k].on); }); emaS.forEach(function (s, k) { vis(s, ind.ema && P.ema[k].on); });
    vis(bUpS, ind.boll); vis(bMidS, ind.boll && S('boll').midOn); vis(bLoS, ind.boll);
    applyStyles();
    applySubs();
    setAllData();
    scheduleTags();
    var extra = Object.keys(ind).some(function (k) { return k !== 'vol' && ind[k]; });
    $('ind_btn').className = 'tb-btn' + (extra ? ' on' : '');
    syncFeatures();
    scheduleLegend();
}

// ---- styling driven by the settings schemas ------------------------------------------------------------------------
function applyStyles() {
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 1 - S('vol').height / 100, bottom: 0 } });
    var m = S('ma'), e = S('ema'), b = S('boll');
    maS.forEach(function (s, k) { var l = m.lines[k]; s.applyOptions({ color: l.c, lineWidth: l.w, lastValueVisible: m.labels }); });
    emaS.forEach(function (s, k) { var l = e.lines[k]; s.applyOptions({ color: l.c, lineWidth: l.w }); });
    bUpS.applyOptions({ color: b.cBand, lineWidth: b.width }); bLoS.applyOptions({ color: b.cBand, lineWidth: b.width });
    bMidS.applyOptions({ color: b.cMid, lineWidth: b.width });
}
var refreshRaf = 0, refreshCalc = false;
function scheduleRefresh(calc) {                  // slider drags fire many changes: coalesce into one repaint per frame
    if (calc) refreshCalc = true;
    if (refreshRaf) return;
    refreshRaf = requestAnimationFrame(function () {
        refreshRaf = 0;
        if (refreshCalc) { refreshCalc = false; D = newD(); computeAllInd(); if (chartType === 'ha') toHA(); }
        applyIndicators();
        DR.redraw();
    });
}
var chartCfgRaf = 0;
function scheduleChartCfg() { if (chartCfgRaf) return; chartCfgRaf = requestAnimationFrame(function () { chartCfgRaf = 0; applyChartCfg(); }); }
var lastMerge = null;
function applyChartCfg() {
    computeColors();
    var c = S('chart');
    if (lastMerge !== null && !!c.merge !== lastMerge) rebuildSubs();
    lastMerge = !!c.merge;
    document.documentElement.style.setProperty('--bg', C.bg);
    chart.applyOptions({
        layout: { background: { type: 'solid', color: C.bg } },
        grid: { vertLines: { color: C.grid, visible: c.grid === 'both' }, horzLines: { color: C.grid, visible: c.grid !== 'none' } },
        crosshair: { mode: c.cross === 'magnet' ? LW.CrosshairMode.Magnet : LW.CrosshairMode.Normal },
        handleScroll: { vertTouchDrag: c.vdrag }
    });
    chart.priceScale('right').applyOptions({
        mode: c.scale === 'log' ? LW.PriceScaleMode.Logarithmic : c.scale === 'pct' ? LW.PriceScaleMode.Percentage : LW.PriceScaleMode.Normal,
        scaleMargins: { top: c.top / 100, bottom: c.bottom / 100 }
    });
    candleSeries.applyOptions({
        upColor: c.hollow ? 'rgba(0,0,0,0)' : C.up, downColor: C.down, borderVisible: !!c.hollow, borderUpColor: C.up, borderDownColor: C.down,
        wickUpColor: C.up, wickDownColor: C.down, priceLineVisible: c.lastLine, lastValueVisible: c.lastLine
    });
    [lineSeries, areaSeries].forEach(function (x) { x.applyOptions({ priceLineVisible: c.lastLine, lastValueVisible: c.lastLine }); });
    syncScaleBtns();
    scheduleRefresh(false);                       // volume colors, indicator styles
    scheduleLegend();
}
// Compact "L" (log) and "A" (auto-fit) buttons sit in the corner under the price axis, like other chart apps.
function syncScaleBtns() {
    var ps = chart.priceScale('right'), o = ps.options(), box = $('scale_btns');
    $('auto_btn').classList.toggle('on', !!o.autoScale);
    $('log_btn').classList.toggle('on', o.mode === LW.PriceScaleMode.Logarithmic);
    var w = ps.width(), th = chart.timeScale().height();
    if (w > 0) box.style.width = w + 'px';
    if (th > 0) box.style.height = th + 'px';
}
$('auto_btn').onclick = function () {
    var ps = chart.priceScale('right');
    ps.applyOptions({ autoScale: !ps.options().autoScale });
    syncScaleBtns();
};
$('log_btn').onclick = function () { setCfg('chart', 'scale', S('chart').scale === 'log' ? 'normal' : 'log'); syncScaleBtns(); };

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
    list: [], sel: null, tool: null, draft: null, measure: null, nextId: 1, hidden: LS.get('drHidden', false),
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
var layerPrims = [], layerSeries = null, layerErr = false;
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
                    try { fn(ctx, w, h); } catch (e) { if (!layerErr) { layerErr = true; console.error('layer', e); } }   // a broken layer must not take the chart down
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
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke();
}

function paint(ctx, d, selected, w, h) {
    var a = px(d.a), b = d.b ? px(d.b) : null;
    if (!a) return;
    var col = drawingColor(d), dash = d.ds === 1 ? [7, 5] : d.ds === 2 ? [2, 4] : [];
    ctx.lineWidth = (d.w || 1.6) + (selected ? 0.6 : 0); ctx.setLineDash(dash);
    if (d.type === 'hline') {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(w, a.y); ctx.stroke();
        label(ctx, fmtPrice(d.a.price), w - 4, a.y - 11, col, '#1a1a1a', 'right');
        if (selected) handle(ctx, { x: Math.min(40, w / 3), y: a.y });
    } else if (d.type === 'trend' && b) {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'rect' && b) {
        var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), rw = Math.abs(a.x - b.x), rh = Math.abs(a.y - b.y);
        ctx.fillStyle = hexA(col, 0.14); ctx.fillRect(x, y, rw, rh);
        ctx.strokeStyle = col; ctx.strokeRect(x, y, rw, rh);
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
function drawingColor(d) { return d.col || (d.type === 'hline' ? C.gold : C.accent); }
function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

addLayer('bottom', function (ctx) {
    if (!ind.boll) return;
    var b = S('boll'); if (!b.fill || !D.bUp.length) return;
    var ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if (!r) return;
    var a = Math.max(0, Math.floor(r.from) - 1), z = Math.min(candles.length - 1, Math.ceil(r.to) + 1), st = Math.max(1, Math.ceil((z - a) / 400));
    var up = [], lo = [];
    for (var i = a; i <= z; i += st) {
        if (D.bUp[i] == null) continue;
        var x = ts.logicalToCoordinate(i), yu = yOf(D.bUp[i]), yl = yOf(D.bLo[i]);
        if (x == null || yu == null || yl == null) continue;
        up.push(x, yu); lo.push(x, yl);
    }
    if (up.length < 4) return;
    ctx.beginPath(); ctx.moveTo(up[0], up[1]);
    for (var j = 2; j < up.length; j += 2) ctx.lineTo(up[j], up[j + 1]);
    for (var k = lo.length - 2; k >= 0; k -= 2) ctx.lineTo(lo[k], lo[k + 1]);
    ctx.closePath(); ctx.fillStyle = hexA(b.cBand, b.fillA / 100); ctx.fill();
});
addLayer('top', function (ctx, w, h) {
    if (!DR.hidden) DR.list.forEach(function (d) { paint(ctx, d, d.id === DR.sel, w, h); });
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
    if (t && DR.hidden) { DR.hidden = false; LS.set('drHidden', false); }
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
        if (DR.hidden) return;
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
// A finger on the price axis always scales it (vertical drag); on the chart body vertical drags move the price only when
// the "drag chart up/down" option is on. The engine reads the option while the gesture runs, so it is set on touch start.
wrap.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    var want = local(e).x > chart.paneSize(0).width || S('chart').vdrag;
    if (chart.options().handleScroll.vertTouchDrag !== want) chart.applyOptions({ handleScroll: { vertTouchDrag: want } });
}, true);
['pointerup', 'pointercancel', 'wheel', 'dblclick'].forEach(function (t) {
    wrap.addEventListener(t, function () { setTimeout(syncScaleBtns, 40); setTimeout(scheduleTags, 60); scheduleCd(); }, { capture: true, passive: true });
});
wrap.addEventListener('pointermove', scheduleCd, { capture: true, passive: true });
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
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
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
    var ey = document.createElement('button'); ey.className = 'tool'; ey.id = 'eye'; ey.innerHTML = ICON.eye + '<span>숨기기</span>';
    ey.onclick = function () { setDrawingsHidden(!DR.hidden); };
    r.appendChild(ey);
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
    var ey = $('eye'); if (ey) { ey.className = 'tool' + (DR.hidden ? ' active' : ''); ey.querySelector('span').textContent = DR.hidden ? '보이기' : '숨기기'; }
    var tr = $('trash'); if (tr) { tr.className = 'tool danger' + (trashArmed ? ' armed' : ''); tr.querySelector('span').textContent = trashArmed ? '전체삭제?' : (DR.sel != null ? '선택삭제' : '삭제'); }
    refreshDrBar();
    backState();
}
// Android's Back button first closes whatever is open inside the page; the app is told whether there is something to close.
var lastBack = false;
function backState() {
    var v = $('sheet_bg').classList.contains('show') || !!DR.tool || DR.sel != null;
    if (v !== lastBack) { lastBack = v; bridge('backState', v ? '1' : '0'); }
}
window.cfBack = function () {
    if ($('sheet_bg').classList.contains('show')) closeSheet();
    else if (DR.tool) setTool(null);
    else if (DR.sel != null) { DR.sel = null; refreshRail(); DR.redraw(); }
    backState();
    return true;
};
// floating style bar for the selected drawing: color, thickness, dash, delete
var DR_COLORS = ['#2962FF', '#F0B90B', '#F6465D', '#0ECB81', '#FFFFFF', '#B388FF'];
function refreshDrBar() {
    var bar = $('dr_bar'), d = DR.list.filter(function (x) { return x.id === DR.sel; })[0];
    if (!d || DR.tool) { bar.className = ''; return; }
    var cur = drawingColor(d).toLowerCase(), html = '';
    if (d.type !== 'fib') {
        DR_COLORS.forEach(function (c) { html += '<button class="sw' + (cur === c.toLowerCase() ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>'; });
        html += '<span class="vsep"></span>';
    }
    html += '<button class="tag" data-a="w">' + Math.round(d.w || 1.6) + 'px</button>' +
        '<button class="tag" data-a="s">' + (d.ds === 1 ? '- - -' : d.ds === 2 ? '· · ·' : '───') + '</button>' +
        '<span class="vsep"></span><button class="tag" data-a="x" style="color:' + C.down + '">삭제</button>';
    bar.innerHTML = html; bar.className = 'show';
}
$('dr_bar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var d = DR.list.filter(function (x) { return x.id === DR.sel; })[0]; if (!d) return;
    if (b.getAttribute('data-c')) d.col = b.getAttribute('data-c');
    else if (b.getAttribute('data-a') === 'w') d.w = Math.round(d.w || 1.6) >= 3 ? 1 : Math.round(d.w || 1.6) + 1;
    else if (b.getAttribute('data-a') === 's') d.ds = ((d.ds || 0) + 1) % 3;
    else if (b.getAttribute('data-a') === 'x') { onTrash(); return; }
    DR.save(); DR.redraw(); refreshDrBar();
});
function setDrawingsHidden(on) {
    DR.hidden = !!on; LS.set('drHidden', DR.hidden);
    if (DR.hidden) { DR.sel = null; if (DR.tool) setTool(null); }
    refreshRail(); DR.redraw();
    toast(DR.hidden ? '그린 선을 숨겼어요' : '그린 선을 다시 표시합니다');
}
function onTrash() {
    if (DR.sel != null) {
        var gone = DR.list.filter(function (d) { return d.id === DR.sel; });
        DR.list = DR.list.filter(function (d) { return d.id !== DR.sel; }); DR.sel = null; DR.save(); DR.redraw(); refreshRail();
        if (gone.length) toast('그림을 지웠어요', '되돌리기', function () { DR.list = DR.list.concat(gone); DR.sel = gone[0].id; DR.save(); DR.redraw(); refreshRail(); });
        return;
    }
    if (!DR.list.length && !DR.measure) { toast('지울 그림이 없습니다'); return; }
    if (trashArmed) {
        clearTimeout(trashArmed); trashArmed = null;
        var all = DR.list.slice(); DR.list = []; DR.measure = null; DR.save(); DR.redraw(); refreshRail();
        if (all.length) toast('그림 ' + all.length + '개를 지웠어요', '되돌리기', function () { DR.list = all; DR.save(); DR.redraw(); refreshRail(); });
        return;
    }
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
    var s = $('sheet'); s.innerHTML = '<h3><span>' + title + '</span><button class="x" aria-label="닫기">✕</button></h3>';
    s.querySelector('.x').onclick = closeSheet;
    rows.forEach(function (r) { s.appendChild(r); });
    if (footer) s.appendChild(footer);
    $('sheet_bg').classList.remove('live'); $('sheet_bg').classList.add('show');
    backState();
}
function closeSheet() { $('sheet_bg').classList.remove('show', 'live'); settingsKey = null; backState(); }
$('sheet_bg').addEventListener('click', function (e) { if (e.target === $('sheet_bg')) closeSheet(); });

function switchRow(text, sub, key, gear) {
    var hasGear = gear && SCHEMA[key];
    var b = document.createElement('div'); b.className = 'row-opt'; b.setAttribute('role', 'button');
    b.innerHTML = '<span style="flex:1">' + text + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
        (hasGear ? '<button class="gear" aria-label="설정">⚙</button>' : '') + '<span class="switch' + (ind[key] ? ' on' : '') + '"></span>';
    b.onclick = function (e) {
        if (hasGear && e.target.closest('.gear')) { openSettings(key, openIndicators); return; }
        ind[key] = !ind[key]; LS.set('ind', ind);
        b.querySelector('.switch').classList.toggle('on', ind[key]);
        applyIndicators();
    };
    return b;
}
function mergeRow() {
    var b = document.createElement('div'); b.className = 'row-opt'; b.setAttribute('role', 'button');
    b.innerHTML = '<span style="flex:1">하단 지표 한 창에 합치기<small>RSI · MACD · CVD · OI · 청산을 하나의 창에 겹쳐 표시</small></span><span class="switch' + (S('chart').merge ? ' on' : '') + '"></span>';
    b.onclick = function () { setCfg('chart', 'merge', !S('chart').merge); b.querySelector('.switch').classList.toggle('on', S('chart').merge); };
    return b;
}
function sectionTitle(t) { var d = document.createElement('div'); d.className = 'sec'; d.textContent = t; return d; }
function noteRow(t) { var d = document.createElement('div'); d.className = 'note'; d.textContent = t; return d; }

// ---- generic settings sheet (built from the schema of each indicator) -------------------------------------------------
function colorStrip(cur, onPick) {
    var st = document.createElement('div'); st.className = 'sw-strip';
    var list = PALETTE.slice();
    if (list.map(function (c) { return c.toLowerCase(); }).indexOf(cur.toLowerCase()) < 0) list.unshift(cur);
    var dots = [];
    function mark(c) { dots.forEach(function (d) { d.el.classList.toggle('on', d.c.toLowerCase() === c.toLowerCase()); }); }
    list.forEach(function (c) {
        var b = document.createElement('button'); b.className = 'sw'; b.style.background = c; dots.push({ el: b, c: c });
        b.onclick = function (e) { e.stopPropagation(); mark(c); inp.value = c; onPick(c); };
        st.appendChild(b);
    });
    var inp = document.createElement('input'); inp.className = 'hex'; inp.type = 'text'; inp.value = cur; inp.maxLength = 7; inp.placeholder = '#RRGGBB';
    inp.onclick = function (e) { e.stopPropagation(); };
    inp.onchange = function () {
        var v = inp.value.trim(); if (v[0] !== '#') v = '#' + v;
        if (HEX.test(v)) { inp.value = v; mark(v); onPick(v); } else inp.value = cur;
    };
    mark(cur); st.appendChild(inp);
    return st;
}
function buildLines(key, f) {
    var box = document.createElement('div'), openAt = -1;
    function save(i, patch) {
        var arr = S(key)[f.k].map(function (l) { return Object.assign({}, l); });
        Object.assign(arr[i], patch); setCfg(key, f.k, arr);
    }
    function draw() {
        box.innerHTML = '';
        S(key)[f.k].forEach(function (l, i) {
            var row = document.createElement('div'); row.className = 'fld';
            row.innerHTML = '<div class="ln"><button class="chip-dot" style="background:' + l.c + '" aria-label="색상"></button>' +
                '<input type="number" inputmode="numeric" min="1" max="2000" value="' + l.p + '">' +
                (f.types ? '<button class="tag t">' + (l.t === 'ema' ? 'EMA' : 'SMA') + '</button>' : '') +
                '<button class="tag w">' + l.w + 'px</button>' +
                '<span class="switch' + (l.on ? ' on' : '') + '" style="margin-left:auto"></span></div>';
            var dot = row.querySelector('.chip-dot'), inp = row.querySelector('input');
            dot.onclick = function () { openAt = openAt === i ? -1 : i; draw(); };
            inp.onchange = function () { var n = Math.max(1, Math.min(2000, Math.floor(+inp.value) || l.p)); inp.value = n; save(i, { p: n }); };
            var tb = row.querySelector('.t'); if (tb) tb.onclick = function () { save(i, { t: l.t === 'ema' ? 'sma' : 'ema' }); draw(); };
            row.querySelector('.w').onclick = function () { save(i, { w: l.w >= 4 ? 1 : l.w + 1 }); draw(); };
            row.querySelector('.switch').onclick = function () { save(i, { on: !l.on }); draw(); };
            box.appendChild(row);
            if (openAt === i) { var fl = document.createElement('div'); fl.className = 'fld'; fl.style.paddingTop = '0'; fl.appendChild(colorStrip(l.c, function (c) { dot.style.background = c; save(i, { c: c }); })); box.appendChild(fl); }
        });
    }
    draw();
    return box;
}
function buildField(key, f, rerender) {
    var cur = S(key);
    if (f.showIf && !f.showIf(cur)) return null;
    var el = document.createElement('div');
    if (f.t === 'sec') { el.className = 'sec'; el.textContent = f.label; return el; }
    if (f.t === 'note') { el.className = 'note'; el.textContent = f.label; return el; }
    if (f.t === 'lines') return buildLines(key, f);
    el.className = 'fld';
    var v = cur[f.k], sub = f.sub ? '<small>' + f.sub + '</small>' : '';
    if (f.t === 'bool') {
        el.innerHTML = '<div class="top"><span>' + f.label + sub + '</span><span class="switch' + (v ? ' on' : '') + '"></span></div>';
        el.onclick = function () { setCfg(key, f.k, !S(key)[f.k]); rerender(); };
    } else if (f.t === 'num') {
        el.innerHTML = '<div class="top"><span>' + f.label + '</span><input type="number" inputmode="decimal" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '" value="' + v + '"></div>';
        var inp = el.querySelector('input');
        inp.onchange = function () { var n = parseFloat(inp.value); if (!isFinite(n)) n = f.def; n = clampN(n, f.min, f.max); inp.value = n; setCfg(key, f.k, n); };
    } else if (f.t === 'range') {
        var fmt = function (n) { return (f.step < 1 ? n.toFixed(1) : String(Math.round(n))) + (f.unit || ''); };
        el.innerHTML = '<div class="top"><span>' + f.label + '</span><span class="val">' + fmt(v) + '</span></div>' +
            '<input type="range" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '" value="' + v + '">';
        var rg = el.querySelector('input'), vl = el.querySelector('.val');
        rg.oninput = function () { var n = parseFloat(rg.value); vl.textContent = fmt(n); setCfg(key, f.k, n); };
    } else if (f.t === 'color') {
        el.innerHTML = '<div class="top"><span>' + f.label + '</span><span class="chip-dot" style="background:' + v + '"></span></div>';
        var strip = null, dot = el.querySelector('.chip-dot');
        el.querySelector('.top').onclick = function () {
            if (strip) { strip.remove(); strip = null; return; }
            strip = colorStrip(S(key)[f.k], function (c) { dot.style.background = c; setCfg(key, f.k, c); });
            el.appendChild(strip);
        };
    } else if (f.t === 'sel') {
        el.innerHTML = '<div class="top"><span>' + f.label + '</span></div><div class="seg"></div>';
        var seg = el.querySelector('.seg');
        f.opts.forEach(function (o) {
            var b = document.createElement('button'); b.className = o[0] === v ? 'on' : ''; b.textContent = o[1];
            b.onclick = function () { setCfg(key, f.k, o[0]); rerender(); };
            seg.appendChild(b);
        });
    }
    return el;
}
var settingsKey = null;
function openSettings(key, back) {
    var def = SCHEMA[key]; if (!def) return;
    var sheet = $('sheet'), keep = settingsKey === key ? sheet.scrollTop : 0;
    settingsKey = key; sheet.innerHTML = '';
    var h = document.createElement('h3');
    h.innerHTML = (back ? '<button class="back" aria-label="뒤로">‹</button>' : '') + '<span>' + def.title + '</span><button class="x" aria-label="닫기">✕</button>';
    h.querySelector('.x').onclick = closeSheet;
    if (back) h.querySelector('.back').onclick = back;
    sheet.appendChild(h);
    var rerender = function () { openSettings(key, back); };
    def.fields.forEach(function (f) { var r = buildField(key, f, rerender); if (r) sheet.appendChild(r); });
    var rs = document.createElement('button'); rs.className = 'reset'; rs.textContent = '기본값으로 되돌리기';
    rs.onclick = function () { resetCfg(key); rerender(); };
    sheet.appendChild(rs);
    if (def.credit) { var cr = document.createElement('div'); cr.className = 'credit'; cr.textContent = def.credit; sheet.appendChild(cr); }
    $('sheet_bg').classList.add('show', 'live');
    sheet.scrollTop = keep;
    backState();
}
$('cfg_btn').onclick = function () { openSettings('chart'); };

function openIndicators() {
    settingsKey = null;
    var maLines = S('ma').lines.filter(function (l) { return l.on; }).map(function (l) { return l.p; }).join(' · ');
    var b = S('boll'), r = S('rsi'), m = S('macd');
    openSheet('지표', [
        sectionTitle('기본'),
        switchRow('거래량', '', 'vol', true),
        switchRow('이동평균선', maLines, 'ma', true),
        switchRow('지수이동평균', 'EMA ' + S('ema').lines.map(function (l) { return l.p; }).join(' · '), 'ema', true),
        switchRow('볼린저 밴드', b.period + ', ' + b.mult, 'boll', true),
        switchRow('RSI', r.period + ' · 별도 창', 'rsi', true),
        switchRow('MACD', m.fast + ', ' + m.slow + ', ' + m.signal + ' · 별도 창', 'macd', true),
        sectionTitle('오더플로우'),
        switchRow('CVD · 델타', '누적 체결 델타 (매수-매도 체결량)', 'cvd', true),
        switchRow('미결제약정 (OI)', 'Binance 선물 · 별도 창', 'oi', true),
        switchRow('실시간 청산', '청산 주문 버블 + 봉별 청산량', 'liq', true),
        switchRow('대량 체결', '큰 체결만 버블로 표시', 'trades', true),
        sectionTitle('호가창 · 청산맵'),
        switchRow('호가 벽', '매수/매도 벽 · 우측 깊이 막대', 'depth', true),
        switchRow('호가 히트맵', '유동성 변화를 시간별 색으로', 'heat', true),
        switchRow('추정 청산맵', 'OI·레버리지 기반 추정(모델)', 'liqmap', true),
        switchRow('Bid / Ask 라인', '최우선 매수·매도 호가 · 스프레드 (무료 공개 데이터)', 'bidask', true),
        sectionTitle('표시'),
        mergeRow(),
        noteRow('⚙ 를 누르면 지표별 색상·두께·기간 등 세부 설정을 바꿀 수 있습니다. 실시간 항목은 켜 둔 동안에만 데이터를 받고, 차트를 벗어나면 자동으로 멈춥니다.')
    ]);
}
$('ind_btn').onclick = openIndicators;
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
var legendOpen = LS.get('legendOpen', false);
function renderLegend() {
    var n = candles.length; if (!n) { $('legend').innerHTML = ''; placeCd(); return; }
    var mode = S('chart').legend;
    if (mode === 'off') { $('legend').innerHTML = ''; placeCd(); return; }
    var i = crossTime != null ? indexOfTime(crossTime) : -1; if (i < 0) i = n - 1;
    var c = candles[i], b = chartType === 'ha' && haBars[i] ? haBars[i] : c;
    var cls = c.close >= c.open ? 'up' : 'down', chg = c.open ? (c.close - c.open) / c.open * 100 : 0;
    var open = mode === 'full' && (legendOpen || crossTime != null);
    var l1 = '<div class="row">O <span class="' + cls + '">' + fmtPrice(b.open) + '</span> H <span class="' + cls + '">' + fmtPrice(b.high) +
        '</span> L <span class="' + cls + '">' + fmtPrice(b.low) + '</span> C <span class="' + cls + '">' + fmtPrice(b.close) + '</span> <span class="' + cls + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>';
    if (ind.vol) l1 += ' &nbsp;Vol <b>' + fmtVol(c.volume) + '</b>';
    if (mode === 'full') l1 += '<button class="lg-t" id="lg_t" aria-label="지표 값 펼치기">' + (open ? '▴' : '▾') + '</button>';
    l1 += '</div>';
    var parts = [];
    if (open) {
        if (ind.ma) S('ma').lines.forEach(function (m, k) { if (!m.on) return; var v = val(D.ma[k], i); if (v) parts.push('<span style="color:' + m.c + '">' + (m.t === 'ema' ? 'EMA' : 'MA') + m.p + ' ' + v + '</span>'); });
        if (ind.ema) S('ema').lines.forEach(function (m, k) { if (!m.on) return; var v = val(D.ema[k], i); if (v) parts.push('<span style="color:' + m.c + '">EMA' + m.p + ' ' + v + '</span>'); });
        if (ind.boll && D.bMid[i] != null) {
            var bc = S('boll');
            parts.push('<span style="color:' + bc.cMid + '">BOLL ' + fmtPrice(D.bMid[i]) + '</span> <span style="color:' + bc.cBand + '">' + fmtPrice(D.bUp[i]) + ' / ' + fmtPrice(D.bLo[i]) + '</span>');
        }
        Object.keys(subLive).forEach(function (key) { var h = SUBS[key].legend && SUBS[key].legend(i, c); if (h) parts.push(h); });
        Object.keys(features).forEach(function (key) {
            var f = features[key]; if (!f.running || !f.legend) return;
            var h = f.legend(i, c); if (h) parts.push(h);
        });
    }
    var l2 = parts.length ? '<div class="row">' + parts.join(' &nbsp;') + '</div>' : '';
    $('legend').innerHTML = l1 + l2;
    placeCd();
}
$('legend').addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#lg_t')) return;
    legendOpen = !legendOpen; LS.set('legendOpen', legendOpen); renderLegend();
});
chart.subscribeCrosshairMove(function (param) { crossTime = param && param.time ? param.time : null; scheduleLegend(); });

// countdown to the candle close, shown right under the last-price label on the axis
function placeCd() {
    var el = $('cd_tag'); if (!el) return;
    if (!candles.length || !active) { el.style.display = 'none'; return; }
    var last = candles[candles.length - 1], y = mainSeries().priceToCoordinate(last.close), ph = chart.paneSize(0).height;
    if (y == null || y + 26 > ph || y < 0 || !S('chart').lastLine) { el.style.display = 'none'; return; }
    var left = last.time + curSec() - Math.floor(Date.now() / 1000);
    if (left < 0) left = 0;
    var hh = Math.floor(left / 3600), mm = Math.floor(left % 3600 / 60), ss = left % 60, pw = chart.priceScale('right').width();
    el.style.display = 'block'; el.style.top = (y + 10) + 'px'; if (pw > 0) el.style.width = pw + 'px';
    el.style.background = hexA(last.close >= last.open ? C.up : C.down, 0.85);
    el.textContent = (hh ? hh + ':' + pad2(mm) : pad2(mm)) + ':' + pad2(ss);
}
var cdRaf = 0;
function scheduleCd() { if (cdRaf) return; cdRaf = requestAnimationFrame(function () { cdRaf = 0; placeCd(); }); }
function updateCountdown() { placeCd(); }
var cdTimer = null;
var connLostAt = 0;
function checkConn() {
    var pill = $('conn'); if (!pill) return;
    var down = active && started && candles.length > 0 && (!streams.market.open || navigator.onLine === false);
    if (!down) { connLostAt = 0; pill.className = ''; return; }
    if (!connLostAt) connLostAt = Date.now();
    if (Date.now() - connLostAt < 3500) return;                      // short blips are not worth a banner
    pill.textContent = navigator.onLine === false ? '오프라인 · 네트워크를 확인하세요' : '실시간 연결 끊김 · 재연결 중…';
    pill.className = 'show';
}
function startTimers() { stopTimers(); cdTimer = setInterval(function () { updateCountdown(); checkConn(); }, 1000); }
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
    scheduleCd();
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
    var pf = { type: 'custom', minMove: Math.pow(10, -dec), formatter: fmtPrice };       // thousands separators, fixed decimals
    [candleSeries, lineSeries, areaSeries].forEach(function (s) { s.applyOptions({ priceFormat: pf }); });
    Object.keys(subLive).forEach(function (key) { if (SUBS[key].style) SUBS[key].style(subLive[key]); });
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
    compactFormat: COMPACT,
    refreshSub: function (key) { if (subLive[key]) SUBS[key].setData(subLive[key]); scheduleLegend(); },
    scheduleLegend: scheduleLegend, hexA: hexA,
    defineSettings: defineSettings, S: S, setCfg: setCfg, scheduleRefresh: scheduleRefresh,
    styleSubs: function () { Object.keys(subLive).forEach(function (key) { if (SUBS[key].style) SUBS[key].style(subLive[key]); }); scheduleLegend(); }
};

// =====================================================================================================
// Boot
// =====================================================================================================
function boot() {
    buildRail(); buildIntervals(); refreshTypeBtn();
    $('app').classList.toggle('rail-closed', !railOpen);
    document.documentElement.style.setProperty('--bg', C.bg);
    DR.attachTo(mainSeries());
    applyChartCfg();
    applyType(); applyIndicators();
    syncScaleBtns();
    startTimers();
    // The native layer calls loadSymbol() as soon as the page has loaded; standalone, start anyway.
    setTimeout(function () { if (!started) window.loadSymbol(symbol); }, 700);
}
window.addEventListener('DOMContentLoaded', boot);
window.__cf = { chart: chart, DR: DR, get candles() { return candles; }, get interval() { return interval; }, setTool: setTool, ind: ind, get D() { return D; }, features: features, subs: SUBS, get live() { return subLive; }, S: S, P: P };
})();
