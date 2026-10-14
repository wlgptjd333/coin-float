(function () {
'use strict';

// =====================================================================================================
// Constants & small helpers
// =====================================================================================================
var C = { up: '#0ECB81', down: '#F6465D', bg: '#131722', grid: '#1E222D', text: '#848E9C', border: '#2A2E39', accent: '#2962FF', gold: '#F0B90B' };
var INTERVALS = [
    ['1m', '1m', 60], ['3m', '3m', 180], ['5m', '5m', 300], ['15m', '15m', 900], ['30m', '30m', 1800],
    ['1h', '1h', 3600], ['2h', '2h', 7200], ['4h', '4h', 14400], ['6h', '6h', 21600], ['12h', '12h', 43200],
    ['1d', '1D', 86400], ['3d', '3D', 259200], ['1w', '1W', 604800], ['1M', '1M', 2592000]
];
var SEC = {}; INTERVALS.forEach(function (i) { SEC[i[0]] = i[2]; });
var REST = 'https://fapi.binance.com/fapi/v1/klines';
var WS_URL = 'wss://fstream.binance.com/market/stream';
var MAX_BARS = 20000;                // history kept in memory: zooming out keeps loading older pages up to this
var PAGE = 1500;                     // candles per history request (the exchange maximum)
// candle width limits in px. 0.08 is ~5,000 candles per phone screen; beyond that every frame gets slow (measured),
// a higher interval shows the same span far cheaper.
var MIN_BAR_SPACING = 0.08, MAX_BAR_SPACING = 50;
// Multiple moving averages: periods are in candles of the current interval. Colors: red, yellow, green, blue, white, purple.
var MA_DEFAULT = [[5, '#F6465D'], [10, '#F0B90B'], [50, '#0ECB81'], [100, '#00BCD4'], [200, '#FFFFFF'], [400, '#B388FF']];
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
var MAX_LINES = 10;
function fixLines(f, v) {
    var src = Array.isArray(v) && v.length ? v.slice(0, MAX_LINES) : f.def;
    return src.map(function (s, i) {
        var d = f.def[i] || { on: true, p: 20, c: PALETTE[i % PALETTE.length], w: 1, t: f.def[0].t };
        s = s || {};
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

function lineDef(arr, type, width) { return arr.map(function (d) { return { p: d[0], c: d[1], w: width || 1, t: type, on: d[2] !== false }; }); }
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
    title: '거래량 설정', onChange: calcChanged,
    fields: [
        { k: 'follow', t: 'bool', label: '캔들 색상 따르기', def: true },
        { k: 'up', t: 'color', label: '상승 거래량 색', def: '#0ECB81', showIf: function (c) { return !c.follow; } },
        { k: 'down', t: 'color', label: '하락 거래량 색', def: '#F6465D', showIf: function (c) { return !c.follow; } },
        { k: 'opacity', t: 'range', label: '진하기', def: 38, min: 10, max: 100, step: 1, unit: '%' },
        { k: 'height', t: 'range', label: '차지하는 높이', def: 18, min: 8, max: 50, step: 1, unit: '%' },
        { t: 'sec', label: '거래량 이동평균' },
        { k: 'maOn', t: 'bool', label: '거래량 이동평균선', sub: '평균보다 큰 거래량이 한눈에 보입니다', def: false },
        { k: 'maLen', t: 'num', label: '기간', def: 20, min: 2, max: 200, step: 1, showIf: function (c) { return c.maOn; } },
        { k: 'maColor', t: 'color', label: '선 색', def: '#2962FF', showIf: function (c) { return c.maOn; } }
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
defineSettings('vp', {
    title: '볼륨 프로파일 (매물대) 설정', onChange: function () { vpCache.key = ''; DR.redraw(); scheduleLegend(); },
    fields: [
        { k: 'range', t: 'sel', label: '계산 구간', def: 'visible', opts: [['visible', '화면에 보이는 봉'], ['all', '불러온 전체 봉']] },
        { k: 'rows', t: 'range', label: '가격 구간 수', def: 48, min: 16, max: 120, step: 4 },
        { k: 'side', t: 'sel', label: '위치', def: 'left', opts: [['left', '왼쪽'], ['right', '오른쪽 (호가 막대와 겹침)']] },
        { k: 'width', t: 'range', label: '막대 최대 길이', def: 26, min: 10, max: 50, step: 1, unit: '%' },
        { k: 'opacity', t: 'range', label: '진하기', def: 30, min: 10, max: 80, step: 1, unit: '%' },
        { k: 'split', t: 'bool', label: '매수 · 매도 체결 나눠 보기', def: true },
        { k: 'va', t: 'bool', label: '가치 영역(거래량 70%) 강조', def: true },
        { k: 'poc', t: 'bool', label: 'POC (최대 거래 가격) 선', def: true },
        { k: 'trades', t: 'bool', label: '실제 체결 가격 사용', sub: '풋프린트가 켜져 체결이 모인 구간은 실제 체결된 가격으로 계산합니다', def: true },
        { t: 'note', label: '가격대별 거래량입니다. 막대가 긴 가격대(매물대)는 지지·저항이 되기 쉽습니다. 체결 기록이 없는 봉은 거래량을 고가~저가 구간에 고르게 나눠 추정합니다.' }
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
        { k: 'os', t: 'num', label: '과매도 기준', def: 30, min: 1, max: 50, step: 1, showIf: function (c) { return c.levels; } },
        { k: 'band', t: 'bool', label: '과매수 ~ 과매도 구간 배경', def: true, showIf: function (c) { return c.levels; } },
        { k: 'mid', t: 'bool', label: '50 중심선', def: true },
        { t: 'sec', label: 'RSI 이동평균' },
        { k: 'maOn', t: 'bool', label: 'RSI 이동평균선', sub: 'RSI가 이 선을 위로 뚫으면 힘이 붙는 신호로 봅니다', def: true },
        { k: 'maType', t: 'sel', label: '종류', def: 'sma', opts: [['sma', 'SMA'], ['ema', 'EMA']], showIf: function (c) { return c.maOn; } },
        { k: 'maLen', t: 'num', label: '기간', def: 14, min: 2, max: 100, step: 1, showIf: function (c) { return c.maOn; } },
        { k: 'maColor', t: 'color', label: '선 색', def: '#F7C548', showIf: function (c) { return c.maOn; } }
    ]
});
defineSettings('macd', {
    title: 'MACD 설정', onChange: calcChanged,
    fields: [
        { t: 'sec', label: '계산' },
        { k: 'fast', t: 'num', label: '단기 EMA', def: 12, min: 2, max: 100, step: 1 },
        { k: 'slow', t: 'num', label: '장기 EMA', def: 26, min: 3, max: 200, step: 1 },
        { k: 'signal', t: 'num', label: '시그널', def: 9, min: 2, max: 100, step: 1 },
        { k: 'oscType', t: 'sel', label: 'MACD 이평 종류', def: 'ema', opts: [['ema', 'EMA'], ['sma', 'SMA']] },
        { k: 'sigType', t: 'sel', label: '시그널 이평 종류', def: 'ema', opts: [['ema', 'EMA'], ['sma', 'SMA']] },
        { t: 'sec', label: '스타일' },
        { k: 'cMacd', t: 'color', label: 'MACD 선 색', def: '#2962FF' },
        { k: 'cSig', t: 'color', label: '시그널 선 색', def: '#FF9800' },
        { k: 'width', t: 'range', label: '선 두께', def: 1, min: 1, max: 4, step: 1, unit: 'px' },
        { k: 'hist', t: 'bool', label: '히스토그램 표시', def: true },
        { k: 'hist4', t: 'bool', label: '히스토그램 4색', sub: '0 위/아래 × 커지는지/줄어드는지에 따라 진하기가 달라집니다 (트레이딩뷰 기본)', def: true, showIf: function (c) { return c.hist; } }
    ]
});
defineSettings('vwap', {
    title: 'VWAP 설정', onChange: calcChanged,
    fields: [
        { k: 'anchor', t: 'sel', label: '초기화 기준', def: 'day', opts: [['day', '매일 (UTC 0시)'], ['week', '매주 (월요일)'], ['month', '매월']] },
        { k: 'color', t: 'color', label: '선 색', def: '#2962FF' },
        { k: 'width', t: 'range', label: '선 두께', def: 2, min: 1, max: 4, step: 1, unit: 'px' },
        { t: 'sec', label: '표준편차 밴드' },
        { k: 'b1', t: 'bool', label: '밴드 1', def: true },
        { k: 'm1', t: 'num', label: '밴드 1 배수', def: 1, min: 0.1, max: 5, step: 0.1, showIf: function (c) { return c.b1; } },
        { k: 'b2', t: 'bool', label: '밴드 2', def: false },
        { k: 'm2', t: 'num', label: '밴드 2 배수', def: 2, min: 0.1, max: 5, step: 0.1, showIf: function (c) { return c.b2; } },
        { k: 'bandColor', t: 'color', label: '밴드 색', def: '#4CAF50', showIf: function (c) { return c.b1 || c.b2; } },
        { t: 'note', label: '거래량 가중 평균 가격입니다. 기준 시점부터 거래된 물량의 평균 단가라, 위면 매수 쪽이 유리하고 아래면 매도 쪽이 유리한 구간으로 봅니다. 가격은 (고가+저가+종가)/3 을 씁니다.' }
    ]
});
defineSettings('st', {
    title: '슈퍼트렌드 설정', onChange: calcChanged,
    fields: [
        { k: 'period', t: 'num', label: 'ATR 기간', def: 10, min: 1, max: 100, step: 1 },
        { k: 'factor', t: 'num', label: '배수', def: 3, min: 0.5, max: 10, step: 0.1 },
        { k: 'up', t: 'color', label: '상승 추세 색', def: '#0ECB81' },
        { k: 'down', t: 'color', label: '하락 추세 색', def: '#F6465D' },
        { k: 'width', t: 'range', label: '선 두께', def: 2, min: 1, max: 4, step: 1, unit: 'px' },
        { t: 'note', label: 'ATR(평균 변동폭)만큼 떨어진 추적 선입니다. 종가가 선을 뚫으면 추세가 바뀝니다. 기간을 늘리거나 배수를 키우면 신호가 줄고 느려집니다.' }
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
    cvd: false, oi: false, liq: false, trades: false, depth: false, heat: false, liqmap: false, bidask: false, vp: false,
    vwap: false, st: false, fp: false, dom: false, xex: false
}, LS.get('ind', {}));
var railOpen = LS.get('rail', false);
var active = true, immersive = false, started = false;
var precision = 2;

var candles = [];            // { time(sec), open, high, low, close, volume, buy(taker-buy volume) }
var haBars = [];             // heikin-ashi view of candles (same indexes)
var loadSeq = 0, loadingOlder = false, noMoreOlder = false;

function normInterval(v) { v = String(v || '').trim(); if (SEC[v]) return v; v = v.toLowerCase(); return SEC[v] ? v : '15m'; }
// open time of the candle after the one opening at t (months have different lengths)
function nextOpen(t) {
    if (interval !== '1M') return t + curSec();
    var d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}
function curSec() { return SEC[interval] || 900; }

// =====================================================================================================
// Formatting
// =====================================================================================================
// The engine calls the price formatter for every axis label, every frame. toLocaleString() with options builds a new
// formatter on each call and was the single biggest cost of a frame (measured), so one formatter per precision is kept.
var priceFmts = {};
function fmtPrice(p) {
    if (p == null || isNaN(p)) return '—';
    var f = priceFmts[precision] || (priceFmts[precision] = new Intl.NumberFormat('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision }));
    return f.format(p);
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
    timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: MIN_BAR_SPACING, maxBarSpacing: MAX_BAR_SPACING, tickMarkFormatter: tickFmt },
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
var vwS = overlayLine('#2962FF', 2, true), vwU1 = overlayLine('#4CAF50', 1, true), vwL1 = overlayLine('#4CAF50', 1, true), vwU2 = overlayLine('#4CAF50', 1, true), vwL2 = overlayLine('#4CAF50', 1, true);
var stS = overlayLine('#0ECB81', 2, true);
var stDrawn = { i: -1, dir: 0 }, vwDrawn = -1;
var volMaS = chart.addSeries(LW.LineSeries, { color: '#2962FF', lineWidth: 1, priceScaleId: '', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible: false, priceFormat: { type: 'volume' } });

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
// the line series follow the number of average lines in the settings
function fitPool(pool, n) {
    while (pool.length < n) pool.push(overlayLine('#FFFFFF', 1, true));
    while (pool.length > n) { var se = pool.pop(); try { chart.removeSeries(se); } catch (e) { /* gone */ } }
}
function newD() {
    P.ma = S('ma').lines; P.ema = S('ema').lines;
    fitPool(maS, P.ma.length); fitPool(emaS, P.ema.length);
    var b = S('boll'); P.bp = b.period; P.bm = b.mult;
    P.rsi = S('rsi').period;
    var m = S('macd'); P.fast = m.fast; P.slow = Math.max(m.slow, m.fast + 1); P.sig = m.signal;
    P.cvdDay = S('cvd').reset === 'day';
    var r = S('rsi'); P.rsiMa = r.maOn ? r.maLen : 0; P.rsiMaE = r.maType === 'ema';
    P.oscS = m.oscType === 'sma'; P.sigS = m.sigType === 'sma';
    var vo = S('vol'); P.volMa = vo.maOn ? vo.maLen : 0;
    var vw = S('vwap'); P.vwA = vw.anchor; P.vwM1 = vw.m1; P.vwM2 = vw.m2;
    var st = S('st'); P.stLen = st.period; P.stF = st.factor;
    return { cs: [], ma: P.ma.map(function () { return []; }), ema: P.ema.map(function () { return []; }), bMid: [], bUp: [], bLo: [], rsi: [], rsiG: [], rsiL: [], e12: [], e26: [], macd: [], sig: [], hist: [], cvd: [], delta: [],
        rsiCs: [], rsiMa: [], mcs: [], vcs: [], volMa: [], vwPV: [], vwV: [], vwPV2: [], vw: [], vwU1: [], vwL1: [], vwU2: [], vwL2: [],
        tr: [], atr: [], stFl: [], stFu: [], stDir: [], stUp: [], stDn: [] };
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
    // RSI-based moving average (TradingView's RSI shows one by default)
    D.rsiCs[i] = (i > 0 ? D.rsiCs[i - 1] : 0) + (D.rsi[i] == null ? 0 : D.rsi[i]);
    var rl = P.rsiMa;
    if (!rl || D.rsi[i] == null || i < RP + rl - 1) D.rsiMa[i] = null;
    else if (P.rsiMaE && D.rsiMa[i - 1] != null) D.rsiMa[i] = D.rsiMa[i - 1] + (2 / (rl + 1)) * (D.rsi[i] - D.rsiMa[i - 1]);
    else D.rsiMa[i] = (D.rsiCs[i] - D.rsiCs[i - rl]) / rl;
    var af = 2 / (P.fast + 1), as = 2 / (P.slow + 1), ag = 2 / (P.sig + 1);
    D.e12[i] = i === 0 ? close : D.e12[i - 1] + af * (close - D.e12[i - 1]);
    D.e26[i] = i === 0 ? close : D.e26[i - 1] + as * (close - D.e26[i - 1]);
    var fastV = P.oscS ? (i >= P.fast - 1 ? (D.cs[i] - (i >= P.fast ? D.cs[i - P.fast] : 0)) / P.fast : null) : D.e12[i];
    var slowV = P.oscS ? (i >= P.slow - 1 ? (D.cs[i] - (i >= P.slow ? D.cs[i - P.slow] : 0)) / P.slow : null) : D.e26[i];
    D.macd[i] = i >= P.slow - 1 && fastV != null && slowV != null ? fastV - slowV : null;
    D.mcs[i] = (i > 0 ? D.mcs[i - 1] : 0) + (D.macd[i] == null ? 0 : D.macd[i]);
    if (D.macd[i] == null) { D.sig[i] = null; D.hist[i] = null; }
    else {
        var ps = D.sig[i - 1];
        if (P.sigS) D.sig[i] = i >= P.slow - 1 + P.sig - 1 ? (D.mcs[i] - D.mcs[i - P.sig]) / P.sig : null;
        else D.sig[i] = ps != null ? ps + ag * (D.macd[i] - ps) : i >= P.slow - 1 + P.sig - 1 ? (D.mcs[i] - D.mcs[i - P.sig]) / P.sig : null;
        D.hist[i] = D.sig[i] == null ? null : D.macd[i] - D.sig[i];
    }
    // volume moving average
    D.vcs[i] = (i > 0 ? D.vcs[i - 1] : 0) + candles[i].volume;
    var vl = P.volMa; D.volMa[i] = vl && i >= vl - 1 ? (D.vcs[i] - (i >= vl ? D.vcs[i - vl] : 0)) / vl : null;
    stepVwap(i); stepSupertrend(i);
}
// VWAP anchored to the start of each day / week / month (UTC), with standard-deviation bands
function vwapPeriod(t) {
    if (P.vwA === 'month') { var d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
    if (P.vwA === 'week') return Math.floor((t / 86400 + 3) / 7);           // weeks start on Monday (1970-01-01 was a Thursday)
    return Math.floor(t / 86400);
}
function stepVwap(i) {
    var k = candles[i], tp = (k.high + k.low + k.close) / 3, v = k.volume;
    var fresh = i === 0 || vwapPeriod(k.time) !== vwapPeriod(candles[i - 1].time);
    D.vwPV[i] = (fresh ? 0 : D.vwPV[i - 1]) + tp * v;
    D.vwV[i] = (fresh ? 0 : D.vwV[i - 1]) + v;
    D.vwPV2[i] = (fresh ? 0 : D.vwPV2[i - 1]) + tp * tp * v;
    var vw = D.vwV[i] > 0 ? D.vwPV[i] / D.vwV[i] : tp, sd = D.vwV[i] > 0 ? Math.sqrt(Math.max(0, D.vwPV2[i] / D.vwV[i] - vw * vw)) : 0;
    D.vw[i] = vw;
    D.vwU1[i] = vw + P.vwM1 * sd; D.vwL1[i] = vw - P.vwM1 * sd;
    D.vwU2[i] = vw + P.vwM2 * sd; D.vwL2[i] = vw - P.vwM2 * sd;
}
// Supertrend (as TradingView's ta.supertrend): ATR by Wilder's smoothing, bands at hl2 ± factor·ATR that only tighten,
// trend flips when the close crosses the active band
function stepSupertrend(i) {
    var k = candles[i], len = P.stLen, pc = i > 0 ? candles[i - 1].close : k.close;
    D.tr[i] = i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - pc), Math.abs(k.low - pc));
    if (i < len - 1) D.atr[i] = null;
    else if (i === len - 1 || D.atr[i - 1] == null) { var sum = 0; for (var j = i - len + 1; j <= i; j++) sum += D.tr[j]; D.atr[i] = sum / len; }
    else D.atr[i] = (D.atr[i - 1] * (len - 1) + D.tr[i]) / len;
    if (D.atr[i] == null) { D.stFl[i] = D.stFu[i] = D.stDir[i] = D.stUp[i] = D.stDn[i] = null; return; }
    var hl2 = (k.high + k.low) / 2, up = hl2 + P.stF * D.atr[i], lo = hl2 - P.stF * D.atr[i];
    var pFl = D.stFl[i - 1], pFu = D.stFu[i - 1], pDir = D.stDir[i - 1];
    D.stFl[i] = pFl == null || lo > pFl || pc < pFl ? lo : pFl;
    D.stFu[i] = pFu == null || up < pFu || pc > pFu ? up : pFu;
    // the first bar with an ATR starts in a downtrend (upper band), like TradingView
    var dir = pDir == null ? -1 : pDir === 1 ? (k.close < D.stFl[i] ? -1 : 1) : (k.close > D.stFu[i] ? 1 : -1);
    D.stDir[i] = dir;
    D.stUp[i] = dir === 1 ? D.stFl[i] : null; D.stDn[i] = dir === -1 ? D.stFu[i] : null;
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
function mainBar(i) { return tinted(chartType === 'ha' ? haBars[i] : barOf(candles[i])); }
function mainData() {
    if (chartType === 'line' || chartType === 'area') return candles.map(function (c) { return { time: c.time, value: c.close }; });
    if (chartType === 'ha') return haBars.map(tinted);
    return candles.map(function (c) { return tinted(barOf(c)); });
}
// Candle colors set by add-on scripts (Pine barcolor): owner -> { time: color }, for one symbol and interval
var barTints = {}, barTint = null;
function tinted(b) {
    var t = barTint && barTint.map[b.time];
    if (!t || barTint.key !== symbol + '|' + interval) return b;
    return Object.assign({}, b, typeof t === 'string' ? { color: t, wickColor: t, borderColor: t } : t);
}
function setBarTint(owner, map, key) {
    var had = !!barTints[owner];
    if (map && Object.keys(map).length) barTints[owner] = { map: map, key: key }; else if (had) delete barTints[owner]; else return;
    var prev = barTint && barTint.map || {}, merged = {}, owners = Object.keys(barTints);
    owners.forEach(function (o) { if (barTints[o].key === key) Object.assign(merged, barTints[o].map); });
    barTint = owners.length ? { map: merged, key: key } : null;
    if (chartType !== 'candle' && chartType !== 'ha') return;
    // a live run usually changes only the forming candle: update it instead of resending every candle
    var last = candles.length ? candles[candles.length - 1].time : null, other = false;
    Object.keys(prev).concat(Object.keys(merged)).some(function (t) { if (JSON.stringify(prev[t]) !== JSON.stringify(merged[t]) && +t !== last) other = true; return other; });
    if (other) candleSeries.setData(mainData()); else if (last != null) candleSeries.update(mainBar(candles.length - 1));
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
    volMaS.setData(ind.vol && P.volMa ? pts(D.volMa) : []);
    var vw = S('vwap');
    setVwapData();
    setStData();
    subsSetData();
    reportClose();
    emitData('all');
}
// Add-on modules (Pine scripts) follow the data: 'all' (new data set), 'new' (a candle opened), 'last' (forming candle moved)
var dataHooks = [], lastPushTime = 0;
function emitData(kind) {
    if (kind === 'all') lastPushTime = candles.length ? candles[candles.length - 1].time : 0;
    dataHooks.forEach(function (h) { try { h(kind); } catch (e) { console.error(e); } });
}
// The engine joins a line across whitespace, and a segment takes the color of the point it starts at; so a break
// (VWAP reset, Supertrend flip) is a transparent point right before it.
var CLEAR = 'rgba(0,0,0,0)';
function vwapPts(arr, color) {
    var out = [], n = candles.length;
    for (var i = 0; i < n; i++) {
        var brk = i + 1 < n && vwapPeriod(candles[i + 1].time) !== vwapPeriod(candles[i].time);
        out.push({ time: candles[i].time, value: arr[i], color: brk ? CLEAR : color });
    }
    return out;
}
function setVwapData() {
    var vw = S('vwap'), on = ind.vwap, b1 = hexA(vw.bandColor, 0.85), b2 = hexA(vw.bandColor, 0.6);
    vwS.setData(on ? vwapPts(D.vw, vw.color) : []);
    vwU1.setData(on && vw.b1 ? vwapPts(D.vwU1, b1) : []); vwL1.setData(on && vw.b1 ? vwapPts(D.vwL1, b1) : []);
    vwU2.setData(on && vw.b2 ? vwapPts(D.vwU2, b2) : []); vwL2.setData(on && vw.b2 ? vwapPts(D.vwL2, b2) : []);
    vwDrawn = candles.length - 1;
}
function stPoint(i, last) {
    var c = S('st'), dir = D.stDir[i], flip = !last && D.stDir[i + 1] != null && D.stDir[i + 1] !== dir;
    return { time: candles[i].time, value: dir === 1 ? D.stUp[i] : D.stDn[i], color: flip ? CLEAR : dir === 1 ? c.up : c.down };
}
function setStData() {
    var out = [], n = candles.length;
    if (ind.st) for (var i = 0; i < n; i++) if (D.stDir[i] != null) out.push(stPoint(i, i === n - 1));
    stS.setData(out);
    stDrawn = { i: n - 1, dir: D.stDir[n - 1] };
}
function histPts() {
    var out = [];
    for (var i = 0; i < candles.length; i++) if (D.hist[i] != null) out.push({ time: candles[i].time, value: D.hist[i], color: histColor(D.hist[i], D.hist[i - 1]) });
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
    if (ind.vol && P.volMa) { var vm = ptAt(D.volMa, i); if (vm) volMaS.update(vm); }
    if (ind.vwap) {
        // the first candle of a new period clears the previous point: rebuild once, otherwise just move the last point
        if (i > vwDrawn && i > 0 && vwapPeriod(c.time) !== vwapPeriod(candles[i - 1].time)) setVwapData();
        else {
            var vc = S('vwap'), b1 = hexA(vc.bandColor, 0.85), b2 = hexA(vc.bandColor, 0.6);
            vwS.update({ time: c.time, value: D.vw[i], color: vc.color });
            if (vc.b1) { vwU1.update({ time: c.time, value: D.vwU1[i], color: b1 }); vwL1.update({ time: c.time, value: D.vwL1[i], color: b1 }); }
            if (vc.b2) { vwU2.update({ time: c.time, value: D.vwU2[i], color: b2 }); vwL2.update({ time: c.time, value: D.vwL2[i], color: b2 }); }
            vwDrawn = i;
        }
    }
    if (ind.st && D.stDir[i] != null) {
        // a flip on the forming candle recolors the candle before it (the break): rebuild then; it is rare
        var same = (i === stDrawn.i && D.stDir[i] === stDrawn.dir) || (i === stDrawn.i + 1 && D.stDir[i] === D.stDir[i - 1]);
        if (same) { stS.update(stPoint(i, true)); stDrawn = { i: i, dir: D.stDir[i] }; } else setStData();
    }
    subsUpdate(i);
    var isNew = c.time !== lastPushTime; lastPushTime = c.time;
    emitData(isNew ? 'new' : 'last');
}

// ---- bottom panes (RSI, MACD, CVD, OI, liquidations ...) -----------------------------------------------------
var SUBS = {}, subLive = {};
function eachSeries(o, fn) { Object.keys(o).forEach(function (k) { if (k !== 'pl' && o[k] && o[k].priceScale) fn(o[k], k); }); }
function sidOpt(sid) { return sid ? { priceScaleId: sid } : {}; }
// Lower panes, TradingView-style. Every indicator with its own scale (RSI, MACD, CVD, OI, liquidations and Pine scripts
// that are not overlays) is a pane member. Members sit in groups: one group is one pane under the chart, its first member
// on the pane's right scale and the others on their own overlay scales; members can also be laid over the main chart.
// Panes can be reordered, merged, split, maximized or collapsed, and the layout (order, grouping, heights) is kept.
// A member that is switched off keeps its place, so switching it back on puts it where it was.
var pineMembers = {}, subMembers = {}, mounted = [], visGroups = [];
var paneLay = (function () {
    var l = LS.get('paneLay', null) || {}, arr = function (a) { return Array.isArray(a) ? a.filter(function (k) { return typeof k === 'string'; }) : []; };
    return { groups: (Array.isArray(l.groups) ? l.groups : []).map(arr).filter(function (g) { return g.length; }), main: arr(l.main),
        h: l.h && typeof l.h === 'object' ? l.h : {}, col: l.col && typeof l.col === 'object' ? l.col : {}, mainH: +l.mainH || 1,
        max: typeof l.max === 'string' ? l.max : null };
})();
function savePaneLay() { LS.set('paneLay', paneLay); }
function subMember(key) {
    return subMembers[key] || (subMembers[key] = {
        name: function () { return PANE_NAME[key] || key; },
        color: function () { return paneTagColor(key); },
        legend: function (i) { return SUBS[key].legend ? SUBS[key].legend(i, candles[i]) : ''; },
        settings: function () { if (SCHEMA[key]) openSettings(key); },
        close: function () { ind[key] = false; LS.set('ind', ind); applyIndicators(); },
        mount: function (pane, sid) {
            var o = subLive[key] = SUBS[key].create(pane, sid);
            if (sid) eachSeries(o, function (se) { try { se.priceScale().applyOptions({ scaleMargins: pane ? PANE_MARGINS : MAIN_OVERLAY_MARGINS }); } catch (e) { /* ignore */ } });
            if (SUBS[key].style) SUBS[key].style(o);
            if (candles.length) SUBS[key].setData(o);
        },
        unmount: function () { if (subLive[key]) { removeSubSeries(subLive[key]); delete subLive[key]; } }
    });
}
function memberOf(k) { return SUBS[k] ? subMember(k) : pineMembers[k]; }
var PANE_MARGINS = { top: 0.12, bottom: 0.1 }, MAIN_OVERLAY_MARGINS = { top: 0.62, bottom: 0.04 };
// ---- 3b. indicators merged into a pane follow its axis: drag the pane's price axis and every indicator in it stretches
// the same way; back to auto-fit (A, or a double tap on the axis) and they all are
function memberSeries(k) {
    var out = [];
    if (SUBS[k]) { if (subLive[k]) eachSeries(subLive[k], function (se) { out.push(se); }); }
    else if (pineMembers[k] && pineMembers[k].series) out = pineMembers[k].series();
    return out;
}
// the scales of a pane other than its right axis (in the main pane: only the indicators laid over it, not the volume)
function memberScales(p) {
    var keys = p === 0 ? paneLay.main.filter(function (k) { return mounted.indexOf(k) >= 0; }) : (visGroups.filter(function (v) { return v.pane === p; })[0] || { keys: [] }).keys;
    var seen = {}, out = [];
    keys.forEach(function (k) {
        memberSeries(k).forEach(function (se) {
            var id = se.options().priceScaleId;
            if (!id || id === 'right' || seen[id]) return;
            seen[id] = 1; out.push(se.priceScale());
        });
    });
    return out;
}
var scaleBase = {};            // pane -> { axis: its auto-fit range, sc: [[scale, auto-fit range]] } taken while still auto
function snapPaneScales() {
    var n = chart.panes().length;
    for (var p = 0; p < n; p++) {
        var rs = chart.priceScale('right', p);
        if (!rs.options().autoScale) continue;                       // keep the auto-fit range from before the first drag
        var r = rs.getVisibleRange(); if (!r) continue;
        scaleBase[p] = { axis: r, sc: memberScales(p).map(function (sc) { return [sc, sc.getVisibleRange()]; }).filter(function (x) { return x[1]; }) };
    }
}
function syncPaneScales() {
    var n = chart.panes().length;
    for (var p = 0; p < n; p++) {
        var rs = chart.priceScale('right', p), b = scaleBase[p];
        if (rs.options().autoScale) { memberScales(p).forEach(function (sc) { if (!sc.options().autoScale) sc.setAutoScale(true); }); continue; }
        var r = rs.getVisibleRange(); if (!b || !r) continue;
        var span = b.axis.to - b.axis.from; if (!(span > 0)) continue;
        var lo = (r.from - b.axis.from) / span, hi = (r.to - b.axis.from) / span;
        b.sc.forEach(function (x) { var a = x[1], s = a.to - a.from; try { x[0].setVisibleRange({ from: a.from + lo * s, to: a.from + hi * s }); } catch (e) { /* gone */ } });
    }
}
function activeKeys() { return Object.keys(SUBS).filter(function (k) { return ind[k]; }).concat(Object.keys(pineMembers)); }
function placeOf(k) {                                   // { main: true } | { gi: index in paneLay.groups } | null
    if (paneLay.main.indexOf(k) >= 0) return { main: true };
    for (var gi = 0; gi < paneLay.groups.length; gi++) if (paneLay.groups[gi].indexOf(k) >= 0) return { gi: gi };
    return null;
}
function forgetPaneKey(k) {
    paneLay.main = paneLay.main.filter(function (x) { return x !== k; });
    paneLay.groups = paneLay.groups.map(function (g) { return g.filter(function (x) { return x !== k; }); }).filter(function (g) { return g.length; });
    savePaneLay();
}
function groupH(g) { for (var i = 0; i < g.length; i++) if (paneLay.h[g[i]] > 0) return paneLay.h[g[i]]; return 0.3; }
function isCol(g) { return g.some(function (k) { return paneLay.col[k]; }); }
function isMax(g) { return !!paneLay.max && g.indexOf(paneLay.max) >= 0; }
function readPaneHeights() {                            // the heights the user dragged, before panes are rebuilt
    if (paneLay.max || !visGroups.length) return;
    var ps = chart.panes();
    try {
        if (ps[0] && ps[0].getStretchFactor) paneLay.mainH = ps[0].getStretchFactor();
        visGroups.forEach(function (v) {
            var p = ps[v.pane]; if (!p || isCol(v.g)) return;
            var f = p.getStretchFactor(); v.g.forEach(function (k) { paneLay.h[k] = f; });
        });
    } catch (e) { /* older engine */ }
}
var paneHT = 0;
function paneHeightsSoon() { clearTimeout(paneHT); paneHT = setTimeout(function () { if (visGroups.length) { readPaneHeights(); savePaneLay(); } }, 400); }
function applyPaneHeights() {
    var ps = chart.panes(), maxV = null;
    visGroups.forEach(function (v) { if (isMax(v.g)) maxV = v; });
    if (paneLay.max && !maxV) paneLay.max = null;
    try {
        if (ps[0]) ps[0].setStretchFactor(maxV ? 0.001 : paneLay.mainH || 1);
        visGroups.forEach(function (v) {
            var p = ps[v.pane]; if (!p) return;
            p.setStretchFactor(maxV ? (v === maxV ? 1 : 0.001) : isCol(v.g) ? 0.05 : groupH(v.g));
        });
    } catch (e) { /* older engine */ }
}
// tear every member down and build the panes again from the layout (cheap: a handful of series)
function relayout(keepHeights) {
    if (!keepHeights) readPaneHeights();
    mounted.forEach(function (k) { var m = memberOf(k); if (m) { try { m.unmount(); } catch (e) { console.error(e); } } });
    mounted = []; visGroups = [];
    var live = {}, fresh = [];
    activeKeys().forEach(function (k) { live[k] = true; if (!placeOf(k)) fresh.push(k); });
    fresh.forEach(function (k) {                        // new members: their own pane, or the last pane when merging
        var host = null;
        if (S('chart').merge) paneLay.groups.forEach(function (g) { if (g.some(function (x) { return live[x]; })) host = g; });
        if (host) host.push(k); else paneLay.groups.push([k]);
    });
    function mountKey(k, pane, sid) { try { memberOf(k).mount(pane, sid); mounted.push(k); } catch (e) { console.error(e); } }
    paneLay.main.forEach(function (k) { if (live[k]) mountKey(k, 0, 'm_' + k); });
    var pane = 1;
    paneLay.groups.forEach(function (g) {
        var ks = g.filter(function (k) { return live[k]; }); if (!ks.length) return;
        ks.forEach(function (k, j) { mountKey(k, pane, j ? 'm_' + k : null); });
        visGroups.push({ g: g, pane: pane, keys: ks }); pane++;
    });
    applyPaneHeights();
    var ps = chart.panes();
    for (var i = 1; i < ps.length; i++) {
        try { chart.priceScale('right', i).applyOptions({ scaleMargins: PANE_MARGINS }); } catch (e) { /* older engine */ }
    }
    scaleBase = {};
    savePaneLay(); scheduleTags(); scheduleLegend(); redrawLayers();
}
function applySubs() {
    if (activeKeys().sort().join() !== mounted.slice().sort().join()) { relayout(); return; }
    Object.keys(subLive).forEach(function (key) { if (SUBS[key].style) SUBS[key].style(subLive[key]); });
}
function mergeAllPanes(on) {
    readPaneHeights();
    var keys = []; paneLay.groups.forEach(function (g) { keys = keys.concat(g); });
    paneLay.groups = on ? (keys.length ? [keys] : []) : keys.map(function (k) { return [k]; });
    paneLay.max = null;
    relayout(true);
}
function paneAct(k, act) {
    var pl = placeOf(k); if (!pl) return;
    readPaneHeights();
    var g = pl.main ? null : paneLay.groups[pl.gi], vi = -1;
    if (!g && act !== 'split' && act !== 'even') return;                 // on the main chart: only "own pane" applies
    visGroups.forEach(function (v, i) { if (v.g === g) vi = i; });
    function take() { var a = pl.main ? paneLay.main : g; a.splice(a.indexOf(k), 1); }
    if (act === 'up' || act === 'down') {               // the whole pane trades places with its neighbour
        var ni = vi + (act === 'up' ? -1 : 1); if (vi < 0 || ni < 0 || ni >= visGroups.length) return;
        var b = paneLay.groups.indexOf(visGroups[ni].g);
        paneLay.groups[pl.gi] = paneLay.groups[b]; paneLay.groups[b] = g;
    } else if (act === 'joinUp' || act === 'joinDown') {
        var nj = vi + (act === 'joinUp' ? -1 : 1);
        if (nj < 0 && act === 'joinUp' && vi === 0) { take(); paneLay.main.push(k); }   // above the first pane is the chart
        else if (vi < 0 || nj < 0 || nj >= visGroups.length) return;
        else { take(); visGroups[nj].g.push(k); }
    } else if (act === 'split') { take(); paneLay.groups.splice(pl.main ? 0 : pl.gi + 1, 0, [k]); }
    else if (act === 'main') { take(); paneLay.main.push(k); }
    else if (act === 'max') paneLay.max = isMax(g) ? null : g[0];
    else if (act === 'col') { var c = !isCol(g); g.forEach(function (x) { if (c) paneLay.col[x] = true; else delete paneLay.col[x]; }); }
    else if (act === 'even') { paneLay.h = {}; paneLay.col = {}; paneLay.mainH = 1; paneLay.max = null; }
    paneLay.groups = paneLay.groups.filter(function (x) { return x.length; });
    relayout(true);
}
function openPaneMenu(k) {
    var m = memberOf(k), pl = placeOf(k); if (!m || !pl) return;
    var g = pl.main ? null : paneLay.groups[pl.gi], vi = -1;
    visGroups.forEach(function (v, i) { if (v.g === g) vi = i; });
    var n = visGroups.length, items = [];
    if (pl.main) items.push(['split', '별도 창으로 분리', '차트 아래 새 창으로 옮깁니다']);
    else {
        if (vi > 0) items.push(['up', '창 위로 이동', '']);
        if (vi < n - 1) items.push(['down', '창 아래로 이동', '']);
        items.push(['joinUp', vi === 0 ? '메인 차트에 겹치기' : '위 창과 합치기', vi === 0 ? '캔들 위에 자체 축으로 겹쳐 그립니다' : '한 창에 겹쳐 봅니다']);
        if (vi < n - 1) items.push(['joinDown', '아래 창과 합치기', '한 창에 겹쳐 봅니다']);
        if (visGroups[vi] && visGroups[vi].keys.length > 1) items.push(['split', '새 창으로 분리', '이 지표만 따로 떼어 냅니다']);
        if (vi > 0) items.push(['main', '메인 차트에 겹치기', '캔들 위에 자체 축으로 겹쳐 그립니다']);
        items.push(['max', isMax(g) ? '최대화 해제' : '창 최대화', isMax(g) ? '' : '이 창만 크게 봅니다']);
        items.push(['col', isCol(g) ? '창 펼치기' : '창 접기', isCol(g) ? '' : '이름과 값만 남기고 줄입니다']);
    }
    items.push(['even', '창 높이 초기화', '창 사이 경계선을 끌면 높이를 바꿀 수 있어요']);
    var rows = items.map(function (it) {
        var b = document.createElement('button'); b.className = 'row-opt';
        b.innerHTML = '<span>' + it[1] + (it[2] ? '<small>' + it[2] + '</small>' : '') + '</span>';
        b.onclick = function () { closeSheet(); paneAct(k, it[0]); };
        return b;
    });
    var cfg = document.createElement('button'); cfg.className = 'row-opt'; cfg.innerHTML = '<span>지표 설정</span>';
    cfg.onclick = function () { closeSheet(); m.settings(); };
    var off = document.createElement('button'); off.className = 'row-opt'; off.innerHTML = '<span style="color:#F6465D">지표 끄기</span>';
    off.onclick = function () { closeSheet(); m.close(); };
    openSheet(escHtml(m.name()) + ' · 창', rows.concat([sectionTitle('지표'), cfg, off]));
}
function escHtml(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function removeSubSeries(o) { eachSeries(o, function (se) { try { chart.removeSeries(se); } catch (e) { /* ignore */ } }); }
function subsSetData() { Object.keys(subLive).forEach(function (key) { SUBS[key].setData(subLive[key]); }); }
function subsUpdate(i) { Object.keys(subLive).forEach(function (key) { if (SUBS[key].update) SUBS[key].update(subLive[key], i); }); }
function lineOpts(color, last, sid) { return Object.assign({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: !!last, crosshairMarkerVisible: false }, sidOpt(sid)); }
function signedVol(v) { return (v < 0 ? '-' : '+') + fmtVol(Math.abs(v)); }
// axis labels of the volume-like panes: 7.63B instead of 7,625,082,330.90 (the chart-wide formatter is for prices)
var COMPACT = { type: 'custom', minMove: 0.01, formatter: function (v) { return (v < 0 ? '-' : '') + fmtVol(Math.abs(v)); } };
function upFill() { return hexA(C.up, 0.55); }
function downFill() { return hexA(C.down, 0.55); }
// MACD histogram: TradingView's four shades - strong when the bar grows away from zero, light when it shrinks back
function histColor(v, prev) {
    if (!S('macd').hist4 || prev == null) return v >= 0 ? hexA(C.up, 0.6) : hexA(C.down, 0.6);
    return v >= 0 ? hexA(C.up, v >= prev ? 0.75 : 0.32) : hexA(C.down, v <= prev ? 0.75 : 0.32);
}
// fills the band between two values of a series' price scale (RSI 30-70 background), drawn under the lines
function bandPrimitive(series, getBand) {
    var prim = { _req: null, attached: function (p) { prim._req = p.requestUpdate; }, detached: function () { prim._req = null; }, updateAllViews: function () {},
        paneViews: function () { return [view]; } };
    var view = { zOrder: function () { return 'bottom'; }, renderer: function () { return renderer; } };
    var renderer = { draw: function (target) {
        var b = getBand(); if (!b) return;
        var y1 = series.priceToCoordinate(b.hi), y2 = series.priceToCoordinate(b.lo); if (y1 == null || y2 == null) return;
        target.useBitmapCoordinateSpace(function (sc) {
            sc.context.fillStyle = b.color;
            sc.context.fillRect(0, Math.round(Math.min(y1, y2) * sc.verticalPixelRatio), sc.bitmapSize.width, Math.round(Math.abs(y2 - y1) * sc.verticalPixelRatio));
        });
    } };
    series.attachPrimitive(prim);
    return prim;
}
SUBS.rsi = {
    create: function (pane, sid) {
        var o = { line: chart.addSeries(LW.LineSeries, lineOpts('#B388FF', true, sid), pane), pl: [] };
        o.ma = chart.addSeries(LW.LineSeries, lineOpts('#F7C548', false, sid), pane);
        o.band = bandPrimitive(o.line, function () { var c = S('rsi'); return c.levels && c.band ? { hi: c.ob, lo: c.os, color: hexA(c.color, 0.08) } : null; });
        return o;
    },
    style: function (o) {
        var c = S('rsi');
        o.line.applyOptions({ color: c.color, lineWidth: c.width });
        o.ma.applyOptions({ color: c.maColor, lineWidth: 1, visible: c.maOn });
        o.pl.forEach(function (l) { try { o.line.removePriceLine(l); } catch (e) { /* gone */ } }); o.pl = [];
        if (c.levels) [c.ob, c.os].forEach(function (v) { o.pl.push(o.line.createPriceLine({ price: v, color: 'rgba(132,142,156,.55)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })); });
        if (c.mid) o.pl.push(o.line.createPriceLine({ price: 50, color: 'rgba(132,142,156,.3)', lineWidth: 1, lineStyle: 1, axisLabelVisible: false }));
        if (o.band._req) o.band._req();
    },
    setData: function (o) { o.line.setData(pts(D.rsi)); o.ma.setData(S('rsi').maOn ? pts(D.rsiMa) : []); },
    update: function (o, i) { var r = ptAt(D.rsi, i); if (r) o.line.update(r); var m = S('rsi').maOn && ptAt(D.rsiMa, i); if (m) o.ma.update(m); },
    legend: function (i) {
        var c = S('rsi'); if (D.rsi[i] == null) return '';
        return '<span style="color:' + c.color + '">RSI ' + c.period + ' ' + D.rsi[i].toFixed(1) + '</span>' +
            (c.maOn && D.rsiMa[i] != null ? ' <span style="color:' + c.maColor + '">' + D.rsiMa[i].toFixed(1) + '</span>' : '');
    }
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
        if (m) { o.macd.update(m); var sg = ptAt(D.sig, i); if (sg) o.sig.update(sg); if (D.hist[i] != null) o.hist.update({ time: candles[i].time, value: D.hist[i], color: histColor(D.hist[i], D.hist[i - 1]) }); }
    },
    legend: function (i) {
        var c = S('macd');
        return D.macd[i] != null ? '<span style="color:' + c.cMacd + '">MACD ' + D.macd[i].toFixed(precision) + '</span>' + (D.sig[i] != null ? ' <span style="color:' + c.cSig + '">' + D.sig[i].toFixed(precision) + '</span>' : '') : '';
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
    var box = $('pane_tags'), ps = chart.panes(), html = '';
    if (!box) return;
    var base = chartEl.getBoundingClientRect().top;
    // name (replaced by the live values), and on tap: settings, pane menu, off
    function tagHtml(k) {
        var m = memberOf(k); if (!m) return '';
        return '<span class="ptag' + (openTag === k ? ' open' : '') + '" style="color:' + m.color() + '"><button class="pname" data-k="' + k + '" data-a="name">' + escHtml(m.name()) + '</button>' +
            '<button class="pbtn" data-k="' + k + '" data-a="cfg" aria-label="설정">⚙</button><button class="pbtn" data-k="' + k + '" data-a="menu" aria-label="창 메뉴">⋯</button>' +
            '<button class="pbtn" data-k="' + k + '" data-a="x" aria-label="끄기">✕</button></span>';
    }
    // a maximized pane hides the others: their tags and the chart legend go too
    var maxed = visGroups.some(function (v) { return isMax(v.g); });
    document.body.classList.toggle('pane-max', maxed);
    var onMain = paneLay.main.filter(function (k) { return mounted.indexOf(k) >= 0; });
    if (onMain.length && !maxed && ps[0] && ps[0].getHTMLElement) {
        var r0 = ps[0].getHTMLElement().getBoundingClientRect();
        html += '<div class="ptag-row" style="top:' + (r0.bottom - base - 24).toFixed(0) + 'px">' + onMain.map(tagHtml).join('') + '</div>';
    }
    visGroups.forEach(function (v) {
        var el = ps[v.pane] && ps[v.pane].getHTMLElement && ps[v.pane].getHTMLElement(), id = v.g[0];
        if (!el || (maxed && !isMax(v.g))) return;
        var top = el.getBoundingClientRect().top - base + 3;
        var state = isMax(v.g) ? ['max', '최대화 해제'] : isCol(v.g) ? ['col', '펼치기'] : null;
        html += '<div class="ptag-row" style="top:' + top.toFixed(0) + 'px">' + v.keys.map(tagHtml).join('') +
            (state ? '<span class="ptag"><button class="pname" data-k="' + v.keys[0] + '" data-a="' + state[0] + '">' + state[1] + '</button></span>' : '') + '</div>';
    });
    box.innerHTML = html;
    fillPaneValues(lastLegendI);
}
// each pane shows its indicators' values at the crosshair candle (or the newest), like TradingView's pane legends
var lastLegendI = -1;
function fillPaneValues(i) {
    lastLegendI = i;
    var box = $('pane_tags'); if (!box || !candles.length) return;
    if (i < 0 || i >= candles.length) i = candles.length - 1;
    Array.prototype.forEach.call(box.querySelectorAll('.pname[data-a="name"]'), function (b) {
        var m = memberOf(b.getAttribute('data-k')); if (!m) return;
        var h = ''; try { h = m.legend(i) || ''; } catch (e) { /* member gone */ }
        b.innerHTML = h || escHtml(m.name());
    });
}
var openTag = null, openTagT = 0;
$('pane_tags').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b) return;
    var k = b.getAttribute('data-k'), act = b.getAttribute('data-a'), m = memberOf(k);
    if (act === 'name') {
        openTag = openTag === k ? null : k; clearTimeout(openTagT);
        if (openTag) openTagT = setTimeout(function () { openTag = null; layoutPaneTags(); }, 5000);
        layoutPaneTags(); return;
    }
    openTag = null;
    if (!m) return;
    if (act === 'cfg') m.settings();
    else if (act === 'menu') openPaneMenu(k);
    else if (act === 'x') m.close();
    else if (act === 'max' || act === 'col') { paneAct(k, act); return; }
    layoutPaneTags();
});
if (window.ResizeObserver) new ResizeObserver(function () { scheduleTags(); }).observe($('chart'));

function applyIndicators() {
    var vis = function (s, on) { s.applyOptions({ visible: !!on }); };
    vis(volSeries, ind.vol); maS.forEach(function (s, k) { vis(s, ind.ma && P.ma[k].on); }); emaS.forEach(function (s, k) { vis(s, ind.ema && P.ema[k].on); });
    vis(bUpS, ind.boll); vis(bMidS, ind.boll && S('boll').midOn); vis(bLoS, ind.boll);
    var vwc = S('vwap'); vis(volMaS, ind.vol && S('vol').maOn);
    vis(vwS, ind.vwap); vis(vwU1, ind.vwap && vwc.b1); vis(vwL1, ind.vwap && vwc.b1); vis(vwU2, ind.vwap && vwc.b2); vis(vwL2, ind.vwap && vwc.b2);
    vis(stS, ind.st);
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
    volMaS.applyOptions({ color: S('vol').maColor });
    var vw = S('vwap'), st = S('st');
    vwS.applyOptions({ color: vw.color, lineWidth: vw.width });
    [vwU1, vwL1].forEach(function (x) { x.applyOptions({ lineWidth: 1 }); });
    [vwU2, vwL2].forEach(function (x) { x.applyOptions({ lineWidth: 1, lineStyle: 2 }); });
    stS.applyOptions({ lineWidth: st.width });
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
var lastMerge = null, candleOv = null;
function applyChartCfg() {
    computeColors();
    var c = S('chart');
    if (lastMerge !== null && !!c.merge !== lastMerge) mergeAllPanes(!!c.merge);
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
        wickUpColor: C.up, wickDownColor: C.down, priceLineVisible: c.lastLine, lastValueVisible: c.lastLine, wickVisible: true
    });
    if (candleOv) candleSeries.applyOptions(candleOv);
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
    syncPaneScales();
    syncScaleBtns();
};
// every pane's own axis and the indicators laid on it back to auto-fit
function autoFitAll() {
    var n = chart.panes().length;
    for (var p = 0; p < n; p++) {
        try { chart.priceScale('right', p).applyOptions({ autoScale: true }); } catch (e) { /* pane gone */ }
        memberScales(p).forEach(function (sc) { try { sc.setAutoScale(true); } catch (e) { /* gone */ } });
    }
    scaleBase = {};
    syncScaleBtns();
}
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
// Fibonacci retracement: 24 level slots like TradingView (value, color, on/off), level 1 at the first point and 0 at the
// second. Presets fill the slots; a user can save any drawing's style as the default for new ones.
var FIB_SLOTS = [
    [0, '#787B86'], [0.236, '#F23645'], [0.382, '#FF9800'], [0.5, '#4CAF50'], [0.618, '#089981'], [0.786, '#00BCD4'],
    [1, '#787B86'], [1.618, '#2962FF'], [2.618, '#F23645'], [3.618, '#9C27B0'], [4.236, '#E91E63'], [1.272, '#FF9800'],
    [1.414, '#F23645'], [2.272, '#FF9800'], [2.414, '#4CAF50'], [2, '#089981'], [3, '#00BCD4'], [3.272, '#787B86'],
    [3.414, '#2962FF'], [4, '#F23645'], [4.272, '#9C27B0'], [0.886, '#FF9800'], [0.705, '#089981'], [1.13, '#E91E63']
];
// [id, name, description, enabled values]; values no slot holds (0.62, -0.27 ...) take slots that are off
var FIB_PRESETS = [
    ['core', '핵심 되돌림', '0.236 ~ 0.786 + 목표 1.618', [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]],
    ['tv', '트레이딩뷰 기본', '0 ~ 1 + 확장 1.618 · 2.618 · 3.618 · 4.236', [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]],
    ['ote', 'OTE (ICT)', '진입 0.62 ~ 0.79 (중심 0.705), 목표 −0.27 · −0.62', [0, 0.5, 0.62, 0.705, 0.79, 1, -0.27, -0.62]],
    ['harmonic', '하모닉', '0.382 ~ 0.886, 1.13 · 1.272 · 1.618', [0.382, 0.5, 0.618, 0.786, 0.886, 1, 1.13, 1.272, 1.618]],
    ['ext', '확장 목표', '1 · 1.272 · 1.414 · 1.618 · 2 · 2.618', [0, 0.5, 1, 1.272, 1.414, 1.618, 2, 2.618]]
];
function fibBase() {
    return { levels: FIB_SLOTS.map(function (l) { return { v: l[0], c: l[1], on: false }; }), trend: true, tc: '#787B86', w: 1, ds: 0,
        ext: 'none', one: false, oc: '#2962FF', bg: true, bga: 8, lvl: 'val', price: true, lpos: 'left', rev: false, log: false };
}
function fibPreset(id, f) {
    var pr = FIB_PRESETS.filter(function (p) { return p[0] === id; })[0] || FIB_PRESETS[0];
    var want = pr[3], used = {};
    f.levels = fibBase().levels;                                   // a preset starts from the standard 24 slots
    f.levels.forEach(function (l) { l.on = want.indexOf(l.v) >= 0; if (l.on) used[l.v] = 1; });
    want.forEach(function (v) {
        if (used[v]) return;
        for (var i = f.levels.length - 1; i >= 0; i--) if (!f.levels[i].on) { f.levels[i] = { v: v, c: f.levels[i].c, on: true }; used[v] = 1; return; }
    });
    return f;
}
function fixFib(f) {                                             // stored settings -> complete, valid object
    var b = fibBase(); f = f && typeof f === 'object' ? f : {};
    var lv = Array.isArray(f.levels) ? f.levels : null;
    b.levels = b.levels.map(function (d, i) {
        var s = lv && lv[i] || null;
        return s ? { v: typeof s.v === 'number' && isFinite(s.v) ? clampN(s.v, -10, 10) : d.v, c: typeof s.c === 'string' && HEX.test(s.c) ? s.c : d.c, on: !!s.on } : d;
    });
    ['trend', 'one', 'bg', 'price', 'rev', 'log'].forEach(function (k) { if (typeof f[k] === 'boolean') b[k] = f[k]; });
    ['tc', 'oc'].forEach(function (k) { if (typeof f[k] === 'string' && HEX.test(f[k])) b[k] = f[k]; });
    if (typeof f.w === 'number') b.w = clampN(Math.round(f.w), 1, 4);
    if (f.ds === 0 || f.ds === 1 || f.ds === 2) b.ds = f.ds;
    if (typeof f.bga === 'number') b.bga = clampN(f.bga, 0, 40);
    if (['none', 'left', 'right', 'both'].indexOf(f.ext) >= 0) b.ext = f.ext;
    if (['val', 'pct', 'off'].indexOf(f.lvl) >= 0) b.lvl = f.lvl;
    if (f.lpos === 'left' || f.lpos === 'right') b.lpos = f.lpos;
    if (!lv) b = fibPreset('core', b);
    return b;
}
var DR_TPL = LS.get('drTpl', {}); if (!DR_TPL || typeof DR_TPL !== 'object') DR_TPL = {};
var STYLE_KEYS = ['col', 'w', 'ds', 'ext', 'lbl', 'lpos', 'stats', 'fill', 'fc', 'fa', 'fib'];
var fibDefCache = null;
// a drawing's fib settings (its own, or the default for new ones), validated once per object
function fibOf(d) {
    if (d.fib) { if (!d.fib.__ok) { d.fib = fixFib(d.fib); Object.defineProperty(d.fib, '__ok', { value: true }); } return d.fib; }
    return fibDefCache || (fibDefCache = fixFib(DR_TPL.fib && DR_TPL.fib.fib));
}
function applyTemplate(d) {
    var t = DR_TPL[d.type];
    if (t) STYLE_KEYS.forEach(function (k) { if (t[k] !== undefined) d[k] = JSON.parse(JSON.stringify(t[k])); });
    if (d.type === 'fib' && !d.fib) d.fib = JSON.parse(JSON.stringify(fibOf(d)));
}
// which group of intervals the chart is on, for the per-drawing "show on" switches (minutes / hours / days / weeks+months)
function ivGroup() { var u = interval.slice(-1); return u === 'm' ? 'm' : u === 'h' ? 'h' : u === 'd' ? 'd' : 'w'; }
function drawingVisible(d) { return !d.vis || d.vis[ivGroup()] !== false; }
function dashOf(ds) { return ds === 1 ? [7, 5] : ds === 2 ? [2, 4] : []; }
function fibPrice(f, d, lv) {
    var A = f.rev ? d.b.price : d.a.price, B = f.rev ? d.a.price : d.b.price;
    if (f.log && A > 0 && B > 0) return Math.exp(Math.log(B) - (Math.log(B) - Math.log(A)) * lv);
    return B - (B - A) * lv;
}
// the enabled levels with their y, top to bottom, and the x range the lines span
function fibRows(d, a, b, w) {
    var f = fibOf(d), x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    if (x2 - x1 < 60) x2 = x1 + 60;
    if (f.ext === 'left' || f.ext === 'both') x1 = 0;
    if (f.ext === 'right' || f.ext === 'both') x2 = w;
    var rows = [];
    f.levels.forEach(function (l) {
        if (!l.on) return;
        var price = fibPrice(f, d, l.v), y = yOf(price);
        if (y != null) rows.push({ v: l.v, c: f.one ? f.oc : l.c, price: price, y: y });
    });
    rows.sort(function (p, q) { return p.y - q.y; });
    return { f: f, x1: x1, x2: x2, rows: rows };
}
var DR = {
    list: [], sel: null, tool: null, draft: null, measure: null, nextId: 1, hidden: LS.get('drHidden', false),
    attachTo: function (s) { attachLayers(s); },
    redraw: function () { redrawLayers(); },
    load: function () {
        this.list = LS.get('dr.' + symbol, []).filter(function (d) { return d && d.a && isFinite(d.a.time) && isFinite(d.a.price); });
        this.nextId = this.list.reduce(function (m, d) { return Math.max(m, d.id || 0); }, 0) + 1;
        this.sel = null; this.draft = null; this.measure = null; this.redraw();
    },
    save: function () {
        LS.set('dr.' + symbol, this.list.slice(-100));
        var sym = symbol, list = this.list;
        drSaveHooks.forEach(function (fn) { try { fn(sym, list); } catch (e) { console.error(e); } });   // alerts follow their line
    }
};
var drSaveHooks = [], drAlertHook = null;

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
        paneViews: function () { return [view]; },
        priceAxisViews: function () { return z === 'top' ? axisViews() : []; }
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
var axisHooks = [];
function axisViews() {
    var out = [];
    axisHooks.forEach(function (fn) {
        var ls; try { ls = fn() || []; } catch (e) { ls = []; }
        ls.forEach(function (l) {
            out.push({
                coordinate: function () { var y = l.y != null ? l.y : layerSeries ? layerSeries.priceToCoordinate(l.price) : null; return y == null ? -999 : y; },
                text: function () { return l.text; }, textColor: function () { return l.fg || '#FFFFFF'; }, backColor: function () { return l.bg; },
                visible: function () { return true; }, tickVisible: function () { return false; }
            });
        });
    });
    return out;
}
function attachLayers(series) {
    if (layerSeries === series) return;
    if (layerSeries) layerPrims.forEach(function (p) { try { layerSeries.detachPrimitive(p); } catch (e) { /* already gone */ } });
    layerSeries = series; layerPrims = [makeLayerPrimitive('bottom'), makeLayerPrimitive('top')];
    layerPrims.forEach(function (p) { series.attachPrimitive(p); });
}
function redrawLayers() { layerPrims.forEach(function (p) { if (p._req) p._req(); }); }
// Feeds (order book, heatmap, bubbles) only need a few frames per second; each repaint redraws the whole pane, so
// their requests are merged into at most one repaint every DATA_REDRAW_MS, and none while the chart is hidden.
var DATA_REDRAW_MS = 250, dataRedrawT = 0, lastDataRedraw = 0;
function requestDataRedraw() {
    if (dataRedrawT || !active) return;
    var wait = Math.max(0, DATA_REDRAW_MS - (Date.now() - lastDataRedraw));
    dataRedrawT = setTimeout(function () { dataRedrawT = 0; lastDataRedraw = Date.now(); redrawLayers(); }, wait);
}
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
    var col = drawingColor(d), dash = dashOf(d.ds);
    ctx.lineWidth = (d.w || 1.6) + (selected ? 0.6 : 0); ctx.setLineDash(dash);
    if (d.type === 'hline') {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(w, a.y); ctx.stroke();
        if (d.lbl !== false) {
            ctx.setLineDash([]);
            if (d.lpos === 'left') label(ctx, fmtPrice(d.a.price), 4, a.y - 11, col, '#1a1a1a'); else label(ctx, fmtPrice(d.a.price), w - 4, a.y - 11, col, '#1a1a1a', 'right');
        }
        if (selected) handle(ctx, { x: Math.min(40, w / 3), y: a.y });
    } else if (d.type === 'vline') {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, h); ctx.stroke();
        if (d.lbl !== false) { ctx.setLineDash([]); label(ctx, crosshairTimeFmt(d.a.time), a.x + 4, h - 12, col, '#1a1a1a'); }
        if (selected) handle(ctx, { x: a.x, y: Math.max(20, h - 40) });
    } else if (d.type === 'trend' && b) {
        var tp = trendEnds(d, a, b, w, h);
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(tp[0].x, tp[0].y); ctx.lineTo(tp[1].x, tp[1].y); ctx.stroke();
        if (d.stats) {
            ctx.setLineDash([]);
            var st = moveText(d); ctx.font = '600 10.5px -apple-system, Roboto, sans-serif';
            var sw = ctx.measureText(st).width + 10, sy = b.y + (d.b.price >= d.a.price ? -14 : 14);
            label(ctx, st, Math.max(2, Math.min(w - sw - 2, b.x + 6)), Math.max(11, Math.min(h - 11, sy)), hexA(col, 0.9), '#0b0e11');
        }
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'ray' && b) {
        var e = rayEnd(a, b, w, h);
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'rect' && b) {
        var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), rw = Math.abs(a.x - b.x), rh = Math.abs(a.y - b.y);
        if (d.fill !== false) { ctx.fillStyle = hexA(d.fc || col, (d.fa != null ? d.fa : 14) / 100); ctx.fillRect(x, y, rw, rh); }
        ctx.strokeStyle = col; ctx.strokeRect(x, y, rw, rh);
        if (selected) { handle(ctx, a); handle(ctx, b); }
    } else if (d.type === 'fib' && b) {
        var fr = fibRows(d, a, b, w), f = fr.f, rows = fr.rows, i;
        if (f.bg && f.bga > 0) for (i = 1; i < rows.length; i++) {
            ctx.fillStyle = hexA(rows[i].c, f.bga / 100); ctx.fillRect(fr.x1, rows[i - 1].y, fr.x2 - fr.x1, rows[i].y - rows[i - 1].y);
        }
        ctx.lineWidth = f.w + (selected ? 0.4 : 0); ctx.setLineDash(dashOf(f.ds));
        rows.forEach(function (r) { ctx.strokeStyle = r.c; ctx.beginPath(); ctx.moveTo(fr.x1, r.y); ctx.lineTo(fr.x2, r.y); ctx.stroke(); });
        ctx.setLineDash([]);
        if (f.lvl !== 'off' || f.price) rows.forEach(function (r) {
            var lt = f.lvl === 'val' ? fmtLevel(r.v) : f.lvl === 'pct' ? fmtLevel(r.v * 100) + '%' : '';
            var t = lt + (f.price ? (lt ? '(' + fmtPrice(r.price) + ')' : fmtPrice(r.price)) : '');
            var fg = r.c.toUpperCase() === '#787B86' ? '#B2B5BE' : r.c;
            // labels stay on screen when the drawing starts left of it / ends right of it
            if (f.lpos === 'right') label(ctx, t, Math.min(fr.x2, w) - 2, r.y - 10, 'rgba(19,23,34,.85)', fg, 'right'); else label(ctx, t, Math.max(fr.x1, 0) + 2, r.y - 10, 'rgba(19,23,34,.85)', fg);
        });
        if (f.trend) {
            ctx.strokeStyle = hexA(f.tc, 0.85); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        }
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
// ---- volume profile -----------------------------------------------------------------------------------------
var vpCache = { key: '', rows: null }, vpTradeHook = null;
function vpTradeVer() { var t = vpTradeHook(candles.length - 1); return t ? t.ver : 0; }
function vpCompute() {
    var c = S('vp'), n = candles.length; if (!n) return null;
    var a = 0, z = n - 1;
    if (c.range === 'visible') {
        var r = chart.timeScale().getVisibleLogicalRange(); if (!r) return null;
        a = Math.max(0, Math.floor(r.from)); z = Math.min(n - 1, Math.ceil(r.to));
        if (z - a < 2) return null;
    }
    var last = candles[n - 1], tv = vpTradeHook ? vpTradeHook(n - 1) : null;
    var key = a + '|' + z + '|' + c.rows + '|' + n + '|' + last.volume + '|' + last.high + '|' + last.low + '|' + (vpTradeHook && c.trades ? vpTradeVer() : 0);
    if (vpCache.key === key) return vpCache.res;
    var lo = Infinity, hi = -Infinity, i, j;
    for (i = a; i <= z; i++) { if (candles[i].low < lo) lo = candles[i].low; if (candles[i].high > hi) hi = candles[i].high; }
    if (!(hi > lo)) return null;
    var rows = c.rows, step = (hi - lo) / rows, buy = new Float64Array(rows), sell = new Float64Array(rows);
    for (i = a; i <= z; i++) {
        var k = candles[i], span = k.high - k.low, b0 = Math.min(rows - 1, Math.floor((k.low - lo) / step)), b1 = Math.min(rows - 1, Math.floor((k.high - lo) / step));
        var bv = k.buy, sv = Math.max(0, k.volume - k.buy);
        var tr = vpTradeHook && c.trades ? vpTradeHook(i) : null;
        if (tr) {                                                        // every trade of this candle is known: use its real price
            tr.rows.forEach(function (q, tk) { var jj = clampN(Math.floor((tk * tr.tick - lo) / step), 0, rows - 1); buy[jj] += q[0]; sell[jj] += q[1]; });
            continue;
        }
        if (!(span > 0) || b0 === b1) { buy[b0] += bv; sell[b0] += sv; continue; }
        for (j = b0; j <= b1; j++) {                                     // share of the candle's range inside this row
            var top = Math.min(k.high, lo + (j + 1) * step), bot = Math.max(k.low, lo + j * step), f = Math.max(0, top - bot) / span;
            buy[j] += bv * f; sell[j] += sv * f;
        }
    }
    var tot = 0, poc = 0, max = 0;
    for (j = 0; j < rows; j++) { var v = buy[j] + sell[j]; tot += v; if (v > max) { max = v; poc = j; } }
    // value area: grow from the POC towards the heavier neighbour until 70 % of the volume is inside
    var vaLo = poc, vaHi = poc, acc = buy[poc] + sell[poc];
    while (acc < tot * 0.7 && (vaLo > 0 || vaHi < rows - 1)) {
        var up = vaHi < rows - 1 ? buy[vaHi + 1] + sell[vaHi + 1] : -1, dn = vaLo > 0 ? buy[vaLo - 1] + sell[vaLo - 1] : -1;
        if (up >= dn) { vaHi++; acc += up; } else { vaLo--; acc += dn; }
    }
    var res = { lo: lo, step: step, rows: rows, buy: buy, sell: sell, max: max, poc: poc, vaLo: vaLo, vaHi: vaHi };
    vpCache = { key: key, res: res };
    return res;
}
addLayer('bottom', function (ctx, w, h) {
    if (!ind.vp) return;
    var c = S('vp'), vp = vpCompute(); if (!vp || !vp.max) return;
    var maxW = w * c.width / 100, right = c.side === 'right', base = c.opacity / 100;
    for (var j = 0; j < vp.rows; j++) {
        var v = vp.buy[j] + vp.sell[j]; if (!v) continue;
        var yTop = yOf(vp.lo + (j + 1) * vp.step), yBot = yOf(vp.lo + j * vp.step);
        if (yTop == null || yBot == null || yBot < 0 || yTop > h) continue;
        var hh = Math.max(1, yBot - yTop - 1), len = v / vp.max * maxW, inVa = !c.va || (j >= vp.vaLo && j <= vp.vaHi);
        var al = base * (inVa ? 1 : 0.45);
        if (c.split) {
            var lb = vp.buy[j] / v * len;
            ctx.fillStyle = hexA(C.up, al); ctx.fillRect(right ? w - len : 0, yTop, lb, hh);
            ctx.fillStyle = hexA(C.down, al); ctx.fillRect(right ? w - len + lb : lb, yTop, len - lb, hh);
        } else {
            ctx.fillStyle = 'rgba(178,181,190,' + al.toFixed(3) + ')'; ctx.fillRect(right ? w - len : 0, yTop, len, hh);
        }
    }
    if (c.poc) {
        var py = yOf(vp.lo + (vp.poc + 0.5) * vp.step);
        if (py != null && py >= 0 && py <= h) {
            ctx.strokeStyle = 'rgba(240,185,11,.85)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); ctx.setLineDash([]);
            ctx.font = '600 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(19,23,34,.9)'; ctx.textAlign = right ? 'right' : 'left';
            var tx = right ? w - maxW - 6 : maxW + 6;
            ctx.strokeText('POC', tx, py - 8); ctx.fillStyle = '#F0B90B'; ctx.fillText('POC', tx, py - 8); ctx.textAlign = 'start';
        }
    }
});
// a ray starts at a, goes through b and runs on to the edge of the pane
function rayEnd(a, b, w, h) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return b;
    var k = 4 * (w + h) / Math.max(1e-6, Math.hypot(dx, dy));
    return { x: a.x + dx * k, y: a.y + dy * k };
}
function drawingColor(d) { return d.col || (d.type === 'hline' ? C.gold : C.accent); }
function fmtLevel(v) { return String(Math.round(v * 1000) / 1000); }
// a trend line extended to the pane edge on the chosen side(s)
function trendEnds(d, a, b, w, h) {
    var p = a, q = b;
    if (d.ext === 'right' || d.ext === 'both') q = rayEnd(a, b, w, h);
    if (d.ext === 'left' || d.ext === 'both') p = rayEnd(b, a, w, h);
    return [p, q];
}
// "+1,234.5 (+1.52%) · 23봉" for the trend line's stats label
function moveText(d) {
    var diff = d.b.price - d.a.price, pct = d.a.price ? diff / d.a.price * 100 : 0;
    var bars = Math.round(logicalOfTime(d.b.time) - logicalOfTime(d.a.time));
    return (diff >= 0 ? '+' : '') + fmtPrice(diff) + ' (' + (diff >= 0 ? '+' : '') + pct.toFixed(2) + '%) · ' + Math.abs(bars) + '봉';
}
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
    if (!DR.hidden) DR.list.forEach(function (d) { if (drawingVisible(d)) paint(ctx, d, d.id === DR.sel, w, h); });
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
    if (d.type === 'vline') return Math.abs(p.x - a.x);
    if (!b) return Infinity;
    if (d.type === 'trend') { var ps1 = chart.paneSize(0), te = trendEnds(d, a, b, ps1.width, ps1.height); return segDist(p, te[0], te[1]); }
    if (d.type === 'ray') { var ps0 = chart.paneSize(0); return segDist(p, a, rayEnd(a, b, ps0.width, ps0.height)); }
    if (d.type === 'rect') {
        var x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        return Math.min(segDist(p, { x: x1, y: y1 }, { x: x2, y: y1 }), segDist(p, { x: x2, y: y1 }, { x: x2, y: y2 }),
                        segDist(p, { x: x2, y: y2 }, { x: x1, y: y2 }), segDist(p, { x: x1, y: y2 }, { x: x1, y: y1 }));
    }
    if (d.type === 'fib') {
        var fr = fibRows(d, a, b, chart.paneSize(0).width), best = segDist(p, a, b);
        fr.rows.forEach(function (r) { best = Math.min(best, segDist(p, { x: fr.x1, y: r.y }, { x: fr.x2, y: r.y })); });
        return best;
    }
    return Infinity;
}
function handlesOf(d) {
    var a = px(d.a), b = d.b ? px(d.b) : null, ps = chart.paneSize(0);
    if (d.type === 'hline') return a ? [{ k: 'a', x: Math.min(40, ps.width / 3), y: a.y }] : [];
    if (d.type === 'vline') return a ? [{ k: 'a', x: a.x, y: Math.max(20, ps.height - 40) }] : [];
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
    DR.list.forEach(function (d) { if (!drawingVisible(d)) return; var dd = distTo(d, p); if (dd < bd) { bd = dd; best = d; } });
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
    var hints = { trend: '시작점을 누르세요', ray: '시작점을 누르세요', vline: '시간 위치를 누르세요', hline: '가격 위치를 누르세요', fib: '시작점을 누르세요', rect: '한쪽 모서리를 누르세요', measure: '시작점을 누르세요' };
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
        else if (DR.tool === 'hline' || DR.tool === 'vline') { DR.draft = { id: 0, type: DR.tool, a: a }; gesture = { mode: 'create', startP: p, moved: true }; }
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
        if (DR.draft.type === 'hline' || DR.draft.type === 'vline') DR.draft.a = a; else if (gesture.moved) DR.draft.b = a;
    } else if (gesture.mode === 'handle' && gesture.moved) {
        var ah = anchorAt(p, true); if (!ah) return;
        if (gesture.d.type === 'hline') gesture.d.a.price = ah.price;
        else if (gesture.d.type === 'vline') gesture.d.a.time = ah.time;
        else gesture.d[gesture.which] = ah;
    } else if (gesture.mode === 'move' && gesture.moved) {
        var dx = p.x - gesture.startP.x, dy = p.y - gesture.startP.y, d = gesture.d;
        var na = anchorAt({ x: gesture.orig.a.x + dx, y: gesture.orig.a.y + dy }, false);
        if (d.type === 'hline') { if (na) d.a.price = na.price; }
        else if (d.type === 'vline') { if (na) d.a.time = na.time; }
        else if (na && gesture.orig.b) {
            var nb = anchorAt({ x: gesture.orig.b.x + dx, y: gesture.orig.b.y + dy }, false);
            if (nb) { d.a = na; d.b = nb; }
        }
    }
    DR.redraw();
}
var lastTap = { id: null, t: 0 };
function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    e.stopPropagation(); e.preventDefault();
    var g = gesture; gesture = null; swallowUntil = Date.now() + 350;
    if (g.mode === 'create') {
        var dr = DR.draft;
        if (dr.type !== 'hline' && dr.type !== 'vline' && !g.moved) { dr.awaiting = true; showHint('끝점을 누르세요'); DR.redraw(); return; }       // tap-tap flow
        DR.draft = null;
        if (dr.type === 'measure') { DR.measure = dr; setTool(null); return; }
        dr.id = DR.nextId++; delete dr.awaiting; applyTemplate(dr);
        DR.list.push(dr); DR.sel = dr.id; DR.save(); setTool(null);
    } else if (g.moved) { DR.save(); }
    else if (g.d) {                                                   // double tap on a drawing opens its settings, like TradingView
        var now = Date.now();
        if (lastTap.id === g.d.id && now - lastTap.t < 420) { lastTap.id = null; DR.redraw(); openDrawingSettings(g.d); return; }
        lastTap.id = g.d.id; lastTap.t = now;
    }
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
    wrap.addEventListener(t, function () { setTimeout(syncScaleBtns, 40); setTimeout(scheduleTags, 60); setTimeout(syncPaneScales, 50); paneHeightsSoon(); }, { capture: true, passive: true });
});
wrap.addEventListener('pointerdown', function () { snapPaneScales(); }, true);
wrap.addEventListener('pointerdown', onDown, true);
wrap.addEventListener('pointermove', onMove, true);
wrap.addEventListener('pointerup', onUp, true);
wrap.addEventListener('pointercancel', function () { if (gesture) cancelGesture(); }, true);
['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach(function (t) {
    wrap.addEventListener(t, swallow, { capture: true, passive: false });
});

// Pinch zoom. The engine changes the candle width by only half of the change in finger distance per event (pinching
// the fingers to half their distance zooms out ~22%), so going from days to months took a dozen pinches. Here, as in
// TradingView, the candle width follows the fingers exactly (half the distance = twice as many candles) and the candle
// under the fingers stays under them, so two fingers also pan. The empty space right of the newest candle never grows
// past what it was (zooming out around the middle would otherwise push the newest candle to the middle of the screen
// and leave the right half empty), so at the live edge the zoom keeps the newest candle in place. These listeners run after the engine's own on the same
// event (it is a descendant of #chart and never stops propagation), so its result is simply replaced.
var pinch = null;
function touchMidX(t) { return (t[0].clientX + t[1].clientX) / 2 - chartEl.getBoundingClientRect().left; }
function touchDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
chartEl.addEventListener('touchstart', function (e) {
    pinch = null;
    if (e.touches.length !== 2 || !candles.length) return;
    var ts = chart.timeScale(), r = ts.getVisibleLogicalRange(), w = ts.width(), x = touchMidX(e.touches), d = touchDist(e.touches);
    if (!r || !w || r.to <= r.from || d < 20 || x > w) return;          // fingers on the price axis: the engine scales the price
    var bs = w / (r.to - r.from);
    // the anchor is kept as a distance from the candle that was newest at the start: older history arriving (or the
    // series being trimmed) mid-gesture shifts every index, a candle opening after it shifts none
    pinch = { d: d, bs: bs, fromEnd: candles.length - (r.from + x / bs), last: candles[candles.length - 1].time,
        blank: Math.max(0, (r.to - (candles.length - 1)) * bs) };      // px of empty space right of the newest candle
}, { passive: true });
chartEl.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length !== 2) return;
    var ts = chart.timeScale(), w = ts.width(), x = touchMidX(e.touches);
    var bs = clampN(pinch.bs * touchDist(e.touches) / pinch.d, MIN_BAR_SPACING, MAX_BAR_SPACING);
    var end = candles.length; while (end > 1 && candles[end - 1].time > pinch.last) end--;
    var from = end - pinch.fromEnd - x / bs, to = from + w / bs;
    var over = to - (candles.length - 1 + pinch.blank / bs);
    if (over > 0) { from -= over; to -= over; }
    ts.setVisibleLogicalRange({ from: from, to: to });
}, { passive: true });
chartEl.addEventListener('touchend', function (e) { if (e.touches.length !== 2) pinch = null; }, { passive: true });
chartEl.addEventListener('touchcancel', function () { pinch = null; }, { passive: true });
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
    ray: '<svg viewBox="0 0 24 24"><path d="M5 19L21 3" stroke-dasharray="0"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="12" r="2"/></svg>',
    vline: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><circle cx="12" cy="8" r="2"/></svg>',
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
var TOOLS = [['cursor', '선택'], ['trend', '추세선'], ['ray', '연장선'], ['hline', '수평선'], ['vline', '수직선'], ['fib', '피보나치'], ['rect', '사각형'], ['measure', '측정']];
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
    if (d.type !== 'fib') html += '<button class="tag" data-a="w">' + Math.round(d.w || 1.6) + 'px</button>' +
        '<button class="tag" data-a="s">' + (d.ds === 1 ? '- - -' : d.ds === 2 ? '· · ·' : '───') + '</button><span class="vsep"></span>';
    if (drAlertHook && (d.type === 'hline' || d.type === 'trend' || d.type === 'ray')) html += '<button class="tag" data-a="alert" aria-label="알람">🔔 알람</button><span class="vsep"></span>';
    html += '<button class="tag" data-a="cfg" aria-label="설정">⚙ 설정</button>' +
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
    else if (b.getAttribute('data-a') === 'cfg') { openDrawingSettings(d); return; }
    else if (b.getAttribute('data-a') === 'alert') { if (drAlertHook) drAlertHook(d); return; }
    DR.save(); DR.redraw(); refreshDrBar();
});

// ---- drawing settings sheet: 모습 (style) / 좌표 (points) / 보임 (intervals), like TradingView ---------------------
// Edits apply live on the chart behind the sheet; 취소 restores the drawing as it was, 확인 / closing keeps the edits.
var DR_NAMES = { trend: '추세선', ray: '연장선', hline: '수평선', vline: '수직선', fib: '피보나치 되돌림', rect: '사각형' };
var drEdit = null;               // { d, snap, tab, colorFor, tpl }
function openDrawingSettings(d, tab) {
    if (!d) return;
    if (!drEdit || drEdit.d !== d) {
        if (d.type === 'fib') { if (!d.fib) d.fib = JSON.parse(JSON.stringify(fibOf(d))); fibOf(d); }
        drEdit = { d: d, snap: JSON.stringify(d), tab: 'style', colorFor: null, tpl: false };
    }
    if (tab) drEdit.tab = tab;
    var sheet = $('sheet'), keep = sheet.scrollTop; sheet.innerHTML = '';
    var h = document.createElement('h3');
    h.innerHTML = '<span>' + (DR_NAMES[d.type] || '그림') + '</span><button class="x" aria-label="닫기">✕</button>';
    h.querySelector('.x').onclick = closeSheet;
    sheet.appendChild(h);
    var tabs = document.createElement('div'); tabs.className = 'dtabs';
    [['style', '모습'], ['coords', '좌표'], ['vis', '보임']].forEach(function (t) {
        var b = document.createElement('button'); b.textContent = t[1]; b.className = drEdit.tab === t[0] ? 'on' : '';
        b.onclick = function () { drEdit.tab = t[0]; drEdit.colorFor = null; drEdit.tpl = false; sheet.scrollTop = 0; openDrawingSettings(d); };
        tabs.appendChild(b);
    });
    sheet.appendChild(tabs);
    var body = drEdit.tab === 'coords' ? drCoords(d) : drEdit.tab === 'vis' ? drVis(d) : d.type === 'fib' ? fibStyle(d) : drStyle(d);
    body.forEach(function (el) { if (el) sheet.appendChild(el); });
    sheet.appendChild(drFooter(d));
    sheetOnClose = function () { DR.save(); drEdit = null; refreshDrBar(); DR.redraw(); };
    $('sheet_bg').classList.add('show', 'live');
    sheet.scrollTop = keep;
    backState();
}
function drChanged() { DR.redraw(); }
function rerenderDr() { openDrawingSettings(drEdit.d); }
function fldRow(label, right) {
    var el = document.createElement('div'); el.className = 'fld';
    el.innerHTML = '<div class="top"><span>' + label + '</span></div>';
    if (right) el.querySelector('.top').appendChild(right);
    return el;
}
function swRow(label, on, set) {
    var el = fldRow(label), sw = document.createElement('span'); sw.className = 'switch' + (on ? ' on' : '');
    el.querySelector('.top').appendChild(sw);
    el.onclick = function () { set(!on); drChanged(); rerenderDr(); };
    return el;
}
function segRow(label, opts, cur, set) {
    var el = document.createElement('div'); el.className = 'fld';
    el.innerHTML = '<div class="top"><span>' + label + '</span></div><div class="seg"></div>';
    opts.forEach(function (o) {
        var b = document.createElement('button'); b.className = o[0] === cur ? 'on' : ''; b.textContent = o[1];
        b.onclick = function () { set(o[0]); drChanged(); rerenderDr(); };
        el.querySelector('.seg').appendChild(b);
    });
    return el;
}
function colorRow(label, id, cur, set) {
    var dot = document.createElement('span'); dot.className = 'chip-dot'; dot.style.background = cur;
    var el = fldRow(label, dot);
    el.querySelector('.top').onclick = function () { drEdit.colorFor = drEdit.colorFor === id ? null : id; rerenderDr(); };
    if (drEdit.colorFor === id) el.appendChild(colorStrip(cur, function (c) { dot.style.background = c; set(c); drChanged(); }));
    return el;
}
function rangeRow(label, min, max, step, unit, cur, set) {
    var el = document.createElement('div'); el.className = 'fld';
    el.innerHTML = '<div class="top"><span>' + label + '</span><span class="val">' + cur + unit + '</span></div>' +
        '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + cur + '">';
    var rg = el.querySelector('input'), vl = el.querySelector('.val');
    rg.oninput = function () { var n = parseFloat(rg.value); vl.textContent = n + unit; set(n); drChanged(); };
    return el;
}
var WIDTHS = [[1, '1px'], [2, '2px'], [3, '3px'], [4, '4px']], DASHES = [[0, '실선 ───'], [1, '파선 - - -'], [2, '점선 · · ·']];
function drStyle(d) {
    var out = [], col = drawingColor(d), t = d.type;
    out.push(colorRow(t === 'rect' ? '테두리 색' : '선 색', 'line', col, function (c) { d.col = c; }));
    out.push(segRow('두께', WIDTHS, Math.max(1, Math.round(d.w || 1.6)), function (v) { d.w = v; }));
    out.push(segRow('선 모양', DASHES, d.ds || 0, function (v) { d.ds = v; }));
    if (t === 'trend') {
        out.push(segRow('연장', [['none', '안 함'], ['left', '왼쪽'], ['right', '오른쪽'], ['both', '양쪽']], d.ext || 'none', function (v) { d.ext = v; }));
        out.push(swRow('통계 표시 (가격 차 · % · 봉 수)', !!d.stats, function (v) { d.stats = v; }));
    }
    if (t === 'hline') {
        out.push(swRow('가격 라벨', d.lbl !== false, function (v) { d.lbl = v; }));
        if (d.lbl !== false) out.push(segRow('라벨 위치', [['right', '오른쪽'], ['left', '왼쪽']], d.lpos || 'right', function (v) { d.lpos = v; }));
    }
    if (t === 'vline') out.push(swRow('시간 라벨', d.lbl !== false, function (v) { d.lbl = v; }));
    if (t === 'rect') {
        out.push(swRow('배경 채우기', d.fill !== false, function (v) { d.fill = v; }));
        if (d.fill !== false) {
            out.push(colorRow('배경 색', 'fill', d.fc || col, function (c) { d.fc = c; }));
            out.push(rangeRow('배경 진하기', 0, 60, 1, '%', d.fa != null ? d.fa : 14, function (v) { d.fa = v; }));
        }
    }
    return out;
}
function fibStyle(d) {
    var f = d.fib, out = [];
    out.push(sectionTitle('레벨'));
    var grid = document.createElement('div'); grid.className = 'fibgrid';
    f.levels.forEach(function (l, i) {
        var cell = document.createElement('div'); cell.className = 'fibcell' + (l.on ? '' : ' off');
        cell.innerHTML = '<button class="cbx' + (l.on ? ' on' : '') + '" aria-label="표시"></button>' +
            '<input type="number" inputmode="decimal" step="any" value="' + fmtLevel(l.v) + '">' +
            '<button class="chip-dot" style="background:' + l.c + '" aria-label="색상"></button>';
        cell.querySelector('.cbx').onclick = function () { l.on = !l.on; drChanged(); rerenderDr(); };
        var inp = cell.querySelector('input');
        inp.onchange = function () { var n = parseFloat(inp.value); if (!isFinite(n)) n = l.v; n = clampN(Math.round(n * 1000) / 1000, -10, 10); inp.value = fmtLevel(n); l.v = n; drChanged(); };
        cell.querySelector('.chip-dot').onclick = function () { drEdit.colorFor = drEdit.colorFor === 'lv' + i ? null : 'lv' + i; rerenderDr(); };
        grid.appendChild(cell);
    });
    out.push(grid);
    var ci = drEdit.colorFor && drEdit.colorFor.indexOf('lv') === 0 ? +drEdit.colorFor.slice(2) : -1;
    if (ci >= 0) {
        var pick = document.createElement('div'); pick.className = 'fld';
        pick.innerHTML = '<div class="top"><span>레벨 ' + fmtLevel(f.levels[ci].v) + ' 색</span></div>';
        pick.appendChild(colorStrip(f.levels[ci].c, function (c) { f.levels[ci].c = c; drChanged(); rerenderDr(); }));
        out.push(pick);
    }
    out.push(swRow('한 가지 색만 쓰기', f.one, function (v) { f.one = v; }));
    if (f.one) out.push(colorRow('색', 'one', f.oc, function (c) { f.oc = c; }));
    out.push(sectionTitle('선'));
    out.push(segRow('레벨 선 두께', WIDTHS, f.w, function (v) { f.w = v; }));
    out.push(segRow('레벨 선 모양', DASHES, f.ds, function (v) { f.ds = v; }));
    out.push(segRow('연장', [['none', '안 함'], ['left', '왼쪽'], ['right', '오른쪽'], ['both', '양쪽']], f.ext, function (v) { f.ext = v; }));
    out.push(swRow('추세선 (두 점 연결)', f.trend, function (v) { f.trend = v; }));
    if (f.trend) out.push(colorRow('추세선 색', 'trend', f.tc, function (c) { f.tc = c; }));
    out.push(swRow('배경 채우기', f.bg, function (v) { f.bg = v; }));
    if (f.bg) out.push(rangeRow('배경 진하기', 1, 40, 1, '%', f.bga, function (v) { f.bga = v; }));
    out.push(sectionTitle('라벨'));
    out.push(segRow('레벨 표시', [['val', '값 0.618'], ['pct', '퍼센트 61.8%'], ['off', '숨김']], f.lvl, function (v) { f.lvl = v; }));
    out.push(swRow('가격 표시', f.price, function (v) { f.price = v; }));
    out.push(segRow('라벨 위치', [['left', '왼쪽'], ['right', '오른쪽']], f.lpos, function (v) { f.lpos = v; }));
    out.push(sectionTitle('계산'));
    out.push(swRow('뒤집기 (0과 1 바꾸기)', f.rev, function (v) { f.rev = v; }));
    out.push(swRow('로그 스케일 기준', f.log, function (v) { f.log = v; }));
    out.push(noteRow('1은 첫 번째 점, 0은 두 번째 점입니다. 1보다 크거나 0보다 작은 값은 두 점 바깥의 확장 레벨입니다.'));
    return out;
}
// one anchor: price field + time with one-bar steps
function anchorRows(d, key, label, withPrice, withTime) {
    var el = document.createElement('div'); el.className = 'fld';
    var pt = d[key], step = Math.pow(10, -precision);
    el.innerHTML = '<div class="top"><span>' + label + '</span></div>' +
        (withPrice ? '<div class="top"><span class="lbl2">가격</span><input class="pin" type="number" inputmode="decimal" step="' + step + '" value="' + pt.price.toFixed(precision) + '"></div>' : '') +
        (withTime ? '<div class="top"><span class="lbl2">시간</span><span class="tstep"><button class="tag" data-dt="-1">◀</button><span class="tval">' + crosshairTimeFmt(pt.time) + '</span><button class="tag" data-dt="1">▶</button></span></div>' : '');
    var pin = el.querySelector('.pin');
    if (pin) pin.onchange = function () { var n = parseFloat(pin.value); if (isFinite(n) && n > 0) { pt.price = n; drChanged(); } pin.value = pt.price.toFixed(precision); };
    [].forEach.call(el.querySelectorAll('[data-dt]'), function (b) {
        b.onclick = function () {
            var l = Math.round(logicalOfTime(pt.time)) + (+b.getAttribute('data-dt'));
            pt.time = timeOfLogical(l);
            el.querySelector('.tval').textContent = crosshairTimeFmt(pt.time); drChanged();
        };
    });
    return el;
}
function drCoords(d) {
    if (d.type === 'hline') return [anchorRows(d, 'a', '가격', true, false)];
    if (d.type === 'vline') return [anchorRows(d, 'a', '시간', false, true)];
    return [anchorRows(d, 'a', d.type === 'fib' ? '1번 점 (레벨 1)' : '1번 점', true, true), anchorRows(d, 'b', d.type === 'fib' ? '2번 점 (레벨 0)' : '2번 점', true, true)];
}
function drVis(d) {
    var v = d.vis || {}, out = [];
    [['m', '분 (1분 ~ 30분)'], ['h', '시간 (1시간 ~ 12시간)'], ['d', '일 (1일 · 3일)'], ['w', '주 · 월']].forEach(function (g) {
        out.push(swRow(g[1], v[g[0]] !== false, function (on) {
            var nv = Object.assign({}, d.vis || {}); nv[g[0]] = on;
            d.vis = (nv.m !== false && nv.h !== false && nv.d !== false && nv.w !== false) ? undefined : nv;
        }));
    });
    out.push(noteRow('끈 시간대의 차트에서는 이 그림이 보이지 않습니다. 그림은 코인별로 저장됩니다.'));
    return out;
}
function drFooter(d) {
    var ft = document.createElement('div'); ft.className = 'dfoot';
    if (drEdit.tpl) {
        var menu = document.createElement('div'); menu.className = 'tplmenu';
        var items = [];
        if (d.type === 'fib') FIB_PRESETS.forEach(function (pr) { items.push([pr[1], pr[2], function () { fibPreset(pr[0], d.fib); }]); });
        items.push(['기본값으로 저장', '새로 그리는 ' + (DR_NAMES[d.type] || '그림') + '에 이 모습을 씁니다', function () {
            var t = {}; STYLE_KEYS.forEach(function (k) { if (d[k] !== undefined) t[k] = JSON.parse(JSON.stringify(d[k])); });
            DR_TPL[d.type] = t; LS.set('drTpl', DR_TPL); fibDefCache = null; toast('기본값으로 저장했어요');
        }]);
        items.push(['처음 설정으로', '앱 기본 모습으로 되돌립니다', function () {
            STYLE_KEYS.forEach(function (k) { delete d[k]; });
            if (d.type === 'fib') d.fib = fixFib(null);
        }]);
        items.forEach(function (it) {
            var b = document.createElement('button'); b.innerHTML = it[0] + '<small>' + it[1] + '</small>';
            b.onclick = function () { it[2](); drEdit.tpl = false; drChanged(); rerenderDr(); };
            menu.appendChild(b);
        });
        ft.appendChild(menu);
    }
    var row = document.createElement('div'); row.className = 'drow';
    row.innerHTML = '<button class="tplb">템플릿 ▾</button><span style="flex:1"></span><button class="cancel">취소</button><button class="ok">확인</button>';
    row.querySelector('.tplb').onclick = function () { drEdit.tpl = !drEdit.tpl; rerenderDr(); };
    row.querySelector('.cancel').onclick = function () {
        var orig = JSON.parse(drEdit.snap), i = DR.list.indexOf(drEdit.d);
        if (i >= 0) { DR.list[i] = orig; DR.sel = orig.id; }
        drEdit = null; closeSheet();
    };
    row.querySelector('.ok').onclick = closeSheet;
    ft.appendChild(row);
    return ft;
}
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
var sheetOnClose = null;
function closeSheet() {
    $('sheet_bg').classList.remove('show', 'live'); settingsKey = null;
    var cb = sheetOnClose; sheetOnClose = null; if (cb) cb();
    backState();
}
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
    function copy() { return S(key)[f.k].map(function (l) { return Object.assign({}, l); }); }
    function draw() {
        box.innerHTML = '';
        var lines = S(key)[f.k];
        lines.forEach(function (l, i) {
            var row = document.createElement('div'); row.className = 'fld';
            row.innerHTML = '<div class="ln"><button class="chip-dot" style="background:' + l.c + '" aria-label="색상"></button>' +
                '<input type="number" inputmode="numeric" min="1" max="2000" value="' + l.p + '">' +
                (f.types ? '<button class="tag t">' + (l.t === 'ema' ? 'EMA' : 'SMA') + '</button>' : '') +
                '<button class="tag w">' + l.w + 'px</button>' +
                '<span class="switch' + (l.on ? ' on' : '') + '" style="margin-left:auto"></span>' +
                (lines.length > 1 ? '<button class="tag del" aria-label="선 삭제">✕</button>' : '') + '</div>';
            var dot = row.querySelector('.chip-dot'), inp = row.querySelector('input'), del = row.querySelector('.del');
            if (del) del.onclick = function () { var arr = copy(); arr.splice(i, 1); openAt = -1; setCfg(key, f.k, arr); draw(); };
            dot.onclick = function () { openAt = openAt === i ? -1 : i; draw(); };
            inp.onchange = function () { var n = Math.max(1, Math.min(2000, Math.floor(+inp.value) || l.p)); inp.value = n; save(i, { p: n }); };
            var tb = row.querySelector('.t'); if (tb) tb.onclick = function () { save(i, { t: l.t === 'ema' ? 'sma' : 'ema' }); draw(); };
            row.querySelector('.w').onclick = function () { save(i, { w: l.w >= 4 ? 1 : l.w + 1 }); draw(); };
            row.querySelector('.switch').onclick = function () { save(i, { on: !l.on }); draw(); };
            box.appendChild(row);
            if (openAt === i) { var fl = document.createElement('div'); fl.className = 'fld'; fl.style.paddingTop = '0'; fl.appendChild(colorStrip(l.c, function (c) { dot.style.background = c; save(i, { c: c }); })); box.appendChild(fl); }
        });
        if (lines.length < MAX_LINES) {
            var add = document.createElement('button'); add.className = 'reset'; add.textContent = '＋ 선 추가';
            add.onclick = function () {
                var arr = copy(), used = arr.map(function (l) { return l.p; }), cols = arr.map(function (l) { return l.c.toUpperCase(); });
                var p = [5, 10, 20, 30, 50, 60, 100, 120, 200, 400].filter(function (x) { return used.indexOf(x) < 0; })[0] || Math.min(2000, Math.max.apply(null, used) * 2);
                var c = PALETTE.filter(function (x) { return cols.indexOf(x.toUpperCase()) < 0; })[0] || PALETTE[arr.length % PALETTE.length];
                arr.push({ on: true, p: p, c: c, w: 1, t: f.def[0].t });
                setCfg(key, f.k, arr); draw();
            };
            box.appendChild(add);
        }
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
// Named templates per settings sheet ("RSI 단타", "MA 장기" ...): saved, applied or deleted in one tap.
var CFG_TPL = LS.get('cfgTpl', {}); if (!CFG_TPL || typeof CFG_TPL !== 'object') CFG_TPL = {};
var tplOpenKey = null;
function templateBox(key, rerender) {
    var box = document.createElement('div'); box.className = 'tplbox';
    var list = Array.isArray(CFG_TPL[key]) ? CFG_TPL[key] : [];
    var bar = document.createElement('div'); bar.className = 'drow';
    bar.innerHTML = '<button class="tplb">템플릿' + (list.length ? ' ' + list.length : '') + ' ' + (tplOpenKey === key ? '▴' : '▾') + '</button><span style="flex:1"></span><button class="tplreset">기본값으로 되돌리기</button>';
    bar.querySelector('.tplb').onclick = function () { tplOpenKey = tplOpenKey === key ? null : key; rerender(); };
    bar.querySelector('.tplreset').onclick = function () { resetCfg(key); rerender(); toast('기본값으로 되돌렸어요'); };
    box.appendChild(bar);
    if (tplOpenKey !== key) return box;
    var menu = document.createElement('div'); menu.className = 'tplmenu';
    list.forEach(function (t, i) {
        var r = document.createElement('div'); r.className = 'tplrow';
        r.innerHTML = '<button class="ap"></button><button class="rm" aria-label="삭제">✕</button>';
        r.querySelector('.ap').textContent = t.n;
        r.querySelector('.ap').onclick = function () {
            CFGS[key] = JSON.parse(JSON.stringify(t.v || {})); delete cfgCache[key]; saveCfg();
            var d = SCHEMA[key]; if (d.onChange) d.onChange(S(key), null);
            rerender(); toast('"' + t.n + '" 적용');
        };
        r.querySelector('.rm').onclick = function () { list.splice(i, 1); CFG_TPL[key] = list; LS.set('cfgTpl', CFG_TPL); rerender(); };
        menu.appendChild(r);
    });
    var add = document.createElement('div'); add.className = 'tplrow';
    add.innerHTML = '<input type="text" maxlength="24" placeholder="새 템플릿 이름"><button class="sv">현재 설정 저장</button>';
    var inp = add.querySelector('input');
    inp.onclick = function (e) { e.stopPropagation(); };
    add.querySelector('.sv').onclick = function () {
        var name = inp.value.trim() || ('템플릿 ' + (list.length + 1));
        var v = JSON.parse(JSON.stringify(CFGS[key] || {})), at = -1;
        list.forEach(function (t, i) { if (t.n === name) at = i; });
        if (at >= 0) list[at].v = v; else list.push({ n: name, v: v });
        if (list.length > 20) list.shift();
        CFG_TPL[key] = list; LS.set('cfgTpl', CFG_TPL); rerender(); toast('"' + name + '" 저장');
    };
    menu.appendChild(add);
    if (!list.length) menu.appendChild(noteRow('지금 설정을 이름 붙여 저장해 두고, 나중에 한 번에 불러올 수 있어요. 설정 자체는 바꿀 때마다 자동 저장됩니다.'));
    box.appendChild(menu);
    return box;
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
    sheet.appendChild(templateBox(key, rerender));
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
        switchRow('VWAP', '거래량 가중 평균가 · ' + ({ day: '매일', week: '매주', month: '매월' })[S('vwap').anchor] + ' 초기화', 'vwap', true),
        switchRow('슈퍼트렌드', 'ATR ' + S('st').period + ', ' + S('st').factor, 'st', true),
        switchRow('볼륨 프로파일 (매물대)', '가격대별 거래량 · POC · 가치 영역', 'vp', true),
        switchRow('RSI', r.period + ' · 별도 창', 'rsi', true),
        switchRow('MACD', m.fast + ', ' + m.slow + ', ' + m.signal + ' · 별도 창', 'macd', true),
        sectionTitle('오더플로우'),
        switchRow('CVD · 델타', '누적 체결 델타 (매수-매도 체결량)', 'cvd', true),
        switchRow('미결제약정 (OI)', 'Binance 선물 · 별도 창', 'oi', true),
        switchRow('실시간 청산', '청산 주문 버블 + 봉별 청산량', 'liq', true),
        switchRow('대량 체결', '큰 체결만 버블로 표시', 'trades', true),
        switchRow('풋프린트', '확대하면 가격별 매수·매도 체결량 · 불균형 · POC', 'fp', true),
        switchRow('호가 · 체결 패널 (DOM)', '차트 오른쪽에 호가 사다리와 실시간 체결 목록', 'dom', true),
        switchRow('다른 거래소 체결 합산', 'Bybit · OKX · Hyperliquid · Bitfinex 체결을 풋프린트 · 체결 목록에 더함', 'xex', true),
        sectionTitle('호가창 · 청산맵'),
        switchRow('호가 벽', '매수/매도 벽 · 우측 깊이 막대', 'depth', true),
        switchRow('호가 히트맵', '유동성 변화를 시간별 색으로', 'heat', true),
        switchRow('추정 청산맵', 'OI·레버리지 기반 추정(모델)', 'liqmap', true),
        switchRow('Bid / Ask 라인', '최우선 매수·매도 호가 · 스프레드 (무료 공개 데이터)', 'bidask', true),
    ].concat(indicatorRowHooks.reduce(function (acc, h) { try { return acc.concat(h() || []); } catch (e) { console.error(e); return acc; } }, [])).concat([
        sectionTitle('표시'),
        mergeRow(),
        noteRow('⚙ 를 누르면 지표별 색상·두께·기간 등 세부 설정을 바꿀 수 있습니다. 실시간 항목은 켜 둔 동안에만 데이터를 받고, 차트를 벗어나면 자동으로 멈춥니다.')
    ]));
}
var indicatorRowHooks = [], legendHooks = [];
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
var legendOpen = LS.get('legendOpen', false), legendHtml = '';
function setLegend(html) { if (html !== legendHtml) { legendHtml = html; $('legend').innerHTML = html; } }
function renderLegend() {
    var n = candles.length; if (!n) { setLegend(''); return; }
    var i = crossTime != null ? indexOfTime(crossTime) : -1; if (i < 0) i = n - 1;
    var mode = S('chart').legend;
    if (mode === 'off') { setLegend(''); fillPaneValues(i); return; }
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
        if (ind.vwap && D.vw[i] != null) parts.push('<span style="color:' + S('vwap').color + '">VWAP ' + fmtPrice(D.vw[i]) + '</span>');
        if (ind.st && D.stDir[i] != null) parts.push('<span style="color:' + (D.stDir[i] === 1 ? S('st').up : S('st').down) + '">ST ' + fmtPrice(D.stDir[i] === 1 ? D.stUp[i] : D.stDn[i]) + (D.stDir[i] === 1 ? ' ▲' : ' ▼') + '</span>');
        if (ind.vol && P.volMa && D.volMa[i] != null) parts.push('<span style="color:' + S('vol').maColor + '">Vol MA ' + fmtVol(D.volMa[i]) + '</span>');
        if (ind.boll && D.bMid[i] != null) {
            var bc = S('boll');
            parts.push('<span style="color:' + bc.cMid + '">BOLL ' + fmtPrice(D.bMid[i]) + '</span> <span style="color:' + bc.cBand + '">' + fmtPrice(D.bUp[i]) + ' / ' + fmtPrice(D.bLo[i]) + '</span>');
        }
        if (ind.vp && vpCache.res) {
            var vr = vpCache.res;
            parts.push('<span style="color:#F0B90B">POC ' + fmtPrice(vr.lo + (vr.poc + 0.5) * vr.step) + '</span> <span style="color:#B2B5BE">VA ' +
                fmtPrice(vr.lo + vr.vaLo * vr.step) + ' – ' + fmtPrice(vr.lo + (vr.vaHi + 1) * vr.step) + '</span>');
        }
        Object.keys(features).forEach(function (key) {
            var f = features[key]; if (!f.running || !f.legend) return;
            var h = f.legend(i, c); if (h) parts.push(h);
        });
        legendHooks.forEach(function (fn) { try { var h = fn(i); if (h) parts.push(h); } catch (e) { console.error(e); } });
    }
    var l2 = parts.length ? '<div class="row">' + parts.join(' &nbsp;') + '</div>' : '';
    setLegend(l1 + l2);
    fillPaneValues(i);
}
$('legend').addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#lg_t')) return;
    legendOpen = !legendOpen; LS.set('legendOpen', legendOpen); renderLegend();
});
chart.subscribeCrosshairMove(function (param) { crossTime = param && param.time ? param.time : null; scheduleLegend(); });

// Time left in the forming candle. It used to sit under the last-price label on the price axis, where it covered the
// axis prices; like exchange apps it is now shown next to the price at the top: by the app's header (told the close
// time over the bridge) or, in full screen, in this page's own top bar.
function fmtLeft(s) {
    if (s < 0) s = 0;
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d) return d + '일 ' + pad2(h) + ':' + pad2(m);
    return (h ? h + ':' + pad2(m) : pad2(m)) + ':' + pad2(sec);
}
var closeReported = '';
function reportClose() {
    var v = candles.length ? interval + '|' + nextOpen(candles[candles.length - 1].time) * 1000 : '';
    if (v === closeReported) return;
    closeReported = v; bridge('candleClose', v);
}
function updateCountdown() {
    if (!immersive) return;
    var el = $('top_cd'); if (!el) return;
    var txt = candles.length ? fmtLeft(nextOpen(candles[candles.length - 1].time) - Math.floor(Date.now() / 1000)) : '';
    if (el.textContent !== txt) el.textContent = txt;
}
var cdTimer = null;
var connLostAt = 0;
function checkConn() {
    var pill = $('conn'); if (!pill) return;
    // Only the live socket decides. navigator.onLine is a hint for the wording: an Android WebView can report
    // "offline" long after the network is back (it misses the change while the app is in the background), which kept
    // the banner up although prices were streaming.
    var down = active && started && candles.length > 0 && !streams.market.open;
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
    saveZoom();
    if (needOlder(r)) loadOlder();
});
function needOlder(r) { return r.from < Math.max(25, (r.to - r.from) * 0.25); }     // zoomed far out: fetch earlier

// The candle width is one setting for every symbol and interval, like TradingView: zoom out on 15m, switch to 1h and
// the chart stays as zoomed out (and it is still that way the next time the app opens).
var zoomSaveT = 0;
function savedBarSpacing() {
    var v = LS.get('barSpacing', null);
    return typeof v === 'number' && isFinite(v) ? clampN(v, MIN_BAR_SPACING, MAX_BAR_SPACING) : null;
}
function saveZoom() {
    clearTimeout(zoomSaveT);
    zoomSaveT = setTimeout(function () {
        var ts = chart.timeScale(), r = ts.getVisibleLogicalRange(), w = ts.width();
        // hidden: the engine draws (and applies view changes) only on frames, so the range could be stale
        if (document.hidden || !r || !w || !candles.length || r.to <= r.from || $('loading').className !== 'hide') return;
        LS.set('barSpacing', Math.round(w / (r.to - r.from) * 1000) / 1000);
    }, 500);
}
$('to_latest').onclick = function () { chart.timeScale().scrollToRealTime(); };

// =====================================================================================================
// Data: REST history + live WebSocket
// =====================================================================================================
function parseRows(raw) {
    var out = [], dec = 0;
    for (var i = 0; i < raw.length; i++) {
        var k = raw[i];
        out.push({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], buy: +k[9] });
        // decimals actually used, sampled from the closes and OHLC: Binance pads prices to the contract's precision
        // ("83043.60" for a 0.1 tick), and keeping the padding widened the price axis and every price label
        if (i < 100) for (var f = 1; f <= 4; f++) { var s = String(k[f]).replace(/0+$/, ''), dot = s.indexOf('.'); if (dot >= 0) dec = Math.max(dec, s.length - dot - 1); }
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
    showLoading(true); crossTime = null; pinch = null;
    if (closeReported) { closeReported = ''; bridge('candleClose', ''); }     // the header hides it until the data is in
    fetch(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=' + PAGE)
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
            // the axis may still show the previous coin's range (82,000-85,000 for a coin at 0.004): fit every pane again
            var rs = chart.priceScale('right'), vr = rs.getVisibleRange(), lastC = candles[n - 1].close;
            if (symbolChanged !== false || !rs.options().autoScale && vr && (lastC < vr.from || lastC > vr.to)) autoFitAll();
            // the user's zoom; the first time ~64 candles across, like exchange apps
            ts.applyOptions({ barSpacing: savedBarSpacing() || Math.max(3.5, Math.min(10, ts.width() / 64)) });
            showLoading(false);
            ts.scrollToRealTime();
            scheduleLegend(); DR.redraw();
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

// Older history for the empty space on the left. Zoomed far out that can be thousands of candles, so the pages it
// takes (consecutive time windows of PAGE candles, up to 4) are requested together and merged in one rebuild, and when
// the view still is not filled the next batch follows at once instead of waiting for the next touch.
function loadOlder() {
    if (loadingOlder || noMoreOlder || !candles.length || candles.length >= MAX_BARS) return;
    var r = chart.timeScale().getVisibleLogicalRange(); if (!r) return;
    var want = Math.max(1, Math.max(25, (r.to - r.from) * 0.25) - r.from + PAGE / 2);
    var pages = interval === '1M' ? 1 : Math.max(1, Math.min(4, Math.ceil(want / PAGE), Math.ceil((MAX_BARS - candles.length) / PAGE)));
    var seq = loadSeq, end = candles[0].time * 1000 - 1, span = PAGE * curSec() * 1000, reqs = [];
    for (var i = 0; i < pages; i++) {
        var q = '&endTime=' + (end - i * span) + (pages > 1 ? '&startTime=' + (end - (i + 1) * span + 1) : '');
        reqs.push(fetch(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=' + PAGE + q)
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }));
    }
    loadingOlder = true;
    var more = false;
    Promise.all(reqs)
        .then(function (pagesRaw) {
            if (seq !== loadSeq || !candles.length) return;
            var rows = [], first = candles[0].time;
            for (var p = pagesRaw.length - 1; p >= 0; p--) {                           // oldest window first
                var raw = pagesRaw[p];
                if (Array.isArray(raw) && raw.length) rows = rows.concat(parseRows(raw).rows);
                else if (p === pagesRaw.length - 1) noMoreOlder = true;              // nothing that far back: listing date reached
            }
            rows = rows.filter(function (c, k) { return c.time < first && (k === 0 || c.time > rows[k - 1].time); });
            if (!rows.length) { noMoreOlder = true; return; }
            var added = rows.length, range = chart.timeScale().getVisibleLogicalRange();
            candles = rows.concat(candles);
            D = newD();
            computeAllInd(); if (chartType === 'ha') toHA();
            setAllData();
            if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });   // keep the view where it was
            DR.redraw();
            more = true;
        })
        .catch(function () { /* try again on the next scroll */ })
        .then(function () {
            loadingOlder = false;
            var now = more && chart.timeScale().getVisibleLogicalRange();
            if (now && needOlder(now)) loadOlder();
        });
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
        var hs = m && m.stream && self.subs[m.stream];
        if (hs) for (var i = 0; i < hs.length; i++) { try { hs[i](m.data); } catch (err2) { console.error(err2); } }
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
// several features can listen to one stream (big trades and the trade engine both read aggTrade): a handler is removed
// with unsub(name, handler); unsub(name) drops every listener
Stream.prototype.sub = function (name, handler) {
    var list = this.subs[name], had = !!list;
    if (!list) list = this.subs[name] = [];
    if (list.indexOf(handler) < 0) list.push(handler);
    if (this.open) { if (!had) this.send('SUBSCRIBE', [name]); } else this.connect();
};
Stream.prototype.unsub = function (name, handler) {
    var list = this.subs[name]; if (!list) return;
    if (handler) { var i = list.indexOf(handler); if (i >= 0) list.splice(i, 1); if (list.length) return; }
    delete this.subs[name];
    if (this.open) this.send('UNSUBSCRIBE', [name]);
    if (!this.names().length) this.shutdown(true);
};
Stream.prototype.shutdown = function (reset) {
    this.gen++; clearTimeout(this.timer); this.open = false; if (reset) this.opened = false;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } this.ws = null; }
};
var streams = { market: new Stream('market/stream'), pub: new Stream('public/stream') };
// back online: reconnect at once instead of waiting out the retry back-off, then fill in what was missed
window.addEventListener('online', function () {
    if (!active) return;
    [streams.market, streams.pub].forEach(function (st) {
        if (!st.ws && st.names().length) { clearTimeout(st.timer); st.delay = 1000; st.connect(); }
    });
    if (candles.length) resync();
});
streams.market.hooks.push(function () { resync(); });

var klineName = null;
function unsubKline() {
    clearTimeout(klineTimer); klineTimer = 0; klinePending = null;
    if (klineName) { streams.market.unsub(klineName); klineName = null; }
}
function subscribeKline() {
    unsubKline();
    klineName = symbol.toLowerCase() + '@kline_' + interval;
    var sym = symbol, intv = interval;
    streams.market.sub(klineName, function (d) { var k = d && d.k; if (k && k.s === sym && k.i === intv) onKline(k); });
}

// fill the gap after a pause/reconnect with the most recent candles
// (after a pause/reconnect): fetch every candle missed since the last one we have, so there is never a hole in the
// series. Away longer than a full page of history: start over from the latest candles.
function resync() {
    if (!candles.length) return;
    var seq = loadSeq, missed = Math.ceil((Date.now() / 1000 - candles[candles.length - 1].time) / curSec());
    if (missed > 990) { reload(false); return; }
    var limit = Math.max(60, missed + 5);
    return fetch(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=' + limit)
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (raw) {
            if (seq !== loadSeq || !Array.isArray(raw) || !raw.length || !candles.length) return;
            var rows = parseRows(raw).rows, firstNew = rows[0].time, cut = candles.length;
            if (firstNew > candles[candles.length - 1].time + curSec() * 1.5 && interval !== '1M') { reload(false); return; }   // still a gap: start over
            while (cut > 0 && candles[cut - 1].time >= firstNew) cut--;
            candles = candles.slice(0, cut).concat(rows);
            if (candles.length > MAX_BARS + 600) candles = candles.slice(candles.length - MAX_BARS);
            D = newD();
            computeAllInd(); if (chartType === 'ha') toHA();
            setAllData(); scheduleLegend(); DR.redraw();
        })
        .catch(function () { /* the websocket will keep us going */ });
}
var KLINE_MIN_MS = 400, klinePending = null, klineTimer = 0, klineLast = 0;
function onKline(k) {
    var n = candles.length; if (!n) return;
    var t = Math.floor(k.t / 1000), last = candles[n - 1];
    if (t < last.time) return;
    if (t > last.time && klinePending) flushKline();                 // finish the previous candle before opening the next
    var now = Date.now();
    if (t === last.time && !k.x && now - klineLast < KLINE_MIN_MS) {
        klinePending = k;
        if (!klineTimer) klineTimer = setTimeout(flushKline, KLINE_MIN_MS - (now - klineLast));
        return;
    }
    applyKline(k);
}
function flushKline() {
    clearTimeout(klineTimer); klineTimer = 0;
    var k = klinePending; klinePending = null;
    if (k) applyKline(k);
}
function applyKline(k) {
    klineLast = Date.now();
    var t = Math.floor(k.t / 1000), n = candles.length, last = candles[n - 1];
    var bar = { time: t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, buy: +k.V };
    if (t === last.time) candles[n - 1] = bar;
    else if (t > last.time) candles.push(bar);
    else return;
    if (candles.length > MAX_BARS + 500) {
        // the page now lives for the whole app session: keep the series bounded (rare full rebuild)
        candles = candles.slice(candles.length - MAX_BARS);
        D = newD(); computeAllInd(); if (chartType === 'ha') toHA();
        setAllData(); DR.redraw();
    } else pushLast();
    showPrice(bar.close, bar.close === last.close ? 0 : (bar.close > last.close ? 1 : -1));
    if (t > last.time) { reportClose(); updateCountdown(); }
    if (crossTime == null) scheduleLegend();
}

// =====================================================================================================
// Native API
// =====================================================================================================
window.loadSymbol = function (sym, defaultInterval, force) {
    var next = String(sym || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!next) return;
    if (force && SEC[force] && force !== interval) {                    // opened from an alert: show its interval
        interval = force; LS.set('interval', force); markInterval();
        if (started && next === symbol && candles.length) { reload(false); return; }
    }
    if (defaultInterval && !started && !LS.get('interval', null)) { interval = normInterval(defaultInterval); markInterval(); }
    if (started && next === symbol && candles.length) return;
    started = true;
    symbol = next; $('sym_name').textContent = next; syncDayTicker();
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
    syncDayTicker();
};
// 24h change next to the price in the full-screen / landscape bar (otherwise the app's header shows it). The 24h
// ticker stream (one message a second) is only subscribed while that bar is on screen.
var dayName = null;
function syncDayTicker() {
    var want = immersive && active && started ? symbol.toLowerCase() + '@miniTicker' : null;
    if (want === dayName) return;
    if (dayName) streams.market.unsub(dayName);
    dayName = want; setDayChange(null);
    if (!want) return;
    var sym = symbol;
    streams.market.sub(want, function (d) { if (d && d.s === sym && +d.o > 0) setDayChange((+d.c - +d.o) / +d.o * 100); });
}
function setDayChange(pct) {
    var el = $('top_chg'); if (!el) return;
    var ok = pct != null && isFinite(pct), txt = ok ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '';
    if (el.textContent !== txt) el.textContent = txt;
    if (ok) el.style.color = pct >= 0 ? C.up : C.down;
}
window.setImmersive = function (on) {
    immersive = !!on;
    $('app').classList.toggle('immersive', immersive);
    updateCountdown(); syncDayTicker();
    scheduleLegend();
};
document.addEventListener('visibilitychange', function () { window.setActive(!document.hidden); });

// =====================================================================================================
// Public hooks for the order-flow feature scripts (flow.js)
// =====================================================================================================
window.CF = {
    LW: LW, chart: chart, C: C, ind: ind, streams: streams, D: function () { return D; },
    candles: function () { return candles; }, symbol: function () { return symbol; }, interval: function () { return interval; },
    secs: curSec, nextOpen: nextOpen, precision: function () { return precision; }, active: function () { return active; },
    fmtPrice: fmtPrice, fmtVol: fmtVol, pad2: pad2, LS: LS, mainSeries: mainSeries,
    xOf: xOf, yOf: yOf, priceAt: function (y) { return mainSeries().coordinateToPrice(y); }, logicalOfTime: logicalOfTime,
    layer: addLayer, redraw: requestDataRedraw, redrawNow: redrawLayers, toast: toast, label: label,
    registerSub: function (key, def) { SUBS[key] = def; },
    registerFeature: function (key, def) { features[key] = def; def.running = false; },
    subSeries: function (key) { return subLive[key]; },
    compactFormat: COMPACT,
    refreshSub: function (key) { if (subLive[key]) SUBS[key].setData(subLive[key]); scheduleLegend(); },
    scheduleLegend: scheduleLegend, hexA: hexA,
    defineSettings: defineSettings, S: S, setCfg: setCfg, scheduleRefresh: scheduleRefresh,
    styleSubs: function () { Object.keys(subLive).forEach(function (key) { if (SUBS[key].style) SUBS[key].style(subLive[key]); }); scheduleLegend(); },
    // for pine.js
    onData: function (fn) { dataHooks.push(fn); }, indicatorRows: function (fn) { indicatorRowHooks.push(fn); },
    legend: function (fn) { legendHooks.push(fn); }, openSheet: openSheet, closeSheet: closeSheet, sectionTitle: sectionTitle,
    noteRow: noteRow, colorStrip: colorStrip, openIndicators: function () { openIndicators(); }, bridge: bridge,
    backState: function () { backState(); }, indexOfTime: function (t) { return indexOfTime(t); },
    barTint: setBarTint, openSettings: function (k) { openSettings(k); },
    onDrawingsSaved: function (fn) { drSaveHooks.push(fn); }, onDrawingAlert: function (fn) { drAlertHook = fn; },
    drawings: function () { return DR.list; }, changeInterval: function (i) { changeInterval(i); }, intervals: function () { return INTERVALS; },
    chartType: function () { return chartType; }, barSpacing: barSpacingPx,
    candleOverride: function (o) { candleOv = o; candleSeries.applyOptions(o || { borderVisible: !!S('chart').hollow, borderUpColor: C.up, borderDownColor: C.down }); },
    vpTrades: function (fn) { vpTradeHook = fn; vpCache.key = ''; },
    // a pane member from an add-on (Pine script drawn in its own pane); null removes it, forget drops its place
    paneMember: function (key, m) { if (m) pineMembers[key] = m; else if (pineMembers[key]) delete pineMembers[key]; else return; relayout(); },
    paneForget: function (key) { forgetPaneKey(key); },
    axisLabels: function (fn) { axisHooks.push(fn); return function () { var i = axisHooks.indexOf(fn); if (i >= 0) axisHooks.splice(i, 1); redrawLayers(); }; }
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
window.__cf = { chart: chart, DR: DR, get candles() { return candles; }, get interval() { return interval; }, setTool: setTool, ind: ind, get D() { return D; }, features: features, subs: SUBS, get live() { return subLive; }, S: S, P: P, paneAct: paneAct, get paneLay() { return paneLay; }, openPaneMenu: openPaneMenu, openSettings: openSettings };
})();
