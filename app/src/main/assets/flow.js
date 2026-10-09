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
function UP() { return CF.C.up; }
function DOWN() { return CF.C.down; }

function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
function fmtUsd(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
// open time (seconds) of the loaded candle that contains t; null when t is outside the loaded candles.
// (Binance weekly candles start on Mondays, so plain floor(t / interval) would not line up.)
function candleStartOf(t) {
    var a = CF.candles(), lo = 0, hi = a.length - 1, best = -1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (a[m].time <= t) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 && t < a[best].time + CF.secs() ? a[best].time : null;
}
// small text with a dark halo instead of a filled pill, so labels never hide the bars they describe
function tag(ctx, text, x, y, color, align) {
    ctx.font = '600 10px -apple-system, Roboto, sans-serif';
    ctx.textAlign = align === 'right' ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(19,23,34,.92)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.textAlign = 'start';
}
function lastPrice() { var c = CF.candles(); return c.length ? c[c.length - 1].close : 0; }

// =====================================================================================================
// Settings schemas
// =====================================================================================================
function redraw() { CF.redraw(); }
CF.defineSettings('oi', {
    title: '미결제약정(OI) 설정', onChange: function () { CF.styleSubs(); CF.refreshSub('oi'); },
    fields: [
        { k: 'color', t: 'color', label: '선 색', def: '#FFB300' },
        { k: 'width', t: 'range', label: '선 두께', def: 2, min: 1, max: 4, step: 1, unit: 'px' },
        { k: 'unit', t: 'sel', label: '단위', def: 'usd', opts: [['usd', '금액 ($)'], ['coin', '수량 (코인)']] }
    ]
});
CF.defineSettings('liq', {
    title: '실시간 청산 설정', onChange: function () { CF.styleSubs(); redraw(); },
    fields: [
        { t: 'sec', label: '버블' },
        { k: 'bubbles', t: 'bool', label: '차트에 청산 버블 표시', def: true },
        { k: 'minUsd', t: 'num', label: '표시 최소 금액 ($)', def: 0, min: 0, max: 5000000, step: 1000, showIf: function (c) { return c.bubbles; } },
        { k: 'size', t: 'range', label: '버블 크기', def: 1, min: 0.5, max: 2, step: 0.1, showIf: function (c) { return c.bubbles; } },
        { k: 'opacity', t: 'range', label: '버블 진하기', def: 32, min: 10, max: 80, step: 1, unit: '%', showIf: function (c) { return c.bubbles; } },
        { k: 'labels', t: 'bool', label: '금액 숫자 표시', def: true, showIf: function (c) { return c.bubbles; } },
        { k: 'labelMin', t: 'num', label: '숫자 표시 최소 금액 ($)', def: 150000, min: 0, max: 5000000, step: 10000, showIf: function (c) { return c.bubbles && c.labels; } },
        { t: 'note', label: '청산 데이터는 앱이 켜져 있는 동안 받은 것만 쌓입니다. (롱청산 = 빨강 계열, 숏청산 = 초록 계열)' }
    ]
});
CF.defineSettings('trades', {
    title: '대량 체결 설정', onChange: redraw,
    fields: [
        { k: 'mode', t: 'sel', label: '기준', def: 'auto', opts: [['auto', '자동 (상위 0.5%)'], ['fixed', '직접 지정']] },
        { k: 'floor', t: 'num', label: '자동일 때 최소 금액 ($)', def: 15000, min: 1000, max: 5000000, step: 1000, showIf: function (c) { return c.mode === 'auto'; } },
        { k: 'fixed', t: 'num', label: '표시 기준 금액 ($)', def: 100000, min: 1000, max: 20000000, step: 10000, showIf: function (c) { return c.mode === 'fixed'; } },
        { k: 'size', t: 'range', label: '버블 크기', def: 1, min: 0.5, max: 2, step: 0.1 },
        { k: 'opacity', t: 'range', label: '버블 진하기', def: 38, min: 10, max: 90, step: 1, unit: '%' },
        { k: 'labels', t: 'bool', label: '금액 숫자 표시', def: true }
    ]
});
CF.defineSettings('depth', {
    title: '호가 벽 설정', onChange: redraw,
    fields: [
        { t: 'sec', label: '깊이 막대' },
        { k: 'bars', t: 'bool', label: '우측 깊이 막대 표시', def: true },
        { k: 'barW', t: 'range', label: '막대 최대 길이', def: 28, min: 10, max: 50, step: 1, unit: '%', showIf: function (c) { return c.bars; } },
        { k: 'opacity', t: 'range', label: '막대 진하기', def: 32, min: 10, max: 80, step: 1, unit: '%', showIf: function (c) { return c.bars; } },
        { k: 'rowPx', t: 'range', label: '막대 두께(촘촘함)', def: 6, min: 3, max: 14, step: 1, unit: 'px', showIf: function (c) { return c.bars; } },
        { t: 'sec', label: '매수 · 매도 벽' },
        { k: 'walls', t: 'range', label: '표시할 벽 개수', def: 4, min: 0, max: 8, step: 1 },
        { k: 'minWall', t: 'num', label: '벽으로 볼 최소 금액 ($)', def: 60000, min: 5000, max: 50000000, step: 10000 },
        { k: 'labels', t: 'bool', label: '금액 라벨 (막대 왼쪽)', def: true },
        { k: 'lines', t: 'sel', label: '벽 점선', def: 'short', opts: [['off', '없음'], ['short', '짧게'], ['long', '길게']] },
        { t: 'note', label: '벽은 현재가 아래에는 매수벽, 위에는 매도벽만 표시합니다. 1.2초 이상 유지된 주문만 벽으로 인정해 깜빡임을 줄였습니다.' }
    ]
});
CF.defineSettings('heat', {
    title: '호가 히트맵 설정', onChange: function () { heatRecolor(); redraw(); },
    fields: [
        { k: 'palette', t: 'sel', label: '색상', def: 'fire', opts: [['fire', '열화상'], ['ice', '아이스'], ['mono', '흑백']] },
        { k: 'gain', t: 'range', label: '민감도 (높을수록 작은 물량도 진하게)', def: 4, min: 1, max: 10, step: 1 },
        { k: 'opacity', t: 'range', label: '전체 진하기', def: 100, min: 20, max: 100, step: 1, unit: '%' }
    ]
});
CF.defineSettings('liqmap', {
    title: '추정 청산맵 설정', onChange: redraw,
    fields: [
        { k: 'barW', t: 'range', label: '막대 최대 길이', def: 30, min: 10, max: 50, step: 1, unit: '%' },
        { k: 'opacity', t: 'range', label: '막대 진하기', def: 50, min: 15, max: 90, step: 1, unit: '%' },
        { k: 'labels', t: 'bool', label: '큰 청산 구간 금액 표시', def: true },
        { k: 'count', t: 'range', label: '표시할 개수', def: 3, min: 1, max: 8, step: 1, showIf: function (c) { return c.labels; } },
        { t: 'note', label: 'OI 변화와 레버리지 구간으로 계산한 추정 모델입니다. 거래소가 공개한 실제 청산 주문 데이터가 아닙니다.' }
    ]
});

// =====================================================================================================
// Open interest (history from Binance + live polling)
// =====================================================================================================
var OI_PERIOD = { '1m': '5m', '3m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d', '1w': '1d' };
var PERIOD_SEC = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400 };
var oi = { pts: [], timer: null, seq: 0, period: '15m' };

function oiVal(p) { return CF.S('oi').unit === 'coin' ? p.coin : p.usd; }
// The pane shares the time scale with the candles, so every sample is snapped onto the candle that contains it; samples
// outside the loaded candles (or off the candle grid) would otherwise insert extra bars and shift all overlays.
function oiPoints() {
    var out = [], lastT = null;
    oi.pts.forEach(function (p) {
        var t = candleStartOf(p.time); if (t == null) return;
        if (t === lastT) out[out.length - 1].value = oiVal(p); else { out.push({ time: t, value: oiVal(p) }); lastT = t; }
    });
    return out;
}
function oiAt(candleT) {                            // last OI sample at or before the candle's end
    var a = oi.pts, lo = 0, hi = a.length - 1, best = -1, end = candleT + CF.secs() - 1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (a[m].time <= end) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 ? { cur: a[best], prev: best > 0 ? a[best - 1] : null } : null;
}
CF.registerSub('oi', {
    create: function (pane) {
        return { line: chart.addSeries(LW.LineSeries, { color: '#FFB300', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: CF.compactFormat }, pane) };
    },
    style: function (o) { var c = CF.S('oi'); o.line.applyOptions({ color: c.color, lineWidth: c.width }); },
    setData: function (o) { o.line.setData(oiPoints()); },
    legend: function (i) {
        var c = CF.candles()[i], r = c && oiAt(c.time);
        if (!r) return '';
        var cur = oiVal(r.cur), prev = r.prev ? oiVal(r.prev) : 0, chg = prev ? (cur - prev) / prev * 100 : 0;
        return '<span style="color:' + CF.S('oi').color + '">OI ' + CF.fmtVol(cur) + '</span> <span class="' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>';
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
            oi.pts = rows.map(function (r) { return { time: Math.floor(r.timestamp / 1000), coin: +r.sumOpenInterest, usd: +r.sumOpenInterestValue }; }).sort(function (a, b) { return a.time - b.time; });
            CF.refreshSub('oi');
        }).catch(function () { CF.toast('미결제약정 데이터를 불러오지 못했어요'); });
        oi.timer = setInterval(function () {
            getJson(FAPI + '/fapi/v1/openInterest?symbol=' + sym).then(function (r) {
                if (seq !== oi.seq || !oi.pts.length) return;
                var per = PERIOD_SEC[oi.period] || 3600, t = Math.floor(Date.now() / 1000 / per) * per, coin = +r.openInterest, usd = coin * lastPrice(), last = oi.pts[oi.pts.length - 1];
                if (last.time === t) { last.coin = coin; last.usd = usd; } else if (t > last.time) oi.pts.push({ time: t, coin: coin, usd: usd });
                var live = CF.subSeries('oi'), ct = candleStartOf(Date.now() / 1000);
                if (live && ct != null) live.line.update({ time: ct, value: CF.S('oi').unit === 'coin' ? coin : usd });
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
        var t = candleStartOf(e.t); if (t == null) return;
        var b = m[t] || (m[t] = { L: 0, S: 0 });
        if (e.side === 'L') b.L += e.usd; else b.S += e.usd;
    });
    return m;
}
function liqSeriesData() {
    var m = liqBuckets(), longs = [], shorts = [];
    CF.candles().forEach(function (c) {
        var b = m[c.time];
        if (b && b.L) longs.push({ time: c.time, value: -b.L, color: CF.hexA(DOWN(), 0.75) });
        if (b && b.S) shorts.push({ time: c.time, value: b.S, color: CF.hexA(UP(), 0.75) });
    });
    return { longs: longs, shorts: shorts };
}
CF.registerSub('liq', {
    create: function (pane) {
        var o = { L: chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: CF.compactFormat }, pane) };
        o.S = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: CF.compactFormat }, pane);
        return o;
    },
    setData: function (o) { var d = liqSeriesData(); o.L.setData(d.longs); o.S.setData(d.shorts); },
    legend: function (i) {
        var c = CF.candles()[i], b = c && liqBuckets()[c.time];
        return '<span style="color:' + DOWN() + '">롱청산 ' + fmtUsd(b ? b.L : 0) + '</span> <span style="color:' + UP() + '">숏청산 ' + fmtUsd(b ? b.S : 0) + '</span>';
    }
});
function paintLiq(ctx, w, h) {
    var cfg = CF.S('liq');
    if (!liq.list.length || !cfg.bubbles) return;
    ctx.font = '600 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (var i = 0; i < liq.list.length; i++) {
        var e = liq.list[i];
        if (e.usd < cfg.minUsd) continue;
        var x = CF.xOf(e.t), y = CF.yOf(e.price);
        if (x == null || y == null || x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        var r = clamp((3 + Math.sqrt(e.usd) / 28) * cfg.size, 2.5, 30), col = e.side === 'L' ? DOWN() : UP();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = CF.hexA(col, cfg.opacity / 100); ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.stroke();
        if (cfg.labels && e.usd >= cfg.labelMin) { ctx.fillStyle = '#fff'; ctx.fillText(fmtUsd(e.usd), x, y); }
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
// Large trades (aggTrade) as bubbles. Auto mode: roughly the biggest 0.5 % of recent prints.
// =====================================================================================================
var big = { list: [], recent: [], thr: 0, n: 0, off: null, name: null };
function updateThreshold() {
    var a = big.recent.slice().sort(function (x, y) { return x - y; });
    big.thr = a[Math.floor(a.length * 0.995)] || 0;
}
function bigLimit(cfg) { return cfg.mode === 'fixed' ? cfg.fixed : Math.max(cfg.floor, big.thr); }
function paintBig(ctx, w, h) {
    if (!big.list.length) return;
    var cfg = CF.S('trades'), lim = bigLimit(cfg);
    ctx.font = '600 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (var i = 0; i < big.list.length; i++) {
        var e = big.list[i];
        if (e.usd < lim) continue;
        var x = CF.xOf(e.t), y = CF.yOf(e.price);
        if (x == null || y == null || x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        var r = clamp((4 + Math.sqrt(e.usd / lim) * 6) * cfg.size, 3, 30), col = e.buy ? UP() : DOWN();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = CF.hexA(col, cfg.opacity / 100); ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = CF.hexA(col, 0.9); ctx.stroke();
        if (cfg.labels && r >= 11) { ctx.fillStyle = '#fff'; ctx.fillText(fmtUsd(e.usd), x, y); }
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
            var cfg = CF.S('trades');
            if (usd >= bigLimit(cfg) && (cfg.mode === 'fixed' || big.recent.length >= 200)) {
                big.list.push({ t: Math.floor(d.T / 1000), price: +d.p, usd: usd, buy: !d.m });         // m = buyer is the maker → a sell
                if (big.list.length > 300) big.list.shift();
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
//
// Snapshot + diff stream, kept gap-free per Binance's rules. A re-sync never blanks the picture: the old book stays on
// screen while a fresh one is built off to the side and swapped in atomically (this removed the wall "flicker").
// =====================================================================================================
function applyDiff(bids, asks, d) {
    var i, l;
    for (i = 0; i < d.b.length; i++) { l = d.b[i]; if (+l[1] === 0) bids.delete(+l[0]); else bids.set(+l[0], +l[1]); }
    for (i = 0; i < d.a.length; i++) { l = d.a[i]; if (+l[1] === 0) asks.delete(+l[0]); else asks.set(+l[0], +l[1]); }
}
var Book = {
    users: 0, bids: new Map(), asks: new Map(), has: false, syncing: false, buf: [], lastU: 0, first: false,
    name: null, sym: null, seq: 0, pruneT: 0, snapAt: 0, best: null,
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
    reset: function () { this.bids = new Map(); this.asks = new Map(); this.has = false; this.syncing = false; this.buf = []; this.lastU = 0; this.first = false; this.best = null; },
    snapshot: function () {
        var self = this, seq = ++this.seq, sym = this.sym;
        this.syncing = true; this.buf = []; this.snapAt = Date.now();
        getJson(FAPI + '/fapi/v1/depth?symbol=' + sym + '&limit=1000').then(function (snap) {
            if (seq !== self.seq || self.users === 0) return;
            var nb = new Map(), na = new Map(), id = snap.lastUpdateId, last = id, ok = true, started = false;
            snap.bids.forEach(function (l) { nb.set(+l[0], +l[1]); });
            snap.asks.forEach(function (l) { na.set(+l[0], +l[1]); });
            // replay what arrived while the snapshot was in flight: drop events older than the snapshot, then require a gap-free chain
            self.buf.forEach(function (d) {
                if (!ok || d.u < id) return;
                if (!started) { if (d.U > id + 1) { ok = false; return; } started = true; }
                else if (d.pu !== last) { ok = false; return; }
                applyDiff(nb, na, d); last = d.u;
            });
            if (!ok) { setTimeout(function () { if (seq === self.seq && self.users) self.snapshot(); }, 1200); return; }
            self.bids = nb; self.asks = na; self.lastU = last; self.first = !started;
            self.buf = []; self.syncing = false; self.has = true; self.best = null;
            CF.redraw();
        }).catch(function () { setTimeout(function () { if (seq === self.seq && self.users) self.snapshot(); }, 3000); });
    },
    resync: function () {
        if (this.syncing) return;
        this.syncing = true; this.buf = [];
        var self = this, seq = this.seq, wait = Math.max(0, 1500 - (Date.now() - this.snapAt));   // never hammer the REST endpoint
        setTimeout(function () { if (seq === self.seq && self.users) self.snapshot(); }, wait);
    },
    onDiff: function (d) {
        if (!d || d.s !== this.sym) return;
        if (this.syncing) { this.buf.push(d); if (this.buf.length > 600) this.buf.shift(); return; }
        if (d.u < this.lastU) return;                                        // already contained in what we have
        if (this.first) { if (d.U > this.lastU + 1) { this.resync(); return; } this.first = false; }
        else if (d.pu !== this.lastU) { this.resync(); return; }
        applyDiff(this.bids, this.asks, d); this.lastU = d.u;
        this.afterApply(d);
    },
    afterApply: function (d) {
        this.best = null;
        var q = this.quotes();
        if (q && q.bid >= q.ask) {                                           // crossed book: drop the stale side, never draw it
            var hiBid = -Infinity, loAsk = Infinity, self = this;
            d.b.forEach(function (l) { if (+l[1] > 0 && +l[0] > hiBid) hiBid = +l[0]; });
            d.a.forEach(function (l) { if (+l[1] > 0 && +l[0] < loAsk) loAsk = +l[0]; });
            this.asks.forEach(function (qty, p) { if (p <= hiBid) self.asks.delete(p); });
            this.bids.forEach(function (qty, p) { if (p >= loAsk) self.bids.delete(p); });
            this.best = null; q = this.quotes();
            if (!q || q.bid >= q.ask) { this.resync(); return; }
        }
        var now = Date.now();
        if (now - this.pruneT > 10000) { this.pruneT = now; this.prune(); }
        CF.redraw();
    },
    // best bid / best ask, cached until the next update
    quotes: function () {
        if (this.best) return this.best;
        var b = -Infinity, a = Infinity;
        this.bids.forEach(function (q, p) { if (p > b) b = p; });
        this.asks.forEach(function (q, p) { if (p < a) a = p; });
        return (this.best = isFinite(b) && isFinite(a) ? { bid: b, ask: a } : null);
    },
    mid: function () { var q = this.quotes(); return q ? (q.bid + q.ask) / 2 : 0; },
    prune: function () {                                                       // keep the book bounded: ±8 % around the mid price
        var m = this.mid(); if (!m) return; var lo = m * 0.92, hi = m * 1.08, self = this;
        this.bids.forEach(function (q, p) { if (p < lo) self.bids.delete(p); });
        this.asks.forEach(function (q, p) { if (p > hi) self.asks.delete(p); });
    }
};
streams.pub.hooks.push(function () { if (Book.users) Book.resync(); });          // socket re-opened → rebuild quietly

// ---- walls & depth profile -------------------------------------------------------------------------------------------
// Bars: resting liquidity per price row on the right edge, binned on a fixed price grid so they do not slide while the
// chart moves. Walls: individual levels that stand far above the rest; each one has to persist before it is shown and
// stays a moment after it fades, so ordinary book churn does not make them blink.
var walls = { map: new Map(), t: 0 }, depthView = { max: 1, t: 0 };
function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var e = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}
function updateWalls(minWall) {
    var now = Date.now(); if (now - walls.t < 400) return; walls.t = now;
    var q = Book.quotes(); if (!q) return;
    var all = [];
    Book.bids.forEach(function (qty, p) { if (p <= q.bid) all.push({ p: p, v: p * qty, bid: true }); });
    Book.asks.forEach(function (qty, p) { if (p >= q.ask) all.push({ p: p, v: p * qty, bid: false }); });
    if (!all.length) return;
    var vals = all.map(function (l) { return l.v; }).sort(function (a, b) { return a - b; });
    var thr = Math.max(minWall, vals[Math.floor(vals.length * 0.992)] || 0);                // top ~0.8 % of the book
    all.forEach(function (l) {
        if (l.v < thr) return;
        var st = walls.map.get(l.p);
        if (st && st.bid === l.bid) { st.v = l.v; st.seen = now; }
        else walls.map.set(l.p, { p: l.p, v: l.v, bid: l.bid, seen: now, born: now, shown: false });
    });
    walls.map.forEach(function (st, p) {
        if (st.seen === now) return;
        var qty = (st.bid ? Book.bids : Book.asks).get(p), v = qty ? qty * p : 0;
        if (v >= thr * 0.6) { st.v = v; st.seen = now; }                                  // shrank a bit, still a wall
        else if (now - st.seen > 1500) walls.map.delete(p);                               // gone for good
        else st.v = v;
    });
}
function visibleWalls(cfg, pBot, pTop) {
    var q = Book.quotes(), last = lastPrice(), now = Date.now(), out = [];
    if (!q || !cfg.walls) return out;
    walls.map.forEach(function (st) {
        if (now - st.born < 1200 || st.v <= 0) return;                                   // flashing orders are ignored
        if (st.p < pBot || st.p > pTop) return;                                          // only walls inside the view compete for the slots
        // a wall always belongs to its own side of the market: buy walls under the price, sell walls above it
        if (st.bid && (st.p > q.bid || (last && st.p > last * 1.0002))) return;
        if (!st.bid && (st.p < q.ask || (last && st.p < last * 0.9998))) return;
        out.push(st);
    });
    out.sort(function (a, b) { return b.v * (b.shown ? 1.3 : 1) - a.v * (a.shown ? 1.3 : 1); });   // already shown ones keep their slot
    var top = out.slice(0, cfg.walls);
    walls.map.forEach(function (st) { st.shown = false; });
    top.forEach(function (st) { st.shown = true; });
    return top;
}
function paintDepth(ctx, w, h) {
    if (!Book.has) return;
    var q = Book.quotes(); if (!q) return;
    var cfg = CF.S('depth'), pTop = CF.priceAt(0), pBot = CF.priceAt(h);
    if (pTop == null || pBot == null || !(pTop > pBot)) return;
    updateWalls(cfg.minWall);
    var maxW = w * cfg.barW / 100, upC = UP(), dnC = DOWN(), len, k;
    var step = niceStep((pTop - pBot) / Math.max(4, h / cfg.rowPx));
    var i0 = Math.floor(pBot / step), n = Math.floor(pTop / step) - i0 + 1;
    if (n < 1 || n > 800) return;
    var bid = new Float64Array(n), ask = new Float64Array(n), idx;
    Book.bids.forEach(function (qty, p) { idx = Math.floor(p / step) - i0; if (idx >= 0 && idx < n) bid[idx] += p * qty; });
    Book.asks.forEach(function (qty, p) { idx = Math.floor(p / step) - i0; if (idx >= 0 && idx < n) ask[idx] += p * qty; });
    // scale reference: a handful of huge orders must not flatten everything else, and the scale must not jump frame to frame
    var nz = [], mx = 0;
    for (k = 0; k < n; k++) { if (bid[k] > 0) nz.push(bid[k]); if (ask[k] > 0) nz.push(ask[k]); }
    nz.sort(function (a, b) { return a - b; });
    if (nz.length) mx = Math.min(nz[nz.length - 1], nz[Math.floor(nz.length * 0.9)] * 2.5);
    var now = Date.now(), dt = depthView.t ? now - depthView.t : 0; depthView.t = now;
    depthView.max = Math.max(mx, depthView.max * Math.pow(0.5, dt / 4000), 1);
    var ref = depthView.max;
    if (cfg.bars) {
        ctx.fillStyle = CF.hexA(upC, cfg.opacity / 100);
        for (k = 0; k < n; k++) {
            if (!(bid[k] > 0)) continue;
            var lo = (i0 + k) * step, hi = Math.min(lo + step, q.bid);          // a row can never reach above the best bid
            if (hi <= lo) continue;
            var y1 = CF.yOf(hi), y2 = CF.yOf(lo); if (y1 == null || y2 == null) continue;
            len = Math.max(1.5, Math.min(1, bid[k] / ref) * maxW);
            ctx.fillRect(w - len, y1, len, Math.max(1, y2 - y1 - 0.6));
        }
        ctx.fillStyle = CF.hexA(dnC, cfg.opacity / 100);
        for (k = 0; k < n; k++) {
            if (!(ask[k] > 0)) continue;
            var lo2 = Math.max((i0 + k) * step, q.ask), hi2 = (i0 + k) * step + step;   // ... nor below the best ask
            if (hi2 <= lo2) continue;
            var ya = CF.yOf(hi2), yb = CF.yOf(lo2); if (ya == null || yb == null) continue;
            len = Math.max(1.5, Math.min(1, ask[k] / ref) * maxW);
            ctx.fillRect(w - len, ya, len, Math.max(1, yb - ya - 0.6));
        }
    }
    var list = visibleWalls(cfg, pBot, pTop).sort(function (a, b) { return CF.yOf(a.p) - CF.yOf(b.p); }), lastLabelY = -99;
    list.forEach(function (wl) {
        var y = CF.yOf(wl.p); if (y == null || y < 4 || y > h - 4) return;
        var col = wl.bid ? upC : dnC;
        len = Math.max(3, Math.min(1, wl.v / ref) * maxW);
        ctx.fillStyle = CF.hexA(col, 0.85); ctx.fillRect(w - len, y - 1.5, len, 3);          // the wall itself, drawn solid
        var xr = w - len - 5, xl = xr;
        if (cfg.labels && Math.abs(y - lastLabelY) >= 12) {                                // label sits left of the bar: it never covers it
            var text = (wl.bid ? '매수 ' : '매도 ') + fmtUsd(wl.v);
            tag(ctx, text, xr, y, col, 'right'); lastLabelY = y;
            ctx.font = '600 10px -apple-system, Roboto, sans-serif';
            xl = xr - ctx.measureText(text).width - 5;
        }
        if (cfg.lines !== 'off' && xl > 8) {
            var span = w * (cfg.lines === 'long' ? 0.45 : 0.14);
            ctx.strokeStyle = CF.hexA(col, 0.5); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(Math.max(0, xl - span), y); ctx.stroke(); ctx.setLineDash([]);
        }
    });
}
var depthOff = null;
CF.registerFeature('depth', {
    start: function () { walls.map.clear(); depthView.max = 1; depthView.t = 0; Book.start(); depthOff = CF.layer('top', paintDepth); },
    stop: function () { if (depthOff) { depthOff(); depthOff = null; } walls.map.clear(); Book.stop(); }
});

// ---- heatmap ------------------------------------------------------------------------------------------------------------
// Each ~1.5 s the resting liquidity per price cell is sampled into one pixel column of an off-screen canvas. The canvas
// is stretched over the chart (time → x, price → y), so panning/zooming is a single drawImage call. Raw intensities are
// kept per column, so palette/sensitivity changes recolor the whole history, and a price re-centering keeps it too.
var Heat = { COLS: 1200, ROWS: 320, cv: null, cx: null, low: 0, high: 0, step: 0, t0: 0, dt: 1.5, cols: 0, med: 0, timer: null, off: null, buf: [] };
var HEAT_PAL = {
    fire: [[0.04, 20, 40, 110, 70], [0.25, 30, 100, 210, 130], [0.5, 0, 200, 200, 170], [0.75, 250, 215, 0, 200], [1, 255, 90, 50, 235]],
    ice: [[0.04, 10, 25, 70, 60], [0.3, 25, 80, 190, 130], [0.6, 0, 185, 230, 180], [1, 235, 250, 255, 235]],
    mono: [[0.04, 255, 255, 255, 20], [1, 255, 255, 255, 215]]
};
function heatInit(mid) {
    Heat.cv = document.createElement('canvas'); Heat.cv.width = Heat.COLS; Heat.cv.height = Heat.ROWS;
    Heat.cx = Heat.cv.getContext('2d', { willReadFrequently: true });
    Heat.step = mid * 0.00018; Heat.low = mid - Heat.step * Heat.ROWS / 2; Heat.high = Heat.low + Heat.step * Heat.ROWS;
    Heat.cols = 0; Heat.t0 = 0; Heat.med = 0; Heat.buf = [];
}
function heatPixel(q, pal, span, out, o) {                                         // q: intensity*20 (0..255) → rgba into out[o..o+3]
    var t = clamp((q / 20 - 0.8) / span, 0, 1);
    if (t < 0.04) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
    for (var i = 1; i < pal.length; i++) {
        if (t <= pal[i][0]) {
            var a = pal[i - 1], b = pal[i], f = (t - a[0]) / (b[0] - a[0]);
            out[o] = a[1] + (b[1] - a[1]) * f; out[o + 1] = a[2] + (b[2] - a[2]) * f; out[o + 2] = a[3] + (b[3] - a[3]) * f; out[o + 3] = a[4] + (b[4] - a[4]) * f;
            return;
        }
    }
    var l = pal[pal.length - 1]; out[o] = l[1]; out[o + 1] = l[2]; out[o + 2] = l[3]; out[o + 3] = l[4];
}
function heatRecolor() {
    if (!Heat.cx || !Heat.buf.length) return;
    var cfg = CF.S('heat'), pal = HEAT_PAL[cfg.palette] || HEAT_PAL.fire, span = 8 - 0.7 * cfg.gain, rows = Heat.ROWS, n = Heat.buf.length;
    var img = Heat.cx.createImageData(n, rows), c, r;
    for (c = 0; c < n; c++) for (r = 0; r < rows; r++) heatPixel(Heat.buf[c][rows - 1 - r], pal, span, img.data, (r * n + c) * 4);   // canvas row 0 = highest price
    Heat.cx.clearRect(0, 0, Heat.COLS, rows);
    Heat.cx.putImageData(img, 0, 0);
}
// price moved towards the edge of the grid: slide the grid (same row size) instead of throwing the history away
function heatRecenter(mid) {
    var d = Math.round((mid - Heat.step * Heat.ROWS / 2 - Heat.low) / Heat.step);
    if (!d) return;
    Heat.buf = Heat.buf.map(function (col) {
        var n = new Uint8Array(Heat.ROWS);
        for (var j = 0; j < Heat.ROWS; j++) { var o = j + d; if (o >= 0 && o < Heat.ROWS) n[j] = col[o]; }
        return n;
    });
    Heat.low += d * Heat.step; Heat.high = Heat.low + Heat.step * Heat.ROWS;
    heatRecolor();
}
function heatSample() {
    if (!Book.has) return;
    var mid = Book.mid(); if (!mid) return;
    if (!Heat.cv) heatInit(mid);
    else if (mid < Heat.low + (Heat.high - Heat.low) * 0.2 || mid > Heat.high - (Heat.high - Heat.low) * 0.2) heatRecenter(mid);
    var rows = Heat.ROWS, vals = new Float64Array(rows), idx, i;
    function add(q, p) { idx = Math.floor((p - Heat.low) / Heat.step); if (idx >= 0 && idx < rows) vals[idx] += p * q; }
    Book.bids.forEach(add); Book.asks.forEach(add);
    // Colors are relative to what is normal for this book: ordinary cells stay transparent, thick resting orders heat up.
    var nz = []; for (i = 0; i < rows; i++) if (vals[i] > 0) nz.push(vals[i]);
    if (nz.length) { nz.sort(function (a, b) { return a - b; }); var med = nz[nz.length >> 1]; Heat.med = Heat.med ? Heat.med * 0.9 + med * 0.1 : med; }
    var base = Math.max(Heat.med || 1, 1), col = new Uint8Array(rows);
    for (i = 0; i < rows; i++) col[i] = Math.min(255, Math.round(vals[i] / base * 20));
    var cfg = CF.S('heat'), pal = HEAT_PAL[cfg.palette] || HEAT_PAL.fire, span = 8 - 0.7 * cfg.gain, img = Heat.cx.createImageData(1, rows);
    for (var r = 0; r < rows; r++) heatPixel(col[rows - 1 - r], pal, span, img.data, r * 4);
    if (Heat.cols >= Heat.COLS) { Heat.cx.drawImage(Heat.cv, -1, 0); Heat.t0 += Heat.dt; Heat.buf.shift(); }       // scroll left by one column
    else { if (Heat.cols === 0) Heat.t0 = Date.now() / 1000; Heat.cols++; }
    Heat.buf.push(col);
    Heat.cx.putImageData(img, Heat.cols - 1, 0);
    CF.redraw();
}
function paintHeat(ctx, w, h) {
    if (!Heat.cv || !Heat.cols) return;
    var x0 = CF.xOf(Heat.t0), x1 = CF.xOf(Heat.t0 + Heat.cols * Heat.dt), y0 = CF.yOf(Heat.high), y1 = CF.yOf(Heat.low);
    if (x0 == null || x1 == null || y0 == null || y1 == null || x1 <= x0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha = CF.S('heat').opacity / 100;
    ctx.drawImage(Heat.cv, 0, 0, Heat.cols, Heat.ROWS, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
}
CF.registerFeature('heat', {
    start: function () {
        Book.start(); Heat.cv = null; Heat.cols = 0; Heat.buf = [];
        Heat.off = CF.layer('bottom', paintHeat);
        Heat.timer = setInterval(heatSample, Heat.dt * 1000);
    },
    stop: function () {
        clearInterval(Heat.timer); Heat.timer = null;
        if (Heat.off) { Heat.off(); Heat.off = null; }
        Heat.cv = null; Heat.cols = 0; Heat.buf = []; Book.stop();
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
    var cfg = CF.S('liqmap'), pTop = CF.priceAt(0), pBot = CF.priceAt(h); if (pTop == null || pBot == null) return;
    var last = lastPrice(), max = 1;
    lmap.levels.forEach(function (c) { if (c.price <= pTop && c.price >= pBot) max = Math.max(max, c.L + c.S); });
    var maxW = w * cfg.barW / 100, tops = [];
    lmap.levels.forEach(function (c) {
        if (c.price > pTop || c.price < pBot) return;
        var y = CF.yOf(c.price), v = c.L + c.S; if (y == null || v <= 0) return;
        var long = c.price < last, bw = Math.max(1, v / max * maxW), col = long ? DOWN() : UP();
        ctx.fillStyle = CF.hexA(col, cfg.opacity / 100);
        ctx.fillRect(0, y - 2.5, bw, 5);
        tops.push({ y: y, v: v, col: col, bw: bw });
    });
    if (cfg.labels) {
        tops.sort(function (a, b) { return b.v - a.v; });
        var used = [];
        tops.slice(0, cfg.count * 2).forEach(function (t) {
            if (used.length >= cfg.count || used.some(function (y) { return Math.abs(y - t.y) < 12; })) return;
            used.push(t.y); tag(ctx, fmtUsd(t.v), t.bw + 5, t.y, t.col, 'left');   // just past the end of its bar
        });
    }
    tag(ctx, '추정 청산맵(모델)', 4, h - 10, '#B2B5BE', 'left');
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

window.__flow = { modelLiq: modelLiq, Book: Book, Heat: Heat, oi: oi, liq: liq, big: big, lmap: lmap, walls: walls, fmtUsd: fmtUsd };
})();
