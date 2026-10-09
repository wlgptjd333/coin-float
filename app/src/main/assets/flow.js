(function () {
'use strict';
// =====================================================================================================
// Order-flow features built on Binance USDⓈ-M public data: open interest, live liquidations, large trades,
// order-book walls, liquidity heatmap and a modelled liquidation map.
// Every feature only runs while it is switched on AND the chart is visible (core handles start/stop).
// =====================================================================================================
var CF = window.CF;
if (!CF) return;
var LW = CF.LW, chart = CF.chart, LS = CF.LS, streams = CF.streams;
var FAPI = 'https://fapi.binance.com';
var UP = '#0ECB81', DOWN = '#F6465D';

function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
function fmtUsd(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function candleTime(t) { var s = CF.secs(); return Math.floor(t / s) * s; }       // start of the candle that contains t (seconds)

// =====================================================================================================
// Open interest (history from Binance + live polling)
// =====================================================================================================
var OI_PERIOD = { '1m': '5m', '3m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d', '1w': '1d' };
var PERIOD_SEC = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400 };
var oi = { pts: [], timer: null, seq: 0, period: '15m' };

function oiPoints() { return oi.pts.map(function (p) { return { time: p.time, value: p.value }; }); }
function oiAt(candleT) {                            // last OI sample at or before the candle time
    var a = oi.pts, lo = 0, hi = a.length - 1, best = -1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (a[m].time <= candleT) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 ? { cur: a[best], prev: best > 0 ? a[best - 1] : null } : null;
}
CF.registerSub('oi', {
    create: function (pane) {
        return { line: chart.addSeries(LW.LineSeries, { color: '#FFB300', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'volume' } }, pane) };
    },
    setData: function (o) { o.line.setData(oiPoints()); },
    legend: function (i) {
        var c = CF.candles()[i], r = c && oiAt(c.time);
        if (!r) return '';
        var chg = r.prev && r.prev.value ? (r.cur.value - r.prev.value) / r.prev.value * 100 : 0;
        return '<span style="color:#FFB300">OI ' + CF.fmtVol(r.cur.value) + '</span> <span class="' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>';
    }
});
CF.registerFeature('oi', {
    byInterval: true,
    start: function () {
        var sym = CF.symbol(), seq = ++oi.seq;
        oi.period = OI_PERIOD[CF.interval()] || '1h';
        oi.pts = [];
        getJson(FAPI + '/futures/data/openInterestHist?symbol=' + sym + '&period=' + oi.period + '&limit=500').then(function (rows) {
            if (seq !== oi.seq || !Array.isArray(rows)) return;
            oi.pts = rows.map(function (r) { return { time: Math.floor(r.timestamp / 1000), value: +r.sumOpenInterest }; }).sort(function (a, b) { return a.time - b.time; });
            CF.refreshSub('oi');
        }).catch(function () { CF.toast('미결제약정 데이터를 불러오지 못했어요'); });
        oi.timer = setInterval(function () {
            getJson(FAPI + '/fapi/v1/openInterest?symbol=' + sym).then(function (r) {
                if (seq !== oi.seq || !oi.pts.length) return;
                var per = PERIOD_SEC[oi.period] || 3600, t = Math.floor(Date.now() / 1000 / per) * per, v = +r.openInterest, last = oi.pts[oi.pts.length - 1];
                if (last.time === t) last.value = v; else if (t > last.time) oi.pts.push({ time: t, value: v });
                var live = CF.subSeries('oi'); if (live) live.line.update({ time: oi.pts[oi.pts.length - 1].time, value: v });
                CF.scheduleLegend();
            }).catch(function () { /* next poll */ });
        }, 15000);
    },
    stop: function () { oi.seq++; clearInterval(oi.timer); oi.timer = null; oi.pts = []; }
});

// =====================================================================================================
// Live liquidations: bubbles on the chart + long/short liquidation volume per candle
// =====================================================================================================
var liq = { list: [], saveT: null, off: null, name: null, key: null };
function liqKey() { return 'liq.' + CF.symbol(); }
function liqSave() { clearTimeout(liq.saveT); liq.saveT = setTimeout(function () { LS.set(liq.key, liq.list.slice(-400)); }, 3000); }
function liqBuckets() {
    var m = {};
    liq.list.forEach(function (e) {
        var t = candleTime(e.t), b = m[t] || (m[t] = { L: 0, S: 0 });
        if (e.side === 'L') b.L += e.usd; else b.S += e.usd;
    });
    return m;
}
function liqSeriesData() {
    var m = liqBuckets(), longs = [], shorts = [];
    CF.candles().forEach(function (c) {
        var b = m[c.time];
        if (b && b.L) longs.push({ time: c.time, value: -b.L, color: 'rgba(246,70,93,.75)' });
        if (b && b.S) shorts.push({ time: c.time, value: b.S, color: 'rgba(14,203,129,.75)' });
    });
    return { longs: longs, shorts: shorts };
}
CF.registerSub('liq', {
    create: function (pane) {
        var o = { L: chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } }, pane) };
        o.S = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } }, pane);
        return o;
    },
    setData: function (o) { var d = liqSeriesData(); o.L.setData(d.longs); o.S.setData(d.shorts); },
    legend: function (i) {
        var c = CF.candles()[i], b = c && liqBuckets()[c.time];
        return '<span style="color:#F6465D">롱청산 ' + fmtUsd(b ? b.L : 0) + '</span> <span style="color:#0ECB81">숏청산 ' + fmtUsd(b ? b.S : 0) + '</span>';
    }
});
function paintLiq(ctx, w, h) {
    if (!liq.list.length) return;
    ctx.font = '600 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (var i = 0; i < liq.list.length; i++) {
        var e = liq.list[i], x = CF.xOf(e.t), y = CF.yOf(e.price);
        if (x == null || y == null || x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        var r = clamp(3 + Math.sqrt(e.usd) / 28, 3, 22), col = e.side === 'L' ? DOWN : UP;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = CF.hexA(col, 0.32); ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.stroke();
        if (e.usd >= 150000) { ctx.fillStyle = '#fff'; ctx.fillText(fmtUsd(e.usd), x, y); }
    }
    ctx.textAlign = 'start';
}
CF.registerFeature('liq', {
    start: function () {
        var sym = CF.symbol(), cutoff = Date.now() / 1000 - 3 * 86400;
        liq.name = sym.toLowerCase() + '@forceOrder'; liq.key = liqKey();
        liq.list = (LS.get(liq.key, []) || []).filter(function (e) { return e && e.t > cutoff; });
        liq.off = CF.layer('top', paintLiq);
        CF.refreshSub('liq');
        streams.market.sub(liq.name, function (d) {
            var o = d && d.o; if (!o || o.s !== sym) return;
            var price = +o.ap || +o.p, qty = +o.z || +o.q, usd = price * qty;
            if (!(usd > 0)) return;
            // a forced SELL closes a long position, a forced BUY closes a short
            liq.list.push({ t: Math.floor((o.T || Date.now()) / 1000), side: o.S === 'SELL' ? 'L' : 'S', price: price, usd: usd });
            if (liq.list.length > 600) liq.list.splice(0, liq.list.length - 600);
            liqSave(); CF.redraw(); CF.refreshSub('liq');
        });
    },
    stop: function () {
        streams.market.unsub(liq.name);
        if (liq.off) { liq.off(); liq.off = null; }
        clearTimeout(liq.saveT); if (liq.list.length) LS.set(liq.key, liq.list.slice(-400));
        liq.list = [];
    }
});

// =====================================================================================================
// Large trades (aggTrade) as bubbles. The threshold adapts to the market: roughly the biggest 0.1 % of recent prints.
// =====================================================================================================
var big = { list: [], recent: [], thr: 0, n: 0, off: null, name: null };
function updateThreshold() {
    var a = big.recent.slice().sort(function (x, y) { return x - y; });
    big.thr = Math.max(15000, a[Math.floor(a.length * 0.995)] || 0);
}
function paintBig(ctx, w, h) {
    if (!big.list.length) return;
    ctx.font = '600 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (var i = 0; i < big.list.length; i++) {
        var e = big.list[i], x = CF.xOf(e.t), y = CF.yOf(e.price);
        if (x == null || y == null || x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        var r = clamp(4 + Math.sqrt(e.usd / big.thr) * 6, 4, 20), col = e.buy ? UP : DOWN;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = CF.hexA(col, 0.38); ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = CF.hexA(col, 0.9); ctx.stroke();
        if (r >= 11) { ctx.fillStyle = '#fff'; ctx.fillText(fmtUsd(e.usd), x, y); }
    }
    ctx.textAlign = 'start';
}
CF.registerFeature('trades', {
    start: function () {
        var sym = CF.symbol();
        big.name = sym.toLowerCase() + '@aggTrade';
        big.list = []; big.recent = []; big.n = 0; big.thr = 15000;
        big.off = CF.layer('top', paintBig);
        streams.market.sub(big.name, function (d) {
            if (!d || d.s !== sym) return;
            var usd = +d.p * +d.q;
            big.recent.push(usd); if (big.recent.length > 2000) big.recent.shift();
            if (++big.n % 150 === 0 || big.recent.length === 200) updateThreshold();
            if (usd >= big.thr && big.recent.length >= 200) {
                big.list.push({ t: Math.floor(d.T / 1000), price: +d.p, usd: usd, buy: !d.m });         // m = buyer is the maker → a sell
                if (big.list.length > 250) big.list.shift();
                CF.redraw();
            }
        });
    },
    stop: function () {
        streams.market.unsub(big.name);
        if (big.off) { big.off(); big.off = null; }
        big.list = []; big.recent = [];
    }
});

// =====================================================================================================
// Order book (shared by the wall profile and the heatmap)
// =====================================================================================================
var Book = {
    users: 0, bids: new Map(), asks: new Map(), ready: false, buf: [], lastU: 0, name: null, sym: null, seq: 0, pruneT: 0,
    start: function () {
        if (++this.users > 1) return;
        var self = this; this.sym = CF.symbol(); this.name = this.sym.toLowerCase() + '@depth@500ms';
        this.reset();
        streams.pub.sub(this.name, function (d) { self.onDiff(d); });
        this.snapshot();
    },
    stop: function () {
        if (this.users === 0 || --this.users > 0) return;
        streams.pub.unsub(this.name); this.reset(); this.seq++;
    },
    reset: function () { this.bids.clear(); this.asks.clear(); this.ready = false; this.buf = []; this.lastU = 0; },
    snapshot: function () {
        var self = this, seq = ++this.seq, sym = this.sym;
        this.ready = false; this.buf = [];
        getJson(FAPI + '/fapi/v1/depth?symbol=' + sym + '&limit=1000').then(function (snap) {
            if (seq !== self.seq || self.users === 0) return;
            self.bids.clear(); self.asks.clear();
            snap.bids.forEach(function (l) { self.bids.set(+l[0], +l[1]); });
            snap.asks.forEach(function (l) { self.asks.set(+l[0], +l[1]); });
            // replay buffered diffs: skip what the snapshot already contains, then require a gap-free chain
            var id = snap.lastUpdateId, started = false, ok = true;
            self.buf.forEach(function (d) {
                if (d.u <= id) return;
                if (!started) { if (d.U > id + 1) { ok = false; return; } started = true; }
                else if (d.pu !== self.lastU) { ok = false; return; }
                self.apply(d);
            });
            if (!ok) { setTimeout(function () { if (seq === self.seq) self.snapshot(); }, 800); return; }
            if (!started) self.lastU = id;
            self.buf = []; self.ready = true; CF.redraw();
        }).catch(function () { setTimeout(function () { if (seq === self.seq && self.users) self.snapshot(); }, 3000); });
    },
    onDiff: function (d) {
        if (!d || d.s !== this.sym) return;
        if (!this.ready) { this.buf.push(d); if (this.buf.length > 400) this.buf.shift(); return; }
        if (d.pu !== this.lastU) { this.snapshot(); return; }                // missed an update → rebuild from a fresh snapshot
        this.apply(d); CF.redraw();
    },
    apply: function (d) {
        var i, l;
        for (i = 0; i < d.b.length; i++) { l = d.b[i]; if (+l[1] === 0) this.bids.delete(+l[0]); else this.bids.set(+l[0], +l[1]); }
        for (i = 0; i < d.a.length; i++) { l = d.a[i]; if (+l[1] === 0) this.asks.delete(+l[0]); else this.asks.set(+l[0], +l[1]); }
        this.lastU = d.u;
        var now = Date.now();
        if (now - this.pruneT > 10000) { this.pruneT = now; this.prune(); }
    },
    mid: function () { var b = -Infinity, a = Infinity; this.bids.forEach(function (q, p) { if (p > b) b = p; }); this.asks.forEach(function (q, p) { if (p < a) a = p; }); return isFinite(b) && isFinite(a) ? (a + b) / 2 : 0; },
    prune: function () {                                                       // keep the book bounded: ±8 % around the mid price
        var m = this.mid(); if (!m) return; var lo = m * 0.92, hi = m * 1.08, self = this;
        this.bids.forEach(function (q, p) { if (p < lo) self.bids.delete(p); });
        this.asks.forEach(function (q, p) { if (p > hi) self.asks.delete(p); });
    }
};
streams.pub.hooks.push(function () { if (Book.users) Book.snapshot(); });         // socket re-opened → rebuild

// ---- wall profile ----------------------------------------------------------------------------------------------------
// Bars: resting liquidity per price row on the right edge. Walls: individual levels that stand far above the rest of the book.
var depthOff = null, wallCache = { t: 0, list: [] };
function getWalls() {
    var now = Date.now();
    if (now - wallCache.t < 1000) return wallCache.list;
    var all = [];
    Book.bids.forEach(function (q, p) { all.push({ p: p, v: p * q, bid: true }); });
    Book.asks.forEach(function (q, p) { all.push({ p: p, v: p * q, bid: false }); });
    var sorted = all.map(function (l) { return l.v; }).sort(function (a, b) { return a - b; });
    var thr = Math.max(60000, sorted[Math.floor(sorted.length * 0.992)] || 0);                // top ~0.8 % of the book, at least $60k
    var walls = all.filter(function (l) { return l.v >= thr; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    wallCache = { t: now, list: walls };
    return walls;
}
function paintDepth(ctx, w, h) {
    if (!Book.ready) return;
    var pTop = CF.priceAt(0), pBot = CF.priceAt(h);
    if (pTop == null || pBot == null || pTop <= pBot) return;
    var ROW = 7, n = Math.max(4, Math.floor(h / ROW)), step = (pTop - pBot) / n;
    var bid = new Float64Array(n), ask = new Float64Array(n), idx, i;
    Book.bids.forEach(function (q, p) { idx = Math.floor((pTop - p) / step); if (idx >= 0 && idx < n) bid[idx] += p * q; });
    Book.asks.forEach(function (q, p) { idx = Math.floor((pTop - p) / step); if (idx >= 0 && idx < n) ask[idx] += p * q; });
    var max = 1;
    for (i = 0; i < n; i++) { var v = bid[i] + ask[i]; if (v > max) max = v; }
    var maxW = w * 0.28, rowH = h / n;
    for (i = 0; i < n; i++) {
        var b = bid[i], a = ask[i], val = b || a; if (!val) continue;
        ctx.fillStyle = CF.hexA(b > 0 ? UP : DOWN, 0.3);
        ctx.fillRect(w - Math.max(1.5, val / max * maxW), i * rowH, Math.max(1.5, val / max * maxW), Math.max(1, rowH - 1));
    }
    ctx.textBaseline = 'middle';
    getWalls().forEach(function (wl) {
        var y = CF.yOf(wl.p); if (y == null || y < 6 || y > h - 6) return;
        var col = wl.bid ? UP : DOWN;
        ctx.strokeStyle = CF.hexA(col, 0.55); ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(w * 0.35, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
        CF.label(ctx, (wl.bid ? '매수벽 ' : '매도벽 ') + fmtUsd(wl.v), w - 4, y - 10, CF.hexA(col, 0.9), '#0b0e11', 'right');
    });
}
CF.registerFeature('depth', {
    start: function () { Book.start(); depthOff = CF.layer('top', paintDepth); },
    stop: function () { if (depthOff) { depthOff(); depthOff = null; } Book.stop(); }
});

// ---- heatmap ------------------------------------------------------------------------------------------------------------
// Each ~1.5 s the resting liquidity per price cell is sampled into one pixel column of an off-screen canvas. The canvas
// is stretched over the chart (time → x, price → y), so panning/zooming is a single drawImage call.
var Heat = { COLS: 1200, ROWS: 320, cv: null, cx: null, low: 0, high: 0, step: 0, t0: 0, dt: 1.5, cols: 0, ref: 1, timer: null, off: null };
function heatInit(mid) {
    Heat.cv = document.createElement('canvas'); Heat.cv.width = Heat.COLS; Heat.cv.height = Heat.ROWS;
    Heat.cx = Heat.cv.getContext('2d', { willReadFrequently: true });
    Heat.step = mid * 0.00018; Heat.low = mid - Heat.step * Heat.ROWS / 2; Heat.high = Heat.low + Heat.step * Heat.ROWS;
    Heat.cols = 0; Heat.t0 = 0; Heat.med = 0;
}
function heatColor(t) {                                                   // 0..1 → [r,g,b,a]
    if (t < 0.04) return [0, 0, 0, 0];
    var stops = [[0.04, 20, 40, 110, 70], [0.25, 30, 100, 210, 130], [0.5, 0, 200, 200, 170], [0.75, 250, 215, 0, 200], [1, 255, 90, 50, 235]];
    for (var i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
            return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4] + (b[4] - a[4]) * f];
        }
    }
    return [255, 90, 50, 235];
}
function heatSample() {
    if (!Book.ready) return;
    var mid = Book.mid(); if (!mid) return;
    if (!Heat.cv || mid < Heat.low + (Heat.high - Heat.low) * 0.18 || mid > Heat.high - (Heat.high - Heat.low) * 0.18) heatInit(mid);   // price left the grid → re-center
    var rows = Heat.ROWS, vals = new Float64Array(rows), idx, i;
    function add(q, p) { idx = Math.floor((p - Heat.low) / Heat.step); if (idx >= 0 && idx < rows) vals[idx] += p * q; }
    Book.bids.forEach(add); Book.asks.forEach(add);
    // Colors are relative to what is normal for this book: ordinary cells stay transparent, thick resting orders heat up.
    var nz = []; for (i = 0; i < rows; i++) if (vals[i] > 0) nz.push(vals[i]);
    if (nz.length) { nz.sort(function (a, b) { return a - b; }); var med = nz[nz.length >> 1]; Heat.med = Heat.med ? Heat.med * 0.9 + med * 0.1 : med; }
    var base = Math.max(Heat.med || 1, 1), img = Heat.cx.createImageData(1, rows);
    for (var r = 0; r < rows; r++) {                                                      // canvas row 0 = highest price
        var c = heatColor(clamp((vals[rows - 1 - r] / base - 0.8) / 5, 0, 1)), o = r * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3];
    }
    if (Heat.cols >= Heat.COLS) { Heat.cx.drawImage(Heat.cv, -1, 0); Heat.t0 += Heat.dt; }       // scroll left by one column
    else { if (Heat.cols === 0) Heat.t0 = Date.now() / 1000; Heat.cols++; }
    Heat.cx.putImageData(img, Heat.cols - 1, 0);
    CF.redraw();
}
function paintHeat(ctx, w, h) {
    if (!Heat.cv || !Heat.cols) return;
    var x0 = CF.xOf(Heat.t0), x1 = CF.xOf(Heat.t0 + Heat.cols * Heat.dt), y0 = CF.yOf(Heat.high), y1 = CF.yOf(Heat.low);
    if (x0 == null || x1 == null || y0 == null || y1 == null || x1 <= x0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(Heat.cv, 0, 0, Heat.cols, Heat.ROWS, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
}
CF.registerFeature('heat', {
    start: function () {
        Book.start(); Heat.cv = null; Heat.cols = 0;
        Heat.off = CF.layer('bottom', paintHeat);
        Heat.timer = setInterval(heatSample, Heat.dt * 1000);
    },
    stop: function () {
        clearInterval(Heat.timer); Heat.timer = null;
        if (Heat.off) { Heat.off(); Heat.off = null; }
        Heat.cv = null; Heat.cols = 0; Book.stop();
    }
});

// =====================================================================================================
// Estimated liquidation map (a model, not exchange data): open-interest changes are turned into positions at typical
// leverage tiers; levels that price has traded through are considered liquidated.
// =====================================================================================================
var TIERS = [[5, 0.12], [10, 0.28], [25, 0.28], [50, 0.22], [100, 0.10]], MMR = 0.005;
function modelLiq(oiRows, kl, lsRows) {
    var n = Math.min(oiRows.length, kl.length);
    if (n < 3) return [];
    var ref = kl[n - 1].c, bucket = ref * 0.0015, lv = new Map(), share = 0.5;
    function key(p) { return Math.round(p / bucket); }
    function cell(k) { var c = lv.get(k); if (!c) { c = { price: k * bucket, L: 0, S: 0 }; lv.set(k, c); } return c; }
    for (var i = 1; i < n; i++) {
        var bar = kl[i], dOI = oiRows[i].usd - oiRows[i - 1].usd, prevOI = oiRows[i - 1].usd;
        if (lsRows && lsRows[i] != null) share = lsRows[i];
        lv.forEach(function (c) {                                               // 1) price traded through the level → liquidated
            if (c.L && c.price >= bar.l) c.L = 0;
            if (c.S && c.price <= bar.h) c.S = 0;
        });
        if (dOI > 0) {                                                          // 2) new open interest → new positions
            var px = (bar.h + bar.l + bar.c) / 3;
            TIERS.forEach(function (t) {
                var lev = t[0], wgt = t[1];
                cell(key(px * (1 - 1 / lev + MMR))).L += dOI * share * wgt;
                cell(key(px * (1 + 1 / lev - MMR))).S += dOI * (1 - share) * wgt;
            });
        } else if (dOI < 0 && prevOI > 0) {                                     // closing positions shrink everything proportionally
            var f = 1 - Math.min(1, -dOI / prevOI);
            lv.forEach(function (c) { c.L *= f; c.S *= f; });
        }
    }
    var out = [];
    lv.forEach(function (c) { if (c.L > 0 || c.S > 0) out.push(c); });
    return out.sort(function (a, b) { return a.price - b.price; });
}
var lmap = { levels: [], seq: 0, timer: null, off: null, ready: false };
function paintLiqMap(ctx, w, h) {
    if (!lmap.levels.length) return;
    var pTop = CF.priceAt(0), pBot = CF.priceAt(h); if (pTop == null || pBot == null) return;
    var last = CF.candles()[CF.candles().length - 1].close, max = 1;
    lmap.levels.forEach(function (c) { if (c.price <= pTop && c.price >= pBot) max = Math.max(max, c.L + c.S); });
    var maxW = w * 0.3, tops = [];
    lmap.levels.forEach(function (c) {
        if (c.price > pTop || c.price < pBot) return;
        var y = CF.yOf(c.price), v = c.L + c.S; if (y == null || v <= 0) return;
        var long = c.price < last, bw = Math.max(1, v / max * maxW), col = long ? DOWN : UP;
        ctx.fillStyle = CF.hexA(col, 0.5);
        ctx.fillRect(0, y - 2.5, bw, 5);
        tops.push({ y: y, v: v, col: col });
    });
    tops.sort(function (a, b) { return b.v - a.v; });
    ctx.textBaseline = 'middle';
    tops.slice(0, 3).forEach(function (t) { CF.label(ctx, fmtUsd(t.v), Math.min(maxW, t.v / max * maxW) + 4, t.y, CF.hexA(t.col, 0.85), '#0b0e11'); });
    CF.label(ctx, '추정 청산맵(모델)', 4, h - 12, 'rgba(30,34,45,.85)', '#B2B5BE');
}
function loadLiqMap() {
    var sym = CF.symbol(), seq = ++lmap.seq;
    Promise.all([
        getJson(FAPI + '/futures/data/openInterestHist?symbol=' + sym + '&period=1h&limit=500'),
        getJson(FAPI + '/fapi/v1/klines?symbol=' + sym + '&interval=1h&limit=500'),
        getJson(FAPI + '/futures/data/globalLongShortAccountRatio?symbol=' + sym + '&period=1h&limit=500').catch(function () { return []; })
    ]).then(function (res) {
        if (seq !== lmap.seq) return;
        var klMap = {}; res[1].forEach(function (k) { klMap[Math.floor(k[0] / 1000)] = { t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }; });
        var lsMap = {}; res[2].forEach(function (r) { lsMap[Math.floor(r.timestamp / 1000)] = +r.longAccount; });
        var oiRows = [], kl = [], ls = [];
        res[0].forEach(function (r) {                                           // join by hour so all three series line up
            var t = Math.floor(r.timestamp / 1000), k = klMap[t];
            if (!k) return;
            oiRows.push({ t: t, usd: +r.sumOpenInterestValue }); kl.push(k); ls.push(lsMap[t] != null ? lsMap[t] : null);
        });
        lmap.levels = modelLiq(oiRows, kl, ls); lmap.ready = true; CF.redraw();
    }).catch(function () { CF.toast('청산맵 데이터를 불러오지 못했어요'); });
}
CF.registerFeature('liqmap', {
    start: function () { lmap.off = CF.layer('top', paintLiqMap); loadLiqMap(); lmap.timer = setInterval(loadLiqMap, 5 * 60 * 1000); },
    stop: function () { lmap.seq++; clearInterval(lmap.timer); lmap.timer = null; if (lmap.off) { lmap.off(); lmap.off = null; } lmap.levels = []; }
});

window.__flow = { modelLiq: modelLiq, Book: Book, Heat: Heat, oi: oi, liq: liq, big: big, lmap: lmap, fmtUsd: fmtUsd };
})();
