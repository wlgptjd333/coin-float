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
    return best >= 0 && t < (best + 1 < a.length ? a[best + 1].time : CF.nextOpen(a[best].time)) ? a[best].time : null;
}
// small text with a dark halo instead of a filled pill, so labels never hide the bars they describe
function tag(ctx, text, x, y, color, align, size) {
    ctx.font = '600 ' + (size || 10) + 'px -apple-system, Roboto, sans-serif';
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
        { k: 'ttl', t: 'sel', label: '버블 유지 시간 (지나면 서서히 사라짐)', def: '900', opts: [['60', '1분'], ['300', '5분'], ['900', '15분'], ['3600', '1시간'], ['14400', '4시간'], ['0', '계속 표시']], showIf: function (c) { return c.bubbles; } },
        { k: 'minUsd', t: 'num', label: '표시 최소 금액 ($)', def: 50000, min: 0, max: 5000000, step: 1000, showIf: function (c) { return c.bubbles; } },
        { k: 'size', t: 'range', label: '버블 크기', def: 0.9, min: 0.2, max: 2.5, step: 0.1, unit: '×', showIf: function (c) { return c.bubbles; } },
        { k: 'maxR', t: 'range', label: '버블 최대 크기', def: 24, min: 6, max: 40, step: 1, unit: 'px', showIf: function (c) { return c.bubbles; } },
        { k: 'opacity', t: 'range', label: '채우기 진하기', def: 22, min: 0, max: 90, step: 1, unit: '%', showIf: function (c) { return c.bubbles; } },
        { k: 'lineA', t: 'range', label: '테두리 진하기', def: 70, min: 0, max: 100, step: 1, unit: '%', showIf: function (c) { return c.bubbles; } },
        { k: 'labels', t: 'bool', label: '금액 숫자 표시', def: true, showIf: function (c) { return c.bubbles; } },
        { k: 'labelMin', t: 'num', label: '숫자 표시 최소 금액 ($)', def: 150000, min: 0, max: 5000000, step: 10000, showIf: function (c) { return c.bubbles && c.labels; } },
        { t: 'note', label: '청산 데이터는 앱이 켜져 있는 동안 받은 것만 쌓입니다. (롱청산 = 빨강 계열, 숏청산 = 초록 계열)' }
    ]
});
CF.defineSettings('trades', {
    title: '대량 체결 설정', onChange: redraw,
    fields: [
        { t: 'sec', label: '어떤 체결을 보일까' },
        { k: 'mode', t: 'sel', label: '기준', def: 'auto', opts: [['auto', '자동 (상위 0.5%)'], ['fixed', '직접 지정']] },
        { k: 'floor', t: 'num', label: '자동일 때 최소 금액 ($)', def: 30000, min: 1000, max: 5000000, step: 1000, showIf: function (c) { return c.mode === 'auto'; } },
        { k: 'fixed', t: 'num', label: '표시 기준 금액 ($)', def: 100000, min: 1000, max: 20000000, step: 10000, showIf: function (c) { return c.mode === 'fixed'; } },
        { t: 'sec', label: '어떻게 보일까' },
        { k: 'group', t: 'sel', label: '묶기', def: 'candle', opts: [['off', '개별 체결'], ['candle', '봉마다 합산 (매수·매도 각 1개)']] },
        { k: 'ttl', t: 'sel', label: '버블 유지 시간 (지나면 서서히 사라짐)', def: '900', opts: [['60', '1분'], ['300', '5분'], ['900', '15분'], ['3600', '1시간'], ['14400', '4시간'], ['0', '계속 표시']], showIf: function (c) { return c.group === 'off'; } },
        { k: 'size', t: 'range', label: '버블 크기', def: 0.8, min: 0.2, max: 2.5, step: 0.1, unit: '×' },
        { k: 'maxR', t: 'range', label: '버블 최대 크기', def: 24, min: 6, max: 40, step: 1, unit: 'px' },
        { k: 'ring', t: 'bool', label: '테두리만 표시 (속 비우기)', def: false },
        { k: 'opacity', t: 'range', label: '채우기 진하기', def: 20, min: 0, max: 90, step: 1, unit: '%', showIf: function (c) { return !c.ring; } },
        { k: 'lineA', t: 'range', label: '테두리 진하기', def: 70, min: 0, max: 100, step: 1, unit: '%' },
        { k: 'labels', t: 'bool', label: '금액 숫자 표시', def: true },
        { t: 'note', label: '초록 = 공격적 매수 체결, 빨강 = 공격적 매도 체결. 버블이 차트를 가리면 크기·진하기를 낮추거나 유지 시간을 줄이거나 "봉마다 합산"을 쓰세요.' }
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
        { k: 'gain', t: 'range', label: '민감도 (높을수록 작은 물량도 진하게)', def: 5, min: 1, max: 10, step: 1 },
        { k: 'opacity', t: 'range', label: '전체 진하기', def: 100, min: 20, max: 100, step: 1, unit: '%' },
        { k: 'extend', t: 'bool', label: '현재 호가를 좌우로 연장해 표시', sub: '쌓인 기록이 없는 구간을 현재 대기 물량으로 채웁니다', def: true },
        { k: 'legend', t: 'bool', label: '켤 때 색상 안내 잠깐 보여주기', def: true },
        { t: 'note', label: '호가창에 쌓여 있는 대기 주문 물량을 색으로 보여줍니다. 밝고 뜨거운 색일수록 대기 물량이 많아 지지·저항이 되기 쉬운 가격대입니다. 앱을 켜 둔 동안 기록이 쌓이며, 봉 주기에 맞춰 기록 간격이 자동 조절됩니다.' }
    ]
});
CF.defineSettings('bidask', {
    title: 'Bid / Ask 설정', onChange: function () { redraw(); CF.scheduleLegend(); },
    fields: [
        { t: 'sec', label: '가격 라벨' },
        { k: 'label', t: 'sel', label: '위치', def: 'axis', opts: [['axis', '가격 축'], ['left', '차트 왼쪽'], ['right', '차트 오른쪽'], ['off', '숨김']] },
        { k: 'qty', t: 'bool', label: '수량도 표시', def: false, showIf: function (c) { return c.label === 'left' || c.label === 'right'; } },
        { k: 'font', t: 'range', label: '글자 크기', def: 10, min: 8, max: 14, step: 1, unit: 'px', showIf: function (c) { return c.label === 'left' || c.label === 'right'; } },
        { k: 'textA', t: 'range', label: '글자 진하기', def: 80, min: 20, max: 100, step: 1, unit: '%', showIf: function (c) { return c.label === 'left' || c.label === 'right'; } },
        { t: 'sec', label: '선' },
        { k: 'lines', t: 'bool', label: '최우선 호가 선 표시', def: true },
        { k: 'style', t: 'sel', label: '선 모양', def: 'dotted', opts: [['solid', '실선'], ['dashed', '점선'], ['dotted', '점']], showIf: function (c) { return c.lines; } },
        { k: 'width', t: 'range', label: '선 두께', def: 1, min: 1, max: 3, step: 1, unit: 'px', showIf: function (c) { return c.lines; } },
        { k: 'lineA', t: 'range', label: '선 진하기', def: 45, min: 10, max: 100, step: 1, unit: '%', showIf: function (c) { return c.lines; } },
        { t: 'sec', label: '수치' },
        { k: 'spread', t: 'bool', label: '스프레드 · 호가 불균형 수치 (상단 수치 펼침 시)', def: true },
        { t: 'note', label: 'Binance 선물의 최우선 매수(Bid)·매도(Ask) 호가를 실시간으로 보여줍니다. "가격 축"은 캔들을 가리지 않고 축에 가격만 표시하며, 수량은 상단 수치를 펼치면 보입니다.' }
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
var OI_PERIOD = { '1m': '5m', '3m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1d': '1d', '3d': '1d', '1w': '1d', '1M': '1d' };
var PERIOD_SEC = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200, '1d': 86400 };
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
    create: function (pane, sid) {
        return { line: chart.addSeries(LW.LineSeries, Object.assign({ color: '#FFB300', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: CF.compactFormat }, sid ? { priceScaleId: sid } : {}), pane) };
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
// The pane is rebuilt over every loaded candle; in a cascade dozens of liquidations arrive per second, so they are
// folded into one rebuild every 500 ms.
function liqRefreshSoon() {
    if (liq.refT) return;
    liq.refT = setTimeout(function () { liq.refT = null; CF.refreshSub('liq'); }, 500);
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
    create: function (pane, sid) {
        var opt = Object.assign({ priceLineVisible: false, lastValueVisible: false, priceFormat: CF.compactFormat }, sid ? { priceScaleId: sid } : {});
        var o = { L: chart.addSeries(LW.HistogramSeries, opt, pane) };
        o.S = chart.addSeries(LW.HistogramSeries, Object.assign({}, opt), pane);
        return o;
    },
    setData: function (o) { var d = liqSeriesData(); o.L.setData(d.longs); o.S.setData(d.shorts); },
    legend: function (i) {
        var c = CF.candles()[i], b = c && liqBuckets()[c.time];
        return '<span style="color:' + DOWN() + '">롱청산 ' + fmtUsd(b ? b.L : 0) + '</span> <span style="color:' + UP() + '">숏청산 ' + fmtUsd(b ? b.S : 0) + '</span>';
    }
});
function liqItems(w, h, fn) {
    var cfg = CF.S('liq'), ttl = +cfg.ttl, now = Date.now() / 1000;
    for (var i = 0; i < liq.list.length; i++) {
        var e = liq.list[i];
        if (e.usd < cfg.minUsd) continue;
        var age = now - e.t; if (ttl && age > ttl) continue;                              // expired: gone
        var fade = ttl ? 1 - 0.85 * age / ttl : 1;                                         // older → fainter
        var x = CF.xOf(e.t), y = CF.yOf(e.price);
        if (x == null || y == null || x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        fn(e, x, y, clamp((3 + Math.sqrt(e.usd) / 30) * cfg.size, 2, cfg.maxR), fade, cfg);
    }
}
// bubbles behind the candles, amounts on top (outlined), like the large-trade bubbles
function paintLiq(ctx, w, h) {
    if (!liq.list.length || !CF.S('liq').bubbles) return;
    liqItems(w, h, function (e, x, y, r, fade, cfg) {
        var col = e.side === 'L' ? DOWN() : UP();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (cfg.opacity) { ctx.fillStyle = CF.hexA(col, cfg.opacity / 100 * fade); ctx.fill(); }
        if (cfg.lineA) { ctx.lineWidth = 1.5; ctx.strokeStyle = CF.hexA(col, cfg.lineA / 100 * (0.35 + 0.65 * fade)); ctx.stroke(); }
    });
}
function paintLiqLabels(ctx, w, h) {
    var c = CF.S('liq'); if (!liq.list.length || !c.bubbles || !c.labels) return;
    ctx.font = '700 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    liqItems(w, h, function (e, x, y, r, fade, cfg) {
        if (e.usd < cfg.labelMin) return;
        var t = fmtUsd(e.usd);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(11,14,17,' + (0.75 * fade).toFixed(2) + ')'; ctx.strokeText(t, x, y);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.65 * fade).toFixed(2) + ')'; ctx.fillText(t, x, y);
    });
    ctx.textAlign = 'start';
}
CF.registerFeature('liq', {
    start: function () {
        var sym = CF.symbol(), cutoff = Date.now() / 1000 - 3 * 86400;
        liq.name = sym.toLowerCase() + '@forceOrder'; liq.key = liqKey();
        liq.list = (LS.get(liq.key, []) || []).filter(function (e) { return e && e.t > cutoff; });
        var offLb = CF.layer('bottom', paintLiq), offLl = CF.layer('top', paintLiqLabels);
        liq.off = function () { offLb(); offLl(); };
        liq.fade = setInterval(function () { if (liq.list.length && +CF.S('liq').ttl) CF.redraw(); }, 4000);     // let bubbles fade out
        CF.refreshSub('liq');
        streams.market.sub(liq.name, function (d) {
            var o = d && d.o; if (!o || o.s !== sym) return;
            var price = +o.ap || +o.p, qty = +o.z || +o.q, usd = price * qty;
            if (!(usd > 0)) return;
            // a forced SELL closes a long position, a forced BUY closes a short
            liq.list.push({ t: Math.floor((o.T || Date.now()) / 1000), side: o.S === 'SELL' ? 'L' : 'S', price: price, usd: usd });
            if (liq.list.length > 600) liq.list.splice(0, liq.list.length - 600);
            liqSave(); CF.redraw(); liqRefreshSoon();
        });
    },
    stop: function () {
        streams.market.unsub(liq.name);
        if (liq.off) { liq.off(); liq.off = null; }
        clearInterval(liq.fade); liq.fade = null;
        clearTimeout(liq.refT); liq.refT = null;
        clearTimeout(liq.saveT); if (liq.list.length) LS.set(liq.key, liq.list.slice(-400));
        liq.list = [];
    }
});

// =====================================================================================================
// Large trades (aggTrade) as bubbles. Auto mode: roughly the biggest 0.5 % of recent prints.
// =====================================================================================================
var big = { list: [], recent: new Float64Array(2000), filled: 0, pos: 0, thr: 0, n: 0, off: null, name: null };
function updateThreshold() {
    var a = Array.prototype.slice.call(big.recent, 0, big.filled).sort(function (x, y) { return x - y; });
    big.thr = a[Math.floor(a.length * 0.995)] || 0;
    big.thrReady = a.length >= 50;
}
function bigLimit(cfg) { return cfg.mode === 'fixed' ? cfg.fixed : Math.max(cfg.floor, big.thr); }
// one buy and one sell bubble per candle (volume-weighted price), for a calm picture on busy markets
function groupBig(lim) {
    var key = big.list.length + '|' + lim + '|' + CF.candles().length + '|' + CF.interval();
    if (big.gKey === key) return big.gItems;
    var acc = {};
    big.list.forEach(function (e) {
        if (e.usd < lim) return;
        var t0 = candleStartOf(e.t); if (t0 == null) return;
        var k = t0 + (e.buy ? 'b' : 's'), a = acc[k] || (acc[k] = { t0: t0, buy: e.buy, usd: 0, pu: 0, n: 0 });
        a.usd += e.usd; a.pu += e.price * e.usd; a.n++;
    });
    big.gItems = Object.keys(acc).map(function (k) { var a = acc[k]; return { t: a.t0 + CF.secs() / 2, price: a.pu / a.usd, usd: a.usd, buy: a.buy, n: a.n }; });
    big.gKey = key;
    return big.gItems;
}
// Bubbles are painted behind the candles (the candle under a big print stays readable) and their amounts on top,
// outlined so they read on any background. Each bubble is one taker order (see the stream handler).
function bigItems(w, h, fn) {
    var cfg = CF.S('trades'), lim = bigLimit(cfg), grouped = cfg.group === 'candle', ttl = grouped ? 0 : +cfg.ttl, now = Date.now() / 1000;
    var items = grouped ? groupBig(lim) : big.list;
    for (var i = 0; i < items.length; i++) {
        var e = items[i];
        if (e.usd < lim) continue;
        var age = now - e.t; if (ttl && age > ttl) continue;
        var fade = ttl ? 1 - 0.8 * age / ttl : 1;
        var x = CF.xOf(e.t), y = CF.yOf(e.price);
        if (x == null || y == null || x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        fn(e, x, y, clamp((3.5 + Math.sqrt(e.usd / lim) * 5) * cfg.size, 2, cfg.maxR), fade, cfg);
    }
}
function paintBig(ctx, w, h) {
    if (!big.list.length) return;
    bigItems(w, h, function (e, x, y, r, fade, cfg) {
        var col = e.buy ? UP() : DOWN();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (!cfg.ring && cfg.opacity) { ctx.fillStyle = CF.hexA(col, cfg.opacity / 100 * fade); ctx.fill(); }
        if (cfg.lineA) { ctx.lineWidth = 1.5; ctx.strokeStyle = CF.hexA(col, cfg.lineA / 100 * (0.35 + 0.65 * fade)); ctx.stroke(); }
    });
}
function paintBigLabels(ctx, w, h) {
    if (!big.list.length || !CF.S('trades').labels) return;
    ctx.font = '700 10px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    bigItems(w, h, function (e, x, y, r, fade) {
        if (r < 9) return;
        var t = fmtUsd(e.usd);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(11,14,17,' + (0.75 * fade).toFixed(2) + ')'; ctx.strokeText(t, x, y);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.45 + 0.55 * fade).toFixed(2) + ')'; ctx.fillText(t, x, y);
    });
    ctx.textAlign = 'start';
}
CF.registerFeature('trades', {
    start: function () {
        var sym = CF.symbol();
        big.name = sym.toLowerCase() + '@aggTrade';
        big.list = []; big.filled = 0; big.pos = 0; big.n = 0; big.thr = 15000; big.thrReady = false;
        var offB = CF.layer('bottom', paintBig), offL = CF.layer('top', paintBigLabels);
        big.off = function () { offB(); offL(); };
        big.fade = setInterval(function () { var c = CF.S('trades'); if (big.list.length && c.group === 'off' && +c.ttl) CF.redraw(); }, 4000);
        // One market order that sweeps several price levels arrives as several aggTrades with the same time and side;
        // they are merged back into the order (volume-weighted price), so a bubble is the size of what someone did.
        var pend = null, pendT = 0, seeding = true, buffered = [], lastId = 0, gen = big.gen = (big.gen || 0) + 1;
        function sample(usd) {
            big.recent[big.pos] = usd; big.pos = (big.pos + 1) % big.recent.length;
            if (big.filled < big.recent.length) big.filled++;
        }
        function keep(o) {
            var cfg = CF.S('trades');
            if (o.usd < bigLimit(cfg) || (cfg.mode !== 'fixed' && !big.thrReady)) return false;
            big.list.push({ t: Math.floor(o.T / 1000), price: o.pu / o.usd, usd: o.usd, buy: o.buy });
            var ttl = +cfg.ttl, nowS = Date.now() / 1000;
            while (big.list.length && ((ttl && cfg.group === 'off' && nowS - big.list[0].t > ttl) || big.list.length > 400)) big.list.shift();
            return true;
        }
        function onOrder(o) {
            sample(o.usd);
            if (++big.n % 150 === 0 || (!big.thrReady && big.filled >= 50)) updateThreshold();
            if (keep(o)) CF.redraw();
        }
        big.flush = function () { clearTimeout(pendT); pendT = 0; if (pend) { var o = pend; pend = null; onOrder(o); } };
        function take(d) {
            if (d.a && d.a <= lastId) return;                                            // already in the history page
            var price = +d.p, usd = price * +d.q, buy = !d.m;                            // m = buyer is the maker → a sell
            if (pend && pend.T === d.T && pend.buy === buy) { pend.usd += usd; pend.pu += price * usd; return; }
            big.flush();
            pend = { T: d.T, buy: buy, usd: usd, pu: price * usd };
            pendT = setTimeout(big.flush, 150);
        }
        streams.market.sub(big.name, big.handler = function (d) {
            if (!d || d.s !== sym) return;
            if (seeding) { if (buffered.length < 5000) buffered.push(d); return; }
            take(d);
        });
        // Seed with the last 1,000 trades: the automatic threshold is known at once and the last minutes' big orders
        // show right away, instead of an empty chart until 200 orders have streamed in.
        fetch('https://fapi.binance.com/fapi/v1/aggTrades?symbol=' + encodeURIComponent(sym) + '&limit=1000')
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (rows) {
                if (gen !== big.gen || !Array.isArray(rows)) return;
                var orders = [], cur = null;
                rows.forEach(function (d) {
                    var price = +d.p, usd = price * +d.q, buy = !d.m;
                    if (cur && cur.T === d.T && cur.buy === buy) { cur.usd += usd; cur.pu += price * usd; }
                    else { cur = { T: d.T, buy: buy, usd: usd, pu: price * usd }; orders.push(cur); }
                    if (d.a > lastId) lastId = d.a;
                });
                orders.forEach(function (o) { sample(o.usd); });
                updateThreshold();
                orders.forEach(keep);
                CF.redraw();
            })
            .catch(function () { /* history is a nicety: the live stream still fills in */ })
            .then(function () {
                if (gen !== big.gen) return;
                seeding = false;
                var b = buffered; buffered = [];
                b.forEach(take);
            });
    },
    stop: function () {
        streams.market.unsub(big.name, big.handler);
        big.gen = (big.gen || 0) + 1;                                                    // a pending history page is dropped
        if (big.flush) { big.flush(); big.flush = null; }
        if (big.off) { big.off(); big.off = null; }
        clearInterval(big.fade); big.fade = null; big.gKey = null;
        big.list = []; big.filled = 0; big.pos = 0;
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
    users: 0, bids: new Map(), asks: new Map(), has: false, syncing: false, buf: [], lastU: 0, first: false, ver: 0,
    name: null, sym: null, seq: 0, pruneT: 0, snapAt: 0, best: null, fast: 0, handler: null,
    // 500 ms updates are plenty for walls and the heatmap; the DOM ladder asks for 100 ms while it is open
    streamName: function () { return this.sym.toLowerCase() + (this.fast ? '@depth@100ms' : '@depth@500ms'); },
    setFast: function (on) {
        this.fast = Math.max(0, this.fast + (on ? 1 : -1));
        if (!this.users) return;
        var want = this.streamName(); if (want === this.name) return;
        streams.pub.unsub(this.name, this.handler); this.name = want; streams.pub.sub(this.name, this.handler);
        this.resync();                                                    // another stream: its update chain starts anew
    },
    start: function () {
        if (++this.users > 1) return;
        var self = this; this.sym = CF.symbol(); this.name = this.streamName();
        this.reset();
        streams.pub.sub(this.name, this.handler = function (d) { self.onDiff(d); });
        this.snapshot();
    },
    stop: function () {
        if (this.users === 0 || --this.users > 0) return;
        streams.pub.unsub(this.name, this.handler); this.reset(); this.seq++;
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
            self.buf = []; self.syncing = false; self.has = true; self.best = null; self.ver++;
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
        this.best = null; this.ver++;
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
    var now = Date.now(); if (now - walls.t < 400 || (walls.ver === Book.ver && now - walls.t < 1500)) return;
    walls.t = now; walls.ver = Book.ver;
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
    var key = Book.ver + '|' + step + '|' + i0 + '|' + n, bins = depthView.bins;
    if (!bins || bins.key !== key) {
        var bid = new Float64Array(n), ask = new Float64Array(n), idx;
        Book.bids.forEach(function (qty, p) { idx = Math.floor(p / step) - i0; if (idx >= 0 && idx < n) bid[idx] += p * qty; });
        Book.asks.forEach(function (qty, p) { idx = Math.floor(p / step) - i0; if (idx >= 0 && idx < n) ask[idx] += p * qty; });
        // scale reference: a handful of huge orders must not flatten everything else
        var nz = [], m0 = 0;
        for (k = 0; k < n; k++) { if (bid[k] > 0) nz.push(bid[k]); if (ask[k] > 0) nz.push(ask[k]); }
        nz.sort(function (a, b) { return a - b; });
        if (nz.length) m0 = Math.min(nz[nz.length - 1], nz[Math.floor(nz.length * 0.9)] * 2.5);
        bins = depthView.bins = { key: key, bid: bid, ask: ask, mx: m0 };
    }
    var bid = bins.bid, ask = bins.ask, mx = bins.mx;
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
    start: function () { walls.map.clear(); depthView.max = 1; depthView.t = 0; depthView.bins = null; Book.start(); depthOff = CF.layer('top', paintDepth); },
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
// q: cell liquidity relative to the book's 90th-percentile cell, ×64 (0..255). Only cells well above that (real walls)
// get warm colors; the dense band right around the price no longer saturates the whole map.
function heatSpan(gain) { return 2.3 - 0.17 * gain; }
function heatPixel(q, pal, span, out, o) {
    var t = clamp((q / 64 - 0.35) / span, 0, 1);
    if (t < 0.06) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
    for (var i = 1; i < pal.length; i++) {
        if (t <= pal[i][0]) {
            var a = pal[i - 1], b = pal[i], f = (t - a[0]) / (b[0] - a[0]);
            out[o] = a[1] + (b[1] - a[1]) * f; out[o + 1] = a[2] + (b[2] - a[2]) * f; out[o + 2] = a[3] + (b[3] - a[3]) * f; out[o + 3] = (a[4] + (b[4] - a[4]) * f) * 0.72;
            return;
        }
    }
    var l = pal[pal.length - 1]; out[o] = l[1]; out[o + 1] = l[2]; out[o + 2] = l[3]; out[o + 3] = l[4] * 0.72;      // never opaque: candles stay readable
}
function heatRecolor() {
    if (!Heat.cx || !Heat.buf.length) return;
    var cfg = CF.S('heat'), pal = HEAT_PAL[cfg.palette] || HEAT_PAL.fire, span = heatSpan(cfg.gain), rows = Heat.ROWS, n = Heat.buf.length;
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
    if (!Book.has) return false;
    var mid = Book.mid(); if (!mid) return false;
    if (!Heat.cv) heatInit(mid);
    else if (mid < Heat.low + (Heat.high - Heat.low) * 0.2 || mid > Heat.high - (Heat.high - Heat.low) * 0.2) heatRecenter(mid);
    var rows = Heat.ROWS, vals = new Float64Array(rows), idx, i;
    function add(q, p) { idx = Math.floor((p - Heat.low) / Heat.step); if (idx >= 0 && idx < rows) vals[idx] += p * q; }
    Book.bids.forEach(add); Book.asks.forEach(add);
    // Colors are relative to what is normal for this book: ordinary cells stay transparent, thick resting orders heat up.
    var nz = []; for (i = 0; i < rows; i++) if (vals[i] > 0) nz.push(vals[i]);
    if (nz.length) { nz.sort(function (a, b) { return a - b; }); var ref = nz[Math.floor(nz.length * 0.9)]; Heat.med = Heat.med ? Heat.med * 0.85 + ref * 0.15 : ref; }
    var base = Math.max(Heat.med || 1, 1), col = new Uint8Array(rows);
    for (i = 0; i < rows; i++) col[i] = Math.min(255, Math.round(vals[i] / base * 64));
    var cfg = CF.S('heat'), pal = HEAT_PAL[cfg.palette] || HEAT_PAL.fire, span = heatSpan(cfg.gain), img = Heat.cx.createImageData(1, rows);
    for (var r = 0; r < rows; r++) heatPixel(col[rows - 1 - r], pal, span, img.data, r * 4);
    if (Heat.cols >= Heat.COLS) { Heat.cx.drawImage(Heat.cv, -1, 0); Heat.t0 += Heat.dt; Heat.buf.shift(); }       // scroll left by one column
    else { if (Heat.cols === 0) Heat.t0 = Date.now() / 1000; Heat.cols++; }
    Heat.buf.push(col);
    Heat.cx.putImageData(img, Heat.cols - 1, 0);
    CF.redraw();
    return true;
}
function paintHeat(ctx, w, h) {
    if (!Heat.cv || !Heat.cols) return;
    var cfg = CF.S('heat');
    var x0 = CF.xOf(Heat.t0), x1 = CF.xOf(Heat.t0 + Heat.cols * Heat.dt), y0 = CF.yOf(Heat.high), y1 = CF.yOf(Heat.low);
    if (x0 == null || x1 == null || y0 == null || y1 == null || x1 <= x0) return;
    var a = cfg.opacity / 100;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    if (cfg.extend) {                                                        // no recorded history here yet: carry the nearest column outward
        if (x0 > 0) { ctx.globalAlpha = a * 0.4; ctx.drawImage(Heat.cv, 0, 0, 1, Heat.ROWS, 0, y0, x0, y1 - y0); }
        if (x1 < w) { ctx.globalAlpha = a * 0.6; ctx.drawImage(Heat.cv, Heat.cols - 1, 0, 1, Heat.ROWS, x1, y0, w - x1, y1 - y0); }
    }
    ctx.globalAlpha = a;
    ctx.drawImage(Heat.cv, 0, 0, Heat.cols, Heat.ROWS, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    if (cfg.legend && Date.now() - Heat.startedAt < 8000) {                 // color key for a few seconds after switching on
        var pal = HEAT_PAL[cfg.palette] || HEAT_PAL.fire, gw = 64, gx = 28;      // clear of the rail's collapse handle
        var volTop = CF.ind.vol ? h * (1 - CF.S('vol').height / 100) : h, gy = Math.max(30, volTop - 22);
        var g = ctx.createLinearGradient(gx, 0, gx + gw, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        pal.forEach(function (st) { g.addColorStop(st[0], 'rgba(' + (st[1] | 0) + ',' + (st[2] | 0) + ',' + (st[3] | 0) + ',' + Math.min(1, st[4] / 255 + 0.15).toFixed(2) + ')'); });
        ctx.fillStyle = 'rgba(19,23,34,.55)'; ctx.fillRect(gx - 2, gy - 2, gw + 4, 9);
        ctx.fillStyle = g; ctx.fillRect(gx, gy, gw, 5);
        tag(ctx, '호가 대기물량  적음 → 많음', gx, gy - 8, '#9aa3b2', 'left');
    }
}
CF.registerFeature('heat', {
    byInterval: true,                                                          // sampling step follows the candle interval
    start: function () {
        Heat.dt = clamp(CF.secs() / 30, 1.5, 20);
        Book.start(); Heat.cv = null; Heat.cols = 0; Heat.buf = [];
        Heat.off = CF.layer('bottom', paintHeat);
        Heat.last = 0; Heat.startedAt = Date.now();                            // first column as soon as the book is ready, then every dt
        setTimeout(function () { CF.redraw(); }, 8100);                          // repaint once to clear the color key
        Heat.timer = setInterval(function () {
            var n = Date.now();
            if ((Heat.cols === 0 || n - Heat.last >= Heat.dt * 1000 - 100) && heatSample()) Heat.last = n;
        }, 1000);
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

// =====================================================================================================
// Bid / Ask: best bid and best ask from the public top-of-book stream (free), drawn as two thin lines with tags.
// =====================================================================================================
var ba = { bid: 0, ask: 0, bq: 0, aq: 0, off: null, name: null };
function paintBidAsk(ctx, w, h) {
    if (!ba.bid || !ba.ask) return;
    var cfg = CF.S('bidask'), inChart = cfg.label === 'left' || cfg.label === 'right';
    if (!cfg.lines && !inChart) return;
    var yb = CF.yOf(ba.bid), ya = CF.yOf(ba.ask);
    var dash = cfg.style === 'solid' ? [] : cfg.style === 'dashed' ? [6, 4] : [1.5, 3];
    var right = cfg.label === 'right', x = right ? w - 6 - (CF.ind.depth && CF.S('depth').bars ? w * CF.S('depth').barW / 100 : 0) : 6;   // clear of the depth bars
    var off = cfg.font * 0.7 + 1;
    function one(y, col, text, above) {
        if (y == null || y < -4 || y > h + 4) return;
        if (cfg.lines) {
            ctx.strokeStyle = CF.hexA(col, cfg.lineA / 100); ctx.lineWidth = cfg.width; ctx.setLineDash(dash);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
        }
        if (inChart) {
            ctx.globalAlpha = cfg.textA / 100;
            tag(ctx, text, x, y + (above ? -off : off), col, right ? 'right' : 'left', cfg.font);
            ctx.globalAlpha = 1;
        }
    }
    one(ya, DOWN(), 'Ask ' + CF.fmtPrice(ba.ask) + (cfg.qty ? '  ×' + CF.fmtVol(ba.aq) : ''), true);
    one(yb, UP(), 'Bid ' + CF.fmtPrice(ba.bid) + (cfg.qty ? '  ×' + CF.fmtVol(ba.bq) : ''), false);
}
// share of resting bid liquidity within ±0.5 % of the market (only when the order book is running for walls/heatmap)
function bookImbalance() {
    if (!Book.has) return null;
    var q = Book.quotes(); if (!q) return null;
    var lo = q.bid * 0.995, hi = q.ask * 1.005, b = 0, a = 0;
    Book.bids.forEach(function (qty, p) { if (p >= lo) b += p * qty; });
    Book.asks.forEach(function (qty, p) { if (p <= hi) a += p * qty; });
    return b + a > 0 ? b / (a + b) : null;
}
CF.registerFeature('bidask', {
    legend: function () {
        if (!ba.bid) return '';
        var cfg = CF.S('bidask'), h = '<span style="color:' + UP() + '">Bid ' + CF.fmtPrice(ba.bid) + ' ×' + CF.fmtVol(ba.bq) + '</span> <span style="color:' + DOWN() + '">Ask ' + CF.fmtPrice(ba.ask) + ' ×' + CF.fmtVol(ba.aq) + '</span>';
        if (cfg.spread) {
            h += ' <span style="color:#B2B5BE">스프레드 ' + CF.fmtPrice(ba.ask - ba.bid) + '</span>';
            var im = bookImbalance();
            if (im != null) h += ' <span style="color:' + (im >= 0.5 ? UP() : DOWN()) + '">호가 ' + (im >= 0.5 ? '매수' : '매도') + ' 우세 ' + Math.round(Math.max(im, 1 - im) * 100) + '%</span>';
        }
        return h;
    },
    start: function () {
        var sym = CF.symbol();
        ba.name = sym.toLowerCase() + '@depth5@500ms'; ba.bid = ba.ask = 0;
        ba.off = CF.layer('top', paintBidAsk);
        // "price axis": the two prices as labels on the axis, like TradingView's bid / ask labels
        ba.axOff = CF.axisLabels(function () {
            if (!ba.bid || CF.S('bidask').label !== 'axis') return [];
            // the spread is usually one tick: the labels stack above and below the last-price label instead of hiding under it
            var H = 19, ya = CF.yOf(ba.ask), yb = CF.yOf(ba.bid), yl = CF.yOf(lastPrice());
            if (ya == null || yb == null) return [];
            if (yl != null) { ya = Math.min(ya, yl - H); yb = Math.max(yb, yl + H); }
            else if (yb - ya < H) { var mid = (ya + yb) / 2; ya = mid - H / 2; yb = mid + H / 2; }
            return [{ y: ya, text: CF.fmtPrice(ba.ask), bg: DOWN() }, { y: yb, text: CF.fmtPrice(ba.bid), bg: UP() }];
        });
        streams.pub.sub(ba.name, function (d) {
            if (!d || d.s !== sym || !d.b || !d.a || !d.b.length || !d.a.length) return;
            ba.bid = +d.b[0][0]; ba.bq = +d.b[0][1]; ba.ask = +d.a[0][0]; ba.aq = +d.a[0][1];
            CF.redraw(); CF.scheduleLegend();
        });
    },
    stop: function () {
        streams.pub.unsub(ba.name);
        if (ba.off) { ba.off(); ba.off = null; }
        if (ba.axOff) { ba.axOff(); ba.axOff = null; }
        ba.bid = ba.ask = 0;
    }
});


// =====================================================================================================
// Funding rate: past fundings per candle and the predicted next one (Binance USD-M)
// =====================================================================================================
CF.defineSettings('fund', {
    title: '펀딩비 설정', onChange: function () { CF.styleSubs(); CF.refreshSub('fund'); },
    fields: [
        { k: 'pred', t: 'bool', label: '예상 펀딩비 선', sub: '다음 정산에 적용될 예상 펀딩비를 점선으로', def: true },
        { k: 'annual', t: 'bool', label: '수치에 연환산 함께 표시', def: true },
        { t: 'note', label: '양수면 롱이 숏에게, 음수면 숏이 롱에게 지급합니다. 크게 양수일수록 롱 쏠림(과열)입니다. 일봉 이상에서는 그 봉 안의 펀딩을 더해 보여줍니다.' }
    ]
});
var fund = { list: [], pred: null, next: 0, hours: 8, timer: 0, seq: 0 };
function fundPoints() {
    var m = {}, keys = [];
    fund.list.forEach(function (f) {
        var t = candleStartOf(f.t); if (t == null) return;
        if (m[t] == null) { m[t] = 0; keys.push(t); }
        m[t] += f.r;
    });
    return keys.sort(function (a, b) { return a - b; }).map(function (t) { var v = m[t] * 100; return { time: t, value: v, color: CF.hexA(v >= 0 ? UP() : DOWN(), 0.75) }; });
}
function fundLoad() {
    var sym = CF.symbol(), seq = ++fund.seq;
    getJson(FAPI + '/fapi/v1/fundingRate?symbol=' + sym + '&limit=1000').then(function (rows) {
        if (seq !== fund.seq || !Array.isArray(rows)) return;
        fund.list = rows.map(function (r) { return { t: Math.floor(r.fundingTime / 1000), r: +r.fundingRate }; });
        var n = fund.list.length; if (n > 1) fund.hours = Math.max(1, Math.round((fund.list[n - 1].t - fund.list[n - 2].t) / 3600));
        CF.refreshSub('fund');
    }).catch(function () { CF.toast('펀딩비 기록을 불러오지 못했어요'); });
    fundPred();
}
function fundPred() {
    var sym = CF.symbol(), seq = fund.seq;
    getJson(FAPI + '/fapi/v1/premiumIndex?symbol=' + sym).then(function (r) {
        if (seq !== fund.seq) return;
        var was = fund.next;
        fund.pred = +r.lastFundingRate; fund.next = +r.nextFundingTime;
        if (was && fund.next !== was) fundLoad();                       // a funding was settled: take it into the history
        var o = CF.subSeries('fund'); if (o) CF.styleSubs();
        CF.scheduleLegend();
    }).catch(function () { /* next poll */ });
}
function fmtRate(v) { return (v >= 0 ? '+' : '') + v.toFixed(4) + '%'; }
CF.registerSub('fund', {
    name: '펀딩비', color: function () { return '#F0B90B'; },
    create: function (pane, sid) {
        var pf = { type: 'custom', minMove: 0.0001, formatter: function (v) { return v.toFixed(4) + '%'; } };
        return { bars: chart.addSeries(LW.HistogramSeries, Object.assign({ priceLineVisible: false, lastValueVisible: false, priceFormat: pf }, sid ? { priceScaleId: sid } : {}), pane), pl: [] };
    },
    style: function (o) {
        o.pl.forEach(function (l) { try { o.bars.removePriceLine(l); } catch (e) { /* gone */ } }); o.pl = [];
        o.pl.push(o.bars.createPriceLine({ price: 0, color: 'rgba(132,142,156,.4)', lineWidth: 1, lineStyle: 1, axisLabelVisible: false }));
        if (CF.S('fund').pred && fund.pred != null) o.pl.push(o.bars.createPriceLine({ price: fund.pred * 100, color: '#F0B90B', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '예상' }));
    },
    setData: function (o) { o.bars.setData(fundPoints()); },
    legend: function (i) {
        var c = CF.candles()[i]; if (!c) return '';
        var p = fundPoints().filter(function (x) { return x.time === c.time; })[0], ann = CF.S('fund').annual, per = 24 / fund.hours * 365;
        var h = '<span style="color:#F0B90B">펀딩</span> ' + (p ? '<span class="' + (p.value >= 0 ? 'up' : 'down') + '">' + fmtRate(p.value) + '</span>' : '<span style="color:#848E9C">정산 없음</span>');
        if (fund.pred != null && i === CF.candles().length - 1) {
            var left = Math.max(0, fund.next - Date.now()), hh = Math.floor(left / 3600000), mm = Math.floor(left % 3600000 / 60000);
            h += ' <span style="color:#B2B5BE">예상 ' + fmtRate(fund.pred * 100) + (ann ? ' (연 ' + (fund.pred * 100 * per).toFixed(1) + '%)' : '') + ' · ' + hh + '시간 ' + mm + '분 후</span>';
        }
        return h;
    }
});
CF.registerFeature('fund', {
    start: function () { fundLoad(); fund.timer = setInterval(fundPred, 30000); },
    stop: function () { fund.seq++; clearInterval(fund.timer); fund.timer = 0; fund.list = []; fund.pred = null; fund.next = 0; }
});

// =====================================================================================================
// Long / short ratios: all accounts, top traders' positions, takers' buy / sell volume (Binance, last 30 days)
// =====================================================================================================
CF.defineSettings('lsr', {
    title: '롱 · 숏 비율 설정', onChange: function () { CF.styleSubs(); CF.refreshSub('lsr'); },
    fields: [
        { k: 'acc', t: 'bool', label: '전체 계정 롱숏 비율', def: true },
        { k: 'top', t: 'bool', label: '상위 트레이더 포지션 롱숏 비율', def: true },
        { k: 'taker', t: 'bool', label: '시장가 매수 / 매도 체결 비율', def: false },
        { t: 'note', label: '1보다 크면 롱이 많습니다. 전체 계정은 개인 쏠림, 상위 트레이더는 큰 계정의 포지션 방향을 봅니다. 바이낸스가 최근 30일만 제공하며 5분 단위가 가장 짧습니다.' }
    ]
});
var lsr = { acc: [], top: [], taker: [], period: '1h', timer: 0, seq: 0 };
function lsrPoints(list) {
    var out = [], lastT = null;
    list.forEach(function (p) { var t = candleStartOf(p.t); if (t == null) return; if (t === lastT) out[out.length - 1].value = p.v; else { out.push({ time: t, value: p.v }); lastT = t; } });
    return out;
}
function lsrLoad() {
    var sym = CF.symbol(), seq = ++lsr.seq, per = lsr.period = OI_PERIOD[CF.interval()] || '1h';
    function get(path, key, field) {
        return getJson(FAPI + '/futures/data/' + path + '?symbol=' + sym + '&period=' + per + '&limit=500').then(function (rows) {
            if (seq !== lsr.seq || !Array.isArray(rows)) return;
            lsr[key] = rows.map(function (r) { return { t: Math.floor(r.timestamp / 1000), v: +r[field], long: +r.longAccount || +r.longPosition || 0 }; }).sort(function (a, b) { return a.t - b.t; });
        }).catch(function () { /* that line stays empty */ });
    }
    Promise.all([get('globalLongShortAccountRatio', 'acc', 'longShortRatio'), get('topLongShortPositionRatio', 'top', 'longShortRatio'), get('takerlongshortRatio', 'taker', 'buySellRatio')])
        .then(function () { if (seq === lsr.seq) CF.refreshSub('lsr'); });
}
function lsrAt(list, t) { for (var i = list.length - 1; i >= 0; i--) if (list[i].t <= t + CF.secs() - 1) return list[i]; return null; }
CF.registerSub('lsr', {
    name: '롱숏 비율', color: function () { return '#F0B90B'; },
    create: function (pane, sid) {
        var opt = function (c) { return Object.assign({ color: c, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, sid ? { priceScaleId: sid } : {}); };
        var o = { acc: chart.addSeries(LW.LineSeries, opt('#F0B90B'), pane), top: chart.addSeries(LW.LineSeries, opt('#E040FB'), pane), taker: chart.addSeries(LW.LineSeries, opt('#00BCD4'), pane), pl: [] };
        o.pl.push(o.acc.createPriceLine({ price: 1, color: 'rgba(132,142,156,.45)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
        return o;
    },
    style: function (o) { var c = CF.S('lsr'); o.acc.applyOptions({ visible: c.acc }); o.top.applyOptions({ visible: c.top }); o.taker.applyOptions({ visible: c.taker, lineWidth: 1 }); },
    setData: function (o) { o.acc.setData(lsrPoints(lsr.acc)); o.top.setData(lsrPoints(lsr.top)); o.taker.setData(lsrPoints(lsr.taker)); },
    legend: function (i) {
        var c = CF.candles()[i], cfg = CF.S('lsr'); if (!c) return '';
        var a = lsrAt(lsr.acc, c.time), t = lsrAt(lsr.top, c.time), k = lsrAt(lsr.taker, c.time), out = [];
        if (cfg.acc && a) out.push('<span style="color:#F0B90B">롱숏 ' + a.v.toFixed(2) + (a.long ? ' (롱 ' + (a.long * 100).toFixed(1) + '%)' : '') + '</span>');
        if (cfg.top && t) out.push('<span style="color:#E040FB">상위 ' + t.v.toFixed(2) + '</span>');
        if (cfg.taker && k) out.push('<span style="color:#00BCD4">테이커 ' + k.v.toFixed(2) + '</span>');
        return out.join(' ') || '<span style="color:#848E9C">롱숏 비율 (최근 30일만)</span>';
    }
});
CF.registerFeature('lsr', {
    byInterval: true,
    start: function () { lsrLoad(); lsr.timer = setInterval(lsrLoad, 5 * 60000); },
    stop: function () { lsr.seq++; clearInterval(lsr.timer); lsr.timer = 0; lsr.acc = []; lsr.top = []; lsr.taker = []; }
});

// =====================================================================================================
// Bitfinex margin longs / shorts: the size of all margin positions in the coin (Bitfinex stats1 pos.size, 1 minute).
// Bitfinex is where a lot of big BTC holders and arbitrage desks leverage, so its long / short build-ups are watched as
// a whale gauge. Its REST API sends no CORS headers: the app fetches it (AndroidBridge.bfxGet).
// =====================================================================================================
CF.defineSettings('bfx', {
    title: '비트파이넥스 롱 · 숏 설정', onChange: function () { CF.styleSubs(); CF.refreshSub('bfx'); },
    help: '비트파이넥스 마진 거래에서 열려 있는 롱 · 숏 포지션의 총 수량(코인 단위)입니다.\n\n' +
        '왜 보나: 비트파이넥스는 큰 보유자(고래)와 차익거래 업체가 많이 쓰는 거래소라, 이 수치가 "큰손의 방향"으로 자주 인용됩니다. 롱이 99% 이상이라 롱숏 "비율"은 거의 늘 100%에 붙어 있어서, 비율보다 수량의 변화를 봅니다.\n\n' +
        '읽는 법\n• 롱이 빠르게 늘며 가격이 오름: 고래가 추세에 올라타는 중. 다만 급증은 과열 신호이기도 합니다.\n• 롱이 급감: 롱 청산 · 이익 실현. 가격이 버티면 매수세 약화, 떨어지면 하락 가속의 흔적입니다.\n• 숏이 급증(원래 매우 적음): 큰 하락 베팅 또는 헤지. 가격이 오르면 숏 스퀴즈 연료가 됩니다.\n• 숏이 급감하며 가격 급등: 숏 커버링(숏 스퀴즈)입니다.\n\n' +
        '주의: 비트파이넥스 한 곳의 데이터이고 헤지 · 차익 포지션이 섞여 있어 단독 매매 신호는 아닙니다. 가격 · OI · 펀딩비와 함께 보세요. 1분 단위 자료를 봉에 맞춰 보여주며, 시간봉이 길면 오래된 구간은 비어 있을 수 있습니다(요청 한도). USD 마진 시장이 있는 코인만 나옵니다.',
    fields: [
        { k: 'mode', t: 'sel', label: '표시', def: 'delta', opts: [['pos', '포지션 수량'], ['delta', 'N봉 변화량']] },
        { k: 'span', t: 'sel', label: '변화량 기준 (봉 수)', def: '24', opts: [['6', '6'], ['12', '12'], ['24', '24'], ['48', '48']] },
        { k: 'long', t: 'bool', label: '롱 표시', def: true },
        { k: 'cLong', t: 'color', label: '롱 색', def: '#0ECB81', showIf: function (c) { return c.long; } },
        { k: 'short', t: 'bool', label: '숏 표시', sub: '숏은 롱보다 훨씬 작아서 따로 눈금(숨김)을 씁니다', def: true },
        { k: 'cShort', t: 'color', label: '숏 색', def: '#F6465D', showIf: function (c) { return c.short; } },
        { t: 'note', label: '단위는 코인 수량입니다. 비트파이넥스 마진 시장이 없는 코인은 비어 있습니다. 변화량 기준은 "N봉 변화량"일 때와 상단 수치의 % 변화에 쓰입니다.' }
    ]
});
var bfx = { long: {}, short: {}, seq: 0, timer: 0, n: 0, cb: {}, state: 'idle' };
window.__bfxDone = function (id, text) {
    var c = bfx.cb[id]; if (!c) return;
    delete bfx.cb[id]; clearTimeout(c.t);
    try { c.res(JSON.parse(text)); } catch (e) { c.rej(new Error('bad answer')); }
};
function bfxFetch(path) {
    return new Promise(function (res, rej) {
        var B = window.AndroidBridge, id = 'b' + (++bfx.n);
        bfx.cb[id] = { res: res, rej: rej, t: setTimeout(function () { delete bfx.cb[id]; rej(new Error('timeout')); }, 25000) };
        if (B && typeof B.bfxGet === 'function') { try { B.bfxGet(id + '|' + path); } catch (e) { rej(e); } }
        else getJson('https://api-pub.bitfinex.com' + path).then(res, rej);        // a desktop browser may block this (no CORS)
    });
}
function bfxSym() {
    var b = CF.symbol().replace(/USDT$|USDC$/, '').replace(/^1000+/, '');
    return /^[A-Z0-9]{2,12}$/.test(b) ? 't' + b + (b.length > 3 ? ':USD' : 'USD') : null;
}
function bfxPath(sym, side, q) { return '/v2/stats1/pos.size:1m:' + sym + ':' + side + '/hist?' + q; }
// all the history the loaded candles need, 10,000 minutes a request, newest first (a few pages at most)
function bfxLoad() {
    var sym = bfxSym(), seq = ++bfx.seq, cs = CF.candles();
    if (!sym || !cs.length) { bfx.state = 'none'; CF.scheduleLegend(); return; }
    bfx.state = 'loading';
    var t0 = cs[0].time * 1000, MAX_PAGES = 6;
    function side(name) {
        var map = {}, end = Date.now() + 60000, page = 0;
        function next() {
            return bfxFetch(bfxPath(sym, name, 'limit=10000&end=' + end)).then(function (rows) {
                if (seq !== bfx.seq || !Array.isArray(rows) || !rows.length) return map;
                rows.forEach(function (r) { var t = candleStartOf(Math.floor(r[0] / 1000)); if (t != null && map[t] == null) map[t] = +r[1]; });
                var oldest = rows[rows.length - 1][0]; page++;
                if (rows.length >= 10000 && oldest > t0 && page < MAX_PAGES) { end = oldest - 1; return next(); }
                return map;
            });
        }
        return next().catch(function () { return map; });
    }
    Promise.all([side('long'), side('short')]).then(function (m) {
        if (seq !== bfx.seq) return;
        bfx.long = m[0]; bfx.short = m[1];
        bfx.state = Object.keys(m[0]).length ? 'ok' : 'none';
        if (bfx.state === 'none') CF.toast('비트파이넥스에 이 코인의 마진 롱 · 숏 자료가 없어요');
        CF.refreshSub('bfx');
    });
}
// the newest minutes, every minute
function bfxPoll() {
    var sym = bfxSym(), seq = bfx.seq; if (!sym || bfx.state !== 'ok') return;
    ['long', 'short'].forEach(function (name) {
        bfxFetch(bfxPath(sym, name, 'limit=3')).then(function (rows) {
            if (seq !== bfx.seq || !Array.isArray(rows) || !rows.length) return;
            var t = candleStartOf(Math.floor(rows[0][0] / 1000)); if (t == null) return;
            bfx[name][t] = +rows[0][1]; CF.refreshSub('bfx');
        }).catch(function () { /* next minute */ });
    });
}
// one value per loaded candle (a position stays open until it changes, so gaps carry the last value forward)
function bfxArr(name) {
    var cs = CF.candles(), m = bfx[name], out = new Array(cs.length), last = null;
    for (var i = 0; i < cs.length; i++) { if (m[cs[i].time] != null) last = m[cs[i].time]; out[i] = last; }
    return out;
}
function bfxSeriesData(name) {
    var cs = CF.candles(), a = bfxArr(name), cfg = CF.S('bfx'), span = +cfg.span || 24, out = [];
    for (var i = 0; i < cs.length; i++) {
        if (a[i] == null) continue;
        if (cfg.mode === 'delta') { if (i >= span && a[i - span] != null) out.push({ time: cs[i].time, value: a[i] - a[i - span] }); }
        else out.push({ time: cs[i].time, value: a[i] });
    }
    return out;
}
function fmtBfx(v) {
    var a = Math.abs(v), sgn = CF.S('bfx').mode === 'delta' && v > 0 ? '+' : '';
    if (a >= 1e6) return sgn + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return sgn + (v / 1e3).toFixed(1) + 'K';
    return sgn + v.toFixed(a >= 100 ? 0 : 2);
}
CF.registerSub('bfx', {
    name: 'BFX 롱숏', color: function () { return CF.S('bfx').cLong; },
    create: function (pane, sid) {
        var pf = { type: 'custom', minMove: 0.01, formatter: fmtBfx };
        var opt = function (c, id) { return Object.assign({ color: c, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf }, id ? { priceScaleId: id } : {}); };
        var o = { lng: chart.addSeries(LW.LineSeries, Object.assign(opt('#0ECB81', sid), { lastValueVisible: true }), pane),
                  sht: chart.addSeries(LW.LineSeries, opt('#F6465D', sid ? sid + 's' : 'bfxs'), pane), pl: [] };
        try { o.sht.priceScale().applyOptions({ visible: false, scaleMargins: { top: 0.12, bottom: 0.1 } }); } catch (e) { /* ignore */ }
        return o;
    },
    style: function (o) {
        var c = CF.S('bfx');
        o.lng.applyOptions({ visible: c.long, color: c.cLong }); o.sht.applyOptions({ visible: c.short, color: c.cShort });
        o.pl.forEach(function (l) { try { o.lng.removePriceLine(l); } catch (e) { /* gone */ } }); o.pl = [];
        if (c.mode === 'delta') o.pl.push(o.lng.createPriceLine({ price: 0, color: 'rgba(132,142,156,.45)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
    },
    setData: function (o) { o.lng.setData(bfxSeriesData('long')); o.sht.setData(bfxSeriesData('short')); },
    legend: function (i) {
        var cs = CF.candles(), c = cs[i], cfg = CF.S('bfx'); if (!c) return '';
        if (bfx.state === 'none') return '<span style="color:#848E9C">BFX 롱숏 · 이 코인은 비트파이넥스 마진 자료가 없어요</span>';
        if (bfx.state !== 'ok') return '<span style="color:#848E9C">BFX 롱숏 · 불러오는 중…</span>';
        var la = bfxArr('long'), sa = bfxArr('short'), l = la[i], sh = sa[i], base = CF.symbol().replace(/USDT$|USDC$/, ''), out = [];
        if (l == null && sh == null) return '<span style="color:#848E9C">BFX 롱숏 · 이 구간은 자료가 없어요</span>';
        var span = +cfg.span || 24, pl = i >= span ? la[i - span] : null, ps = i >= span ? sa[i - span] : null;
        function fmtV(v) { var a = Math.abs(v); return (a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(1)) + ' ' + base; }
        function part(v, prev, color, name) {
            if (v == null) return '';
            var h = '<span style="color:' + color + '">' + name + ' ' + fmtV(v) + '</span>';
            if (prev != null && prev > 0) { var p = (v - prev) / prev * 100; h += ' <span class="' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '+' : '') + p.toFixed(1) + '%/' + span + '봉</span>'; }
            return h;
        }
        if (cfg.long) out.push(part(l, pl, cfg.cLong, 'BFX 롱'));
        if (cfg.short) out.push(part(sh, ps, cfg.cShort, '숏'));
        return out.join(' ');
    }
});
CF.registerFeature('bfx', {
    byInterval: true,
    start: function () { bfxLoad(); bfx.timer = setInterval(bfxPoll, 60000); },
    stop: function () { bfx.seq++; clearInterval(bfx.timer); bfx.timer = 0; bfx.long = {}; bfx.short = {}; bfx.state = 'idle'; }
});

window.__flow = { modelLiq: modelLiq, Book: Book, Heat: Heat, oi: oi, liq: liq, big: big, lmap: lmap, walls: walls, fmtUsd: fmtUsd };
})();
