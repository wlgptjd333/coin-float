// Order flow built from individual trades: a trade engine (every Binance USDⓈ-M aggTrade, live and back-filled, binned
// per minute and price tick, kept on the phone in IndexedDB) and the footprint chart drawn from it. Binance aggTrade
// ids are consecutive, so the engine knows exactly which trades it has: a reconnect gap or the hours before the app
// was opened are fetched again and nothing is counted twice.
(function () {
'use strict';
var CF = window.CF, FL = window.__flow;
if (!CF || !FL) return;
var chart = CF.chart, streams = CF.streams, LS = CF.LS;
var FAPI = 'https://fapi.binance.com';
function UP() { return CF.C.up; }
function DOWN() { return CF.C.down; }
var CLEAR = 'rgba(0,0,0,0)';
var NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];

// =====================================================================================================
// Trade engine
// =====================================================================================================
var REQ_GAP_MS = 1200;           // history requests: one per 1.2 s = 1,000 of the 2,400 weight Binance allows per minute
var KEEP_DB_H = 48;              // minutes kept on the phone
var SAVE_MS = 20000;
var E = {
    users: 0, sym: null, tick: 0, gen: 0,
    min: new Map(),              // minute start (s) -> { ver, src: { bn: { b: Map(tickIdx -> qty), s: Map, bq, sq } } }
    ver: 0,
    cov: [],                     // Binance aggTrade id ranges we hold completely: { a0, a1, t0, t1 (ms) }
    liveFirst: 0, liveLast: 0, liveT: 0,
    dirty: new Set(), saveT: 0, handler: null,
    bf: { q: [], busy: false, timer: 0, done: 0, total: 0, pauseUntil: 0 },
    listeners: []                // fn(trade) for live consumers (tape, signals)
};
function minuteOf(T) { return Math.floor(T / 60000) * 60; }
function addTrade(src, T, price, qty, buy) {
    var mt = minuteOf(T), m = E.min.get(mt);
    if (!m) { m = { ver: 0, src: {} }; E.min.set(mt, m); }
    var s = m.src[src] || (m.src[src] = { b: new Map(), s: new Map(), bq: 0, sq: 0 });
    var k = Math.round(price / E.tick), map = buy ? s.b : s.s;
    map.set(k, (map.get(k) || 0) + qty);
    if (buy) s.bq += qty; else s.sq += qty;
    m.ver++; E.ver++;
    E.dirty.add(mt);
}
// id ranges: merge a new complete range into the sorted list
function addCov(a0, a1, t0, t1) {
    var list = E.cov.concat([{ a0: a0, a1: a1, t0: t0, t1: t1 }]).sort(function (x, y) { return x.a0 - y.a0; }), out = [];
    list.forEach(function (r) {
        var p = out[out.length - 1];
        if (p && r.a0 <= p.a1 + 1) { if (r.a1 > p.a1) { p.a1 = r.a1; p.t1 = Math.max(p.t1, r.t1); } p.t0 = Math.min(p.t0, r.t0); }
        else out.push({ a0: r.a0, a1: r.a1, t0: r.t0, t1: r.t1 });
    });
    E.cov = out;
    E.liveR = null;
    if (E.liveLast) out.forEach(function (r) { if (r.a0 <= E.liveLast && r.a1 >= E.liveLast) E.liveR = r; });
}
// share of [t0, t1) (ms) that the held ranges cover; the live range runs up to now
function coverOf(t0, t1) {
    var now = Date.now(), end = Math.min(t1, now), got = 0;
    if (end <= t0) return 1;
    E.cov.forEach(function (r) {
        var r1 = r.a1 === E.liveLast && E.liveLast ? now : r.t1;
        var a = Math.max(t0, r.t0), b = Math.min(end, r1);
        if (b > a) got += b - a;
    });
    return Math.min(1, got / (end - t0));
}

// ---- live ------------------------------------------------------------------------------------------------------------
function onAgg(d) {
    if (!d || d.s !== E.sym) return;
    var id = d.a, T = d.T, price = +d.p, qty = +d.q, buy = !d.m;      // m = buyer is the maker → a sell
    if (E.liveLast && id <= E.liveLast) return;
    if (!E.liveFirst) { E.liveFirst = id; startHistory(id); }
    else if (id !== E.liveLast + 1) {                                   // a gap (reconnect, dropped frames): fetch it again
        queueIds(E.liveLast + 1, id - 1);
    }
    addTrade('bn', T, price, qty, buy);
    if (E.liveR && E.liveR.a1 === id - 1) { E.liveR.a1 = id; E.liveR.t1 = T; }       // the usual case: extend the live range
    else { E.liveLast = id; addCov(id, id, T, T); }
    E.liveLast = id; E.liveT = T;
    for (var i = 0; i < E.listeners.length; i++) { try { E.listeners[i]({ src: 'bn', T: T, p: price, q: qty, buy: buy }); } catch (e) { console.error(e); } }
    CF.redraw();
}

// ---- history (newest first, throttled) ---------------------------------------------------------------------------------
function queueIds(a, b) {
    if (b < a) return;
    E.bf.total += b - a + 1;
    for (var x = b; x >= a; x -= 1000) E.bf.q.push({ from: Math.max(a, x - 999), to: x });
    E.bf.q.sort(function (p, q) { return q.to - p.to; });
    pump();
}
function getJson(url) {
    return fetch(url).then(function (r) {
        var w = +r.headers.get('x-mbx-used-weight-1m');
        if (w > 1800) E.bf.pauseUntil = Date.now() + 15000;               // leave room for the chart's own requests
        if (r.status === 429 || r.status === 418) { E.bf.pauseUntil = Date.now() + 60000; throw new Error('rate ' + r.status); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    });
}
function pump() {
    var bf = E.bf;
    if (bf.busy || bf.timer || !bf.q.length || !E.users) return;
    var wait = Math.max(0, (bf.last || 0) + REQ_GAP_MS - Date.now(), bf.pauseUntil - Date.now());
    bf.timer = setTimeout(function () {
        bf.timer = 0;
        var job = bf.q.shift(); if (!job) return;
        bf.busy = true; bf.last = Date.now();
        var gen = E.gen, sym = E.sym;
        getJson(FAPI + '/fapi/v1/aggTrades?symbol=' + sym + '&fromId=' + job.from + '&limit=' + Math.min(1000, job.to - job.from + 1)).then(function (rows) {
            if (gen !== E.gen || !Array.isArray(rows)) return;
            var t0 = Infinity, t1 = -Infinity, n = 0;
            rows.forEach(function (d) {
                if (d.a < job.from || d.a > job.to) return;
                addTrade('bn', d.T, +d.p, +d.q, !d.m); n++;
                if (d.T < t0) t0 = d.T; if (d.T > t1) t1 = d.T;
            });
            if (n) addCov(job.from, job.to, t0, t1);
            bf.done += job.to - job.from + 1;
            CF.redraw(); CF.scheduleLegend();
        }).catch(function () {
            if (gen === E.gen) { bf.q.push(job); bf.q.sort(function (p, q) { return q.to - p.to; }); bf.pauseUntil = Math.max(bf.pauseUntil, Date.now() + 5000); }
        }).then(function () {
            bf.busy = false;
            if (gen === E.gen) { if (!bf.q.length) { bf.done = bf.total = 0; saveSoon(); CF.scheduleLegend(); } pump(); }
        });
    }, wait);
}
function histHours() { return +CF.S('fp').hist || 4; }
// what is missing between the start of the history window and the first live trade, minus what the phone already has
function startHistory(firstLive) {
    var gen = E.gen, from = Date.now() - histHours() * 3600000;
    getJson(FAPI + '/fapi/v1/aggTrades?symbol=' + E.sym + '&startTime=' + from + '&limit=1').then(function (r) {
        if (gen !== E.gen || !Array.isArray(r) || !r.length) return;
        var cur = r[0].a, end = firstLive - 1;
        E.cov.slice().sort(function (x, y) { return x.a0 - y.a0; }).forEach(function (rg) {
            if (rg.a1 < cur || rg.a0 > end) return;
            if (rg.a0 > cur) queueIds(cur, Math.min(end, rg.a0 - 1));
            cur = Math.max(cur, rg.a1 + 1);
        });
        if (cur <= end) queueIds(cur, end);
    }).catch(function () { /* no history: live trades still fill in */ });
}

// ---- IndexedDB -------------------------------------------------------------------------------------------------------
var dbP = null;
function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res) {
        try {
            var r = indexedDB.open('cf_orderflow', 1);
            r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('min'); d.createObjectStore('cov'); };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { res(null); };
        } catch (e) { res(null); }
    });
    return dbP;
}
function keyOf(sym, mt) { return sym + '|' + mt; }
function enc(s) { var o = { bq: s.bq, sq: s.sq, b: [], s: [] }; s.b.forEach(function (q, k) { o.b.push(k, q); }); s.s.forEach(function (q, k) { o.s.push(k, q); }); return o; }
function dec(o) {
    var s = { b: new Map(), s: new Map(), bq: o.bq || 0, sq: o.sq || 0 }, i;
    for (i = 0; i + 1 < o.b.length; i += 2) s.b.set(o.b[i], o.b[i + 1]);
    for (i = 0; i + 1 < o.s.length; i += 2) s.s.set(o.s[i], o.s[i + 1]);
    return s;
}
function saveSoon() { if (!E.saveT) E.saveT = setTimeout(function () { E.saveT = 0; save(); }, SAVE_MS); }
function save() {
    clearTimeout(E.saveT); E.saveT = 0;
    if (!E.sym || !E.dirty.size) return Promise.resolve();
    var sym = E.sym, tick = E.tick, rows = [], cov = E.cov.map(function (r) { return { a0: r.a0, a1: r.a1, t0: r.t0, t1: r.t1 }; });
    E.dirty.forEach(function (mt) {
        var m = E.min.get(mt); if (!m) return;
        var v = { tick: tick, src: {} }; Object.keys(m.src).forEach(function (k) { v.src[k] = enc(m.src[k]); });
        rows.push([keyOf(sym, mt), v]);
    });
    E.dirty.clear();
    return db().then(function (d) {
        if (!d) return;
        try {
            var tx = d.transaction(['min', 'cov'], 'readwrite');
            rows.forEach(function (r) { tx.objectStore('min').put(r[1], r[0]); });
            tx.objectStore('cov').put({ tick: tick, cov: cov }, sym);
        } catch (e) { /* storage full or gone: the live data still works */ }
    });
}
function memFrom() { return Math.floor(Date.now() / 1000) - (histHours() + 1) * 3600; }
function prune() {
    var from = memFrom();
    E.min.forEach(function (m, mt) { if (mt < from) E.min.delete(mt); });
}
function load(sym, tick) {
    var from = Math.floor(Date.now() / 1000) - KEEP_DB_H * 3600, mem = memFrom();
    return db().then(function (d) {
        if (!d) return null;
        return new Promise(function (res) {
            try {
                var tx = d.transaction(['min', 'cov'], 'readwrite'), out = { min: [], cov: null };
                var range = IDBKeyRange.bound(keyOf(sym, '0000000000'), keyOf(sym, '9999999999'));
                tx.objectStore('min').openCursor(range).onsuccess = function (e) {
                    var c = e.target.result; if (!c) return;
                    var mt = +String(c.key).split('|')[1];
                    if (mt < from || !c.value || c.value.tick !== tick) c.delete();     // old, or binned with another tick size
                    else if (mt >= mem) out.min.push([mt, c.value]);
                    c.continue();
                };
                tx.objectStore('cov').get(sym).onsuccess = function (e) { var v = e.target.result; if (v && v.tick === tick) out.cov = v.cov; };
                tx.oncomplete = function () { res(out); };
                tx.onerror = function () { res(null); };
            } catch (e) { res(null); }
        });
    });
}

// ---- lifecycle ---------------------------------------------------------------------------------------------------------
// Trades are binned by a fixed price step per symbol: the exchange tick, or a nice multiple of it near 0.002 % of the
// price (BTC: $2), so a day of a busy market stays a few MB. Footprint rows are multiples of this step.
function tickFor(sym) {
    var cache = LS.get('ofBin', {}) || {};
    if (cache[sym]) return Promise.resolve(cache[sym]);
    return getJson(FAPI + '/fapi/v1/exchangeInfo?symbol=' + sym).then(function (info) {
        var s = (info.symbols || []).filter(function (x) { return x.symbol === sym; })[0];
        var f = s && (s.filters || []).filter(function (x) { return x.filterType === 'PRICE_FILTER'; })[0];
        var t = f ? +f.tickSize : 0;
        if (!(t > 0)) throw new Error('no tick');
        return t;
    }).catch(function () { return Math.pow(10, -CF.precision()); }).then(function (t) {
        var cs = CF.candles(), p = cs.length ? cs[cs.length - 1].close : 0, want = p * 0.00002, m = 1;
        for (var i = 0; i < NICE.length && t * NICE[i] < want; i++) m = NICE[Math.min(i + 1, NICE.length - 1)];
        var bin = +(t * m).toPrecision(6);
        cache[sym] = bin; LS.set('ofBin', cache);
        return bin;
    });
}
var visHook = null;
function engineUse() {
    if (++E.users > 1) return;
    var sym = CF.symbol(), gen = ++E.gen;
    E.sym = sym; E.min = new Map(); E.cov = []; E.ver++; E.liveFirst = E.liveLast = 0; E.dirty = new Set();
    E.bf = { q: [], busy: false, timer: 0, done: 0, total: 0, pauseUntil: 0 };
    tickFor(sym).then(function (tick) {
        if (gen !== E.gen) return;
        E.tick = tick;
        return load(sym, tick).then(function (st) {
            if (gen !== E.gen) return;
            if (st) {
                st.min.forEach(function (r) { var m = { ver: 1, src: {} }; Object.keys(r[1].src || {}).forEach(function (k) { m.src[k] = dec(r[1].src[k]); }); E.min.set(r[0], m); });
                (st.cov || []).forEach(function (r) { addCov(r.a0, r.a1, r.t0, r.t1); });
                E.ver++;
            }
            E.pruneT = setInterval(prune, 5 * 60000);
            E.handler = onAgg;
            streams.market.sub(sym.toLowerCase() + '@aggTrade', E.handler);
            CF.redraw();
        });
    });
    if (!visHook) {
        visHook = function () { if (document.hidden && E.users) save(); };
        document.addEventListener('visibilitychange', visHook);
    }
}
function engineRelease() {
    if (E.users === 0 || --E.users > 0) return;
    if (E.handler) streams.market.unsub(E.sym.toLowerCase() + '@aggTrade', E.handler);
    E.handler = null;
    clearInterval(E.pruneT); E.pruneT = 0;
    clearTimeout(E.bf.timer); E.bf.timer = 0; E.bf.q = [];
    save();
    E.gen++;
}
// trades of [t0, t1) seconds summed over the minutes, per tick: Map(tickIdx -> [buy, sell]); cached per candle
var cellCache = new Map();
function cells(t0, t1, srcs) {
    var vs = 0, mt, m, any = false;
    for (mt = t0 - (t0 % 60); mt < t1; mt += 60) { m = E.min.get(mt); if (m) { vs += m.ver * 31 + mt; any = true; } }
    if (!any) return null;
    var key = t1 + '|' + srcs + '|' + vs + '|' + E.gen, hit = cellCache.get(t0);
    if (hit && hit.key === key) return hit.res;
    var rows = new Map(), bq = 0, sq = 0;
    for (mt = t0 - (t0 % 60); mt < t1; mt += 60) {
        m = E.min.get(mt); if (!m) continue;
        srcs.split(',').forEach(function (id) {
            var s = m.src[id]; if (!s) return;
            s.b.forEach(function (q, k) { var r = rows.get(k); if (!r) rows.set(k, r = [0, 0]); r[0] += q; });
            s.s.forEach(function (q, k) { var r = rows.get(k); if (!r) rows.set(k, r = [0, 0]); r[1] += q; });
            bq += s.bq; sq += s.sq;
        });
    }
    var res = { rows: rows, bq: bq, sq: sq, cover: coverOf(t0 * 1000, t1 * 1000), bins: {} };
    if (cellCache.size > 3000) cellCache.clear();
    cellCache.set(t0, { key: key, res: res });
    return res;
}
// the same cells binned into rows of k ticks: Map(bin -> [buy, sell])
function binned(c, k) {
    var b = c.bins[k]; if (b) return b;
    b = new Map();
    c.rows.forEach(function (v, tk) { var j = Math.floor(tk / k), r = b.get(j); if (!r) b.set(j, r = [0, 0]); r[0] += v[0]; r[1] += v[1]; });
    return (c.bins[k] = b);
}
function candleEnd(i) { var cs = CF.candles(); return i + 1 < cs.length ? cs[i + 1].time : CF.nextOpen(cs[i].time); }

// =====================================================================================================
// Footprint
// =====================================================================================================
CF.defineSettings('fp', {
    title: '풋프린트 설정', onChange: function (c, k) { if (k === 'hist' && E.users && E.liveFirst) startHistory(E.liveFirst); fpSync(true); CF.redraw(); },
    fields: [
        { t: 'sec', label: '데이터' },
        { k: 'hist', t: 'sel', label: '켤 때 불러올 과거 체결', def: '4', opts: [['1', '1시간'], ['2', '2시간'], ['4', '4시간'], ['8', '8시간'], ['12', '12시간']] },
        { t: 'note', label: '비트코인은 1시간치를 받는 데 약 1분 반 걸립니다(최근 것부터 채워짐). 받은 체결은 폰에 48시간 보관되어 다음에는 빠진 구간만 받습니다. 거래량이 적은 코인은 훨씬 빠릅니다.' },
        { t: 'sec', label: '표시' },
        { k: 'minW', t: 'range', label: '풋프린트로 바뀌는 봉 너비', def: 30, min: 16, max: 90, step: 1, unit: 'px', sub: '숫자는 칸에 들어갈 만큼 넓어지면 나타납니다' },
        { k: 'mode', t: 'sel', label: '칸 숫자', def: 'split', opts: [['split', '매도 × 매수'], ['delta', '델타'], ['vol', '거래량']] },
        { k: 'row', t: 'sel', label: '칸 가격 간격', def: 'auto', opts: [['auto', '자동'], ['1', '최소'], ['2', '×2'], ['5', '×5'], ['10', '×10'], ['25', '×25'], ['50', '×50']] },
        { k: 'rowPx', t: 'range', label: '자동일 때 칸 높이', def: 15, min: 10, max: 30, step: 1, unit: 'px', showIf: function (c) { return c.row === 'auto'; } },
        { k: 'heat', t: 'range', label: '칸 배경 진하기', def: 40, min: 0, max: 100, step: 1, unit: '%' },
        { t: 'sec', label: '강조' },
        { k: 'imb', t: 'bool', label: '불균형 칸 강조', sub: '대각선 비교(매수 칸 vs 한 칸 아래 매도)가 기준 이상인 칸', def: true },
        { k: 'ratio', t: 'range', label: '불균형 기준', def: 300, min: 150, max: 800, step: 10, unit: '%', showIf: function (c) { return c.imb; } },
        { k: 'stack', t: 'bool', label: '연속 불균형(3칸 이상) 표시', def: true, showIf: function (c) { return c.imb; } },
        { k: 'poc', t: 'bool', label: '봉별 POC (최다 체결 가격) 테두리', def: true },
        { k: 'sum', t: 'bool', label: '봉 아래 델타 · 거래량', def: true },
        { t: 'note', label: '차트를 확대해 봉이 넓어지면 캔들이 가격 칸으로 바뀌고, 칸마다 그 가격에서 체결된 시장가 매도(왼쪽)·매수(오른쪽) 수량을 보여줍니다. 체결 기록이 없는 봉은 일반 캔들로 남습니다.' }
    ]
});
var fp = { on: false, active: false, k: 1, tintT: 0, tintKey: '' };
function rowTicks(cfg) {
    if (cfg.row !== 'auto') return +cfg.row || 1;
    var cs = CF.candles(); if (!cs.length || !E.tick) return 1;
    var p = cs[cs.length - 1].close, y0 = CF.yOf(p), y1 = CF.yOf(p + 100 * E.tick);
    if (y0 == null || y1 == null || y0 === y1) return fp.k || 1;
    var pxPerTick = Math.abs(y0 - y1) / 100;
    for (var i = 0; i < NICE.length; i++) if (NICE[i] * pxPerTick >= cfg.rowPx) return NICE[i];
    return NICE[NICE.length - 1];
}
// at most 4 characters: 0 · .04 · 3.2 · 41 · 960 · 12K · 1.4M
function fmtQ(v) {
    var a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (a >= 1e6) return sg + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return sg + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    if (a >= 10) return sg + a.toFixed(0);
    if (a >= 1) return sg + a.toFixed(1);
    if (a < 0.005) return '0';
    return sg + a.toFixed(2).replace(/^0/, '');
}
function visibleIdx() {
    var r = chart.timeScale().getVisibleLogicalRange(), n = CF.candles().length; if (!r || !n) return null;
    return { a: Math.max(0, Math.floor(r.from)), z: Math.min(n - 1, Math.ceil(r.to)) };
}
function fpIsActive() {
    var t = CF.chartType(); if (t !== 'candle' && t !== 'ha') return false;
    var bs = CF.barSpacing(); return bs != null && bs >= CF.S('fp').minW;
}
// candles with trades lose their fill and wick (the cells show the range); the rest stay ordinary candles
function fpTints() {
    var vis = visibleIdx(), cs = CF.candles(), map = {}, srcs = srcKey();
    if (!vis || !fp.active) return map;
    var a = Math.max(0, vis.a - 50), z = Math.min(cs.length - 1, vis.z + 50);
    for (var i = a; i <= z; i++) {
        var c = cs[i], cl = cells(c.time, candleEnd(i), srcs); if (!cl || !cl.rows.size) continue;
        map[c.time] = { color: CLEAR, wickColor: CLEAR, borderColor: c.close >= c.open ? UP() : DOWN() };
    }
    return map;
}
function fpSync(force) {
    var act = fp.on && fpIsActive();
    if (act !== fp.active || force) {
        fp.active = act;
        CF.candleOverride(act ? { borderVisible: true, borderUpColor: UP(), borderDownColor: DOWN() } : null);
    }
    var tints = act ? fpTints() : {}, key = Object.keys(tints).join(',');
    if (key !== fp.tintKey || force) { fp.tintKey = key; CF.barTint('fp', tints, CF.symbol() + '|' + CF.interval()); }
    lastLabel();
}
// the last-price label takes the newest bar's color, which is see-through in footprint mode: give it the candle's color
function lastLabel() {
    var cs = CF.candles(), c = cs[cs.length - 1], col = fp.active && c ? (c.close >= c.open ? UP() : DOWN()) : '';
    if (col !== fp.plc) { fp.plc = col; CF.mainSeries().applyOptions({ priceLineColor: col }); }
}
CF.onData(function () { if (fp.active) lastLabel(); });
function srcKey() { return 'bn'; }
function paintFpCells(ctx, w, h) {
    if (!fp.active) return;
    var cfg = CF.S('fp'), vis = visibleIdx(); if (!vis || !E.tick) return;
    var cs = CF.candles(), ts = chart.timeScale(), bw = CF.barSpacing(), cw = Math.max(4, bw * 0.86), k = fp.k = rowTicks(cfg), step = k * E.tick, srcs = srcKey();
    var heat = cfg.heat / 100;
    for (var i = vis.a; i <= vis.z; i++) {
        var c = cs[i], cl = cells(c.time, candleEnd(i), srcs); if (!cl || !cl.rows.size) continue;
        var x = ts.logicalToCoordinate(i); if (x == null || x < -cw || x > w + cw) continue;
        var bins = binned(cl, k), max = 0;
        bins.forEach(function (v) { if (v[0] + v[1] > max) max = v[0] + v[1]; });
        if (!max || !heat) continue;
        bins.forEach(function (v, j) {
            var yT = CF.yOf((j + 1) * step), yB = CF.yOf(j * step); if (yT == null || yB == null || yB < 0 || yT > h) return;
            var tot = v[0] + v[1];
            ctx.fillStyle = CF.hexA(v[0] >= v[1] ? UP() : DOWN(), heat * (0.08 + 0.42 * tot / max));
            ctx.fillRect(x - cw / 2, yT, cw, Math.max(1, yB - yT - 1));
        });
    }
}
function paintFpText(ctx, w, h) {
    if (!fp.active) return;
    var cfg = CF.S('fp'), vis = visibleIdx(); if (!vis || !E.tick) return;
    var cs = CF.candles(), ts = chart.timeScale(), bw = CF.barSpacing(), cw = Math.max(4, bw * 0.86), k = fp.k, step = k * E.tick, srcs = srcKey();
    var ratio = cfg.ratio / 100, rh0 = Math.abs((CF.yOf(cs[cs.length - 1].close) || 0) - (CF.yOf(cs[cs.length - 1].close + step) || 0));
    // the font is the largest that fits the row height and, for "sell × buy", four characters in half the cell
    var fs = Math.min(11, rh0 - 3), room = cfg.mode === 'split' ? cw / 2 - 4 : cw - 6;
    ctx.font = '10px ui-monospace, monospace';
    var w10 = ctx.measureText('8888').width;                             // width of four digits at 10px
    fs = Math.floor(Math.min(fs, 10 * room / w10));
    var numbers = fs >= 7;
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (var i = vis.a; i <= vis.z; i++) {
        var c = cs[i], cl = cells(c.time, candleEnd(i), srcs); if (!cl || !cl.rows.size) continue;
        var x = ts.logicalToCoordinate(i); if (x == null || x < -cw || x > w + cw) continue;
        var bins = binned(cl, k), max = 0, poc = null, lo = Infinity, hi = -Infinity;
        bins.forEach(function (v, j) { var t = v[0] + v[1]; if (t > max) { max = t; poc = j; } if (j < lo) lo = j; if (j > hi) hi = j; });
        var floorQ = max * 0.03, run = { buy: 0, sell: 0 }, stacks = [];
        for (var j = lo; j <= hi; j++) {
            var v = bins.get(j) || [0, 0], below = bins.get(j - 1) || [0, 0], above = bins.get(j + 1) || [0, 0];
            var bImb = cfg.imb && v[0] > floorQ && v[0] >= ratio * Math.max(below[1], floorQ * 0.5);
            var sImb = cfg.imb && v[1] > floorQ && v[1] >= ratio * Math.max(above[0], floorQ * 0.5);
            run.buy = bImb ? run.buy + 1 : 0; run.sell = sImb ? run.sell + 1 : 0;
            if (cfg.stack && run.buy === 3) stacks.push({ j0: j - 2, buy: true }); else if (cfg.stack && run.buy > 3) stacks[stacks.length - 1].j1 = j;
            if (cfg.stack && run.sell === 3) stacks.push({ j0: j - 2, buy: false }); else if (cfg.stack && run.sell > 3) stacks[stacks.length - 1].j1 = j;
            if (!numbers || (!v[0] && !v[1])) continue;
            var y = CF.yOf((j + 0.5) * step); if (y == null || y < -10 || y > h + 10) continue;
            if (cfg.mode === 'split') {
                ctx.textAlign = 'right'; ctx.font = (sImb ? '700 ' : '') + fs + 'px ui-monospace, monospace';
                ctx.fillStyle = sImb ? DOWN() : 'rgba(209,212,220,.82)'; ctx.fillText(fmtQ(v[1]), x - 2, y);
                ctx.textAlign = 'left'; ctx.font = (bImb ? '700 ' : '') + fs + 'px ui-monospace, monospace';
                ctx.fillStyle = bImb ? UP() : 'rgba(209,212,220,.82)'; ctx.fillText(fmtQ(v[0]), x + 2, y);
            } else {
                var val = cfg.mode === 'delta' ? v[0] - v[1] : v[0] + v[1];
                ctx.textAlign = 'center'; ctx.font = ((bImb || sImb) ? '700 ' : '') + fs + 'px ui-monospace, monospace';
                ctx.fillStyle = cfg.mode === 'delta' ? (val >= 0 ? UP() : DOWN()) : 'rgba(209,212,220,.85)';
                ctx.fillText((cfg.mode === 'delta' && val > 0 ? '+' : '') + fmtQ(val), x, y);
            }
        }
        if (cfg.poc && poc != null) {
            var pT = CF.yOf((poc + 1) * step), pB = CF.yOf(poc * step);
            if (pT != null && pB != null) { ctx.strokeStyle = 'rgba(240,185,11,.9)'; ctx.lineWidth = 1; ctx.strokeRect(x - cw / 2 + 0.5, pT + 0.5, cw - 1, Math.max(1, pB - pT - 1)); }
        }
        stacks.forEach(function (s) {                      // a bar on the side of the candle along the stacked rows
            var yA = CF.yOf(((s.j1 || s.j0 + 2) + 1) * step), yB = CF.yOf(s.j0 * step); if (yA == null || yB == null) return;
            ctx.fillStyle = s.buy ? UP() : DOWN();
            ctx.fillRect(s.buy ? x + cw / 2 + 1 : x - cw / 2 - 3, yA, 2, yB - yA);
        });
        if (cfg.sum && cw >= 30) {
            var yl = CF.yOf(Math.min(c.low, lo * step)); if (yl == null || yl > h - 12) continue;
            var d = cl.bq - cl.sq;
            ctx.font = '600 ' + Math.min(10, fs) + 'px ui-monospace, monospace'; ctx.textAlign = 'center';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(19,23,34,.9)';
            var t1 = (d >= 0 ? '+' : '') + fmtQ(d), t2 = fmtQ(cl.bq + cl.sq);
            ctx.strokeText(t1, x, yl + 9); ctx.fillStyle = d >= 0 ? UP() : DOWN(); ctx.fillText(t1, x, yl + 9);
            ctx.strokeText(t2, x, yl + 20); ctx.fillStyle = 'rgba(178,181,190,.9)'; ctx.fillText(t2, x, yl + 20);
            if (cl.cover < 0.98) { ctx.strokeText('일부', x, yl + 31); ctx.fillStyle = '#F0B90B'; ctx.fillText('일부', x, yl + 31); }
        }
    }
    ctx.textAlign = 'start';
}
var fpOff = null, fpRange = null, fpTimer = 0;
function onRange() { fpSync(false); }
CF.registerFeature('fp', {
    legend: function () {
        var bf = E.bf, parts = '풋프린트';
        if (bf.total) parts += ' · 체결 불러오는 중 ' + Math.floor(bf.done / bf.total * 100) + '%';
        else if (!fp.active) parts += ' · 확대하면 표시';
        else parts += ' · 칸 ' + CF.fmtPrice(fp.k * E.tick);
        return '<span style="color:#B2B5BE">' + parts + '</span>';
    },
    start: function () {
        fp.on = true; engineUse();
        var offA = CF.layer('bottom', paintFpCells), offB = CF.layer('top', paintFpText);
        fpOff = function () { offA(); offB(); };
        chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
        fpTimer = setInterval(function () { fpSync(false); }, 2500);   // new data turns more candles into footprints
        fpSync(true);
        if (!fp.active) CF.toast('풋프린트: 차트를 확대하면 가격별 체결량이 보여요');
    },
    stop: function () {
        fp.on = false;
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
        clearInterval(fpTimer); fpTimer = 0;
        if (fpOff) { fpOff(); fpOff = null; }
        fpSync(true);
        engineRelease();
    }
});

// ---- the volume profile uses real trade prices where the engine holds every trade of a candle ---------------------------
CF.vpTrades(function (i) {
    if (!E.users || !E.tick) return null;
    var cs = CF.candles(), c = cs[i]; if (!c) return null;
    var cl = cells(c.time, candleEnd(i), 'bn');
    if (!cl || cl.cover < 0.98) return null;
    return { rows: cl.rows, tick: E.tick, ver: E.ver };
});

window.__of = { E: E, cells: cells, fp: fp, save: save, coverOf: coverOf };
})();
