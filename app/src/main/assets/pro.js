// What the paid order-flow terminals add on top of a chart, from public data only:
//  1. CVD by order size ("whale CVD"): the cumulative delta of market orders split by how big the order was, so it shows
//     whether the large orders and the small ones are on the same side. Built on the trade engine in orderflow.js.
//  2. Market briefing: price x open interest x CVD (perp and spot) x funding x positioning x liquidity, read by fixed rules
//     into a few sentences. It describes what happened; it does not predict.
(function () {
'use strict';
var CF = window.CF, FL = window.__flow, OF = window.__of;
if (!CF || !FL || !OF) return;
var chart = CF.chart, LW = CF.LW;
var FAPI = 'https://fapi.binance.com';
function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function fmtS(v) { return (v < 0 ? '-' : '+') + CF.fmtVol(Math.abs(v)); }
function fmtUsdS(v) { return (v < 0 ? '-$' : '+$') + CF.fmtVol(Math.abs(v)); }
function pctS(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%'; }
function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }

// =====================================================================================================
// 1. CVD by order size
// =====================================================================================================
var CLS = [
    { k: 'c0', tag: '~1K', name: '$1천 미만 (소액)', color: '#787B86', def: false },
    { k: 'c1', tag: '1K', name: '$1천 ~ 1만', color: '#4CAF50', def: true },
    { k: 'c2', tag: '10K', name: '$1만 ~ 10만', color: '#F0B90B', def: true },
    { k: 'c3', tag: '100K', name: '$10만 ~ 100만 (고래)', color: '#B388FF', def: true },
    { k: 'c4', tag: '1M+', name: '$100만 이상 (초대형)', color: '#FF7043', def: true }
];
var MAIN = 3;                                      // the class on the pane's own axis when every line has its own scale
CF.defineSettings('whale', {
    title: '주문 크기별 CVD 설정', onChange: function () { CF.styleSubs(); CF.refreshSub('whale'); },
    fields: [
        { t: 'sec', label: '보일 주문 크기' }
    ].concat(CLS.slice().reverse().map(function (c) { return { k: c.k, t: 'bool', label: c.name, def: c.def }; })).concat([
        { t: 'sec', label: '표시' },
        { k: 'axis', t: 'sel', label: '세로축', def: 'own', opts: [['own', '선마다 자기 범위 (모양 비교)'], ['shared', '같은 축 (금액 비교)']] },
        { k: 'width', t: 'range', label: '선 두께', def: 2, min: 1, max: 4, step: 1, unit: 'px' },
        { t: 'note', label: '시장가 주문을 금액 크기로 나눠, 크기별로 (매수 − 매도)를 누적한 선입니다. 한 번에 여러 호가를 긁은 주문은 하나로 합쳐서 크기를 잽니다.\n읽는 법: 큰 주문 선은 오르는데 작은 주문 선이 내리면 큰손이 사고 개미가 파는 중, 반대면 큰손이 넘기는 중입니다. 가격이 새 저점인데 큰 주문 선이 저점을 높이면 큰손의 매수 흡수로 봅니다.\n"선마다 자기 범위"는 선의 모양(방향 · 다이버전스)을 비교하기 좋고, 금액 크기를 비교하려면 "같은 축"으로 바꾸세요.' },
        { t: 'note', label: '바이낸스 선물 체결만 씁니다. 과거 체결은 켠 뒤 최근 몇 시간치(풋프린트 설정의 "불러올 과거", 기본 4시간)를 받아 오고 그 뒤로는 켜 둔 동안 쌓입니다(폰에 48시간 보관). 그래서 1분~15분봉에서 보는 지표이고, 4시간봉 · 일봉에서는 봉이 한두 개뿐이라 의미가 없습니다.' }
    ])
});
var wh = { key: '', rows: [], byTime: {}, timer: 0, ver: -1 };
function candleEnd(cs, i) { return i + 1 < cs.length ? cs[i + 1].time : CF.nextOpen(cs[i].time); }
// per candle, from the newest back to the oldest one the engine holds (nearly) completely: the running delta of each class
function whRows() {
    var cs = CF.candles(), n = cs.length, E = OF.E;
    var key = (E.szVer || 0) + '|' + n + '|' + (n ? cs[n - 1].time : 0) + '|' + CF.interval() + '|' + E.gen + '|' + E.cov.length;
    if (wh.key === key) return wh.rows;
    var from = Math.floor(Date.now() / 1000) - (OF.histHours() + 1) * 3600 - CF.secs(), start = n, i, k;
    for (i = n - 1; i >= 0 && cs[i].time >= from; i--) {
        if (OF.coverOf(cs[i].time * 1000, candleEnd(cs, i) * 1000) < 0.9) break;
        start = i;
    }
    var cum = [0, 0, 0, 0, 0], rows = [], byTime = {};
    for (i = start; i < n; i++) {
        var s = OF.sizes(cs[i].time, candleEnd(cs, i)), d = [0, 0, 0, 0, 0];
        if (s) for (k = 0; k < 5; k++) { d[k] = s[2 * k] - s[2 * k + 1]; cum[k] += d[k]; }
        var row = { time: cs[i].time, cum: cum.slice(), d: d };
        rows.push(row); byTime[row.time] = row;
    }
    wh.key = key; wh.rows = rows; wh.byTime = byTime;
    return rows;
}
function whScaleId(sid, k, own) { return own && k !== MAIN ? (sid || 'wh') + '_' + k : (sid || 'right'); }
CF.registerSub('whale', {
    name: '크기별 CVD',
    color: function () { return CLS[MAIN].color; },
    create: function (pane, sid) {
        var o = { sid: sid || '' }, own = CF.S('whale').axis === 'own';
        CLS.forEach(function (c, k) {
            o['l' + k] = chart.addSeries(LW.LineSeries, { color: c.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
                priceFormat: CF.compactFormat, priceScaleId: whScaleId(sid, k, own) }, pane);
        });
        return o;
    },
    style: function (o) {
        var cfg = CF.S('whale'), own = cfg.axis === 'own';
        CLS.forEach(function (c, k) {
            var se = o['l' + k], id = whScaleId(o.sid, k, own);
            se.applyOptions({ visible: !!cfg[c.k], lineWidth: cfg.width, priceScaleId: id, lastValueVisible: !own || k === MAIN });
            if (id !== 'right' && id !== o.sid) { try { se.priceScale().applyOptions({ visible: false, scaleMargins: { top: 0.14, bottom: 0.1 } }); } catch (e) { /* older engine */ } }
        });
    },
    setData: function (o) {
        var rows = whRows(), cfg = CF.S('whale');
        CLS.forEach(function (c, k) { o['l' + k].setData(cfg[c.k] ? rows.map(function (r) { return { time: r.time, value: r.cum[k] }; }) : []); });
    },
    legend: function (i, c, open) {
        var cfg = CF.S('whale'), bf = OF.E.bf, row = c && wh.byTime[c.time];
        var h = '<span style="color:#848E9C">크기별 CVD</span>';
        if (row) {
            for (var k = CLS.length - 1; k >= 0; k--) if (cfg[CLS[k].k]) h += ' <span style="color:' + CLS[k].color + '">' + CLS[k].tag + ' ' + fmtS(row.cum[k]) + '</span>';
        } else if (!wh.rows.length) h += ' <span style="color:#848E9C">' + (bf.total ? '체결 불러오는 중 ' + Math.floor(bf.done / bf.total * 100) + '%' : CF.secs() > 3600 ? '1분~15분봉에서 보세요' : '체결 모으는 중') + '</span>';
        if (open) {
            var span = wh.rows.length ? (Date.now() / 1000 - wh.rows[0].time) / 3600 : 0;
            h += ' <span style="color:#848E9C">· 최근 ' + (span >= 1 ? span.toFixed(1) + '시간' : Math.round(span * 60) + '분') + (bf.total ? ' · 과거 채우는 중 ' + Math.floor(bf.done / bf.total * 100) + '%' : '') + ' · 시장가 주문 금액별 누적 (매수 − 매도)</span>';
        }
        return h;
    }
});
CF.registerFeature('whale', {
    start: function () {
        OF.use(true);
        wh.key = ''; wh.ver = -1;
        // trades arrive many times a second: the lines are rebuilt at most every 2 s, and only when something came in
        wh.timer = setInterval(function () {
            var v = (OF.E.szVer || 0) + OF.E.cov.length * 1e9;
            if (v === wh.ver || document.hidden) return;
            wh.ver = v; CF.refreshSub('whale');
        }, 2000);
    },
    stop: function () { clearInterval(wh.timer); wh.timer = 0; wh.key = ''; wh.rows = []; wh.byTime = {}; OF.release(true); }
});
// net dollars of the big (>= $100K) and the small (< $10K) orders over the last `sec` seconds, or null without data
function sizeFlow(sec) {
    if (!OF.E.users || OF.E.sym !== CF.symbol()) return null;
    var now = Math.floor(Date.now() / 1000), s = OF.sizes(now - sec, now + 60);
    if (!s || OF.coverOf((now - sec) * 1000, now * 1000) < 0.8) return null;
    return { big: s[6] - s[7] + s[8] - s[9], small: s[0] - s[1] + s[2] - s[3], mid: s[4] - s[5] };
}

// =====================================================================================================
// 2. Market briefing
// =====================================================================================================
function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
function soft(p) { return p.catch(function () { return null; }); }
function spotSymbol(sym) { var m = /^(1000000|10000|1000|100|1M)?([A-Z0-9]+?)USDT$/.exec(sym); return m ? m[2] + 'USDT' : null; }
function rsi(close, len) {
    var g = 0, l = 0, out = null;
    for (var i = 1; i < close.length; i++) {
        var ch = close[i] - close[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
        if (i <= len) { g += up; l += dn; if (i === len) { g /= len; l /= len; } }
        else { g = (g * (len - 1) + up) / len; l = (l * (len - 1) + dn) / len; }
        if (i >= len) out = l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l);
    }
    return out;
}
var WIN = [[1, '1시간'], [4, '4시간'], [24, '24시간']];
// everything the briefing reads, as numbers (kept apart from the wording so it can be checked on its own)
function briefData(sym) {
    var spot = spotSymbol(sym);
    return Promise.all([
        getJson(FAPI + '/fapi/v1/klines?symbol=' + sym + '&interval=5m&limit=289'),
        soft(getJson(FAPI + '/futures/data/openInterestHist?symbol=' + sym + '&period=5m&limit=289')),
        soft(getJson(FAPI + '/fapi/v1/premiumIndex?symbol=' + sym)),
        soft(getJson(FAPI + '/futures/data/globalLongShortAccountRatio?symbol=' + sym + '&period=5m&limit=1')),
        soft(getJson(FAPI + '/futures/data/topLongShortPositionRatio?symbol=' + sym + '&period=5m&limit=1')),
        spot ? soft(getJson('https://api.binance.com/api/v3/klines?symbol=' + spot + '&interval=5m&limit=289')) : Promise.resolve(null)
    ]).then(function (r) {
        var k = r[0], oi = r[1], prem = r[2], lsA = r[3], lsT = r[4], sk = r[5];
        if (!Array.isArray(k) || k.length < 30) throw new Error('no candles');
        var n = k.length, last = +k[n - 1][4], d = { sym: sym, price: last, at: Date.now(), win: [] };
        function delta(rows, bars) { var s = 0; for (var i = Math.max(0, rows.length - bars); i < rows.length; i++) s += 2 * +rows[i][10] - +rows[i][7]; return s; }
        function quote(rows, bars) { var s = 0; for (var i = Math.max(0, rows.length - bars); i < rows.length; i++) s += +rows[i][7]; return s; }
        var oiOk = Array.isArray(oi) && oi.length > 12, skOk = Array.isArray(sk) && sk.length > 12;
        WIN.forEach(function (w) {
            var bars = w[0] * 12, ref = k[Math.max(0, n - 1 - bars)], o = { h: w[0], label: w[1] };
            o.price = (last / +ref[4] - 1) * 100;
            o.cvd = delta(k, bars);
            o.vol = quote(k, bars);
            o.spot = skOk ? delta(sk, bars) : null;
            if (oiOk) {
                var a = +oi[oi.length - 1].sumOpenInterest, b = +oi[Math.max(0, oi.length - 1 - bars)].sumOpenInterest;
                o.oi = b > 0 ? (a / b - 1) * 100 : null;
            } else o.oi = null;
            d.win.push(o);
        });
        d.oiUsd = oiOk ? +oi[oi.length - 1].sumOpenInterestValue : null;
        d.rvol = d.win[2].vol > 0 ? d.win[0].vol / (d.win[2].vol / 24) : null;          // the last hour against the day's hourly average
        if (prem) { d.fund = +prem.lastFundingRate * 100; d.fundNext = +prem.nextFundingTime; d.basis = +prem.indexPrice > 0 ? (+prem.markPrice / +prem.indexPrice - 1) * 100 : null; }
        if (Array.isArray(lsA) && lsA[0]) d.longAcc = +lsA[0].longAccount * 100;
        if (Array.isArray(lsT) && lsT[0]) d.longTop = +lsT[0].longAccount * 100;
        // 15m candles out of the 5m ones (aligned to the quarter hour) for the RSI and the forming candle's volume
        var c15 = [], v15 = [], cur = -1;
        k.forEach(function (row) {
            var b = Math.floor(row[0] / 900000);
            if (b !== cur) { c15.push(+row[4]); v15.push(+row[5]); cur = b; } else { c15[c15.length - 1] = +row[4]; v15[v15.length - 1] += +row[5]; }
        });
        d.rsi15 = rsi(c15, 14);
        var m = v15.length, sum = 0, cnt = 0;
        for (var i = Math.max(0, m - 21); i < m - 1; i++) { sum += v15[i]; cnt++; }
        d.vol15x = cnt && sum > 0 ? v15[m - 1] / (sum / cnt) : null;
        // what the chart itself already holds (only while those indicators are on)
        d.sizes = sizeFlow(3600);
        var bands = FL.bookBands && FL.bookBands(); if (bands) d.bands = bands;
        var now = Date.now() / 1000, lq = { L: 0, S: 0, any: false };
        Object.keys(FL.liq.min || {}).forEach(function (t) { if (+t >= now - 3660) { lq.L += FL.liq.min[t].L; lq.S += FL.liq.min[t].S; } lq.any = true; });
        if (CF.ind.liq) d.liq = lq;
        if (CF.ind.liqmap && FL.lmap.levels && FL.lmap.levels.length) {
            var below = null, above = null;
            FL.lmap.levels.forEach(function (c) {
                var dist = (c.price / last - 1) * 100;
                if (dist < -0.2 && dist > -5 && c.L > 0 && (!below || c.L > below.v)) below = { p: c.price, v: c.L, dist: dist };
                if (dist > 0.2 && dist < 5 && c.S > 0 && (!above || c.S > above.v)) above = { p: c.price, v: c.S, dist: dist };
            });
            d.lmap = { below: below, above: above };
        }
        return d;
    });
}
// price x open interest over one window -> [short name, sentence, tone (1 up, -1 down, 0 flat)]
function regime(w) {
    var s = Math.sqrt(w.h), p = w.price, o = w.oi, flatP = Math.abs(p) < 0.15 * s;
    if (o == null) return flatP ? ['횡보', '가격이 거의 그대로예요.', 0] : p > 0 ? ['상승', '가격이 올랐어요.', 1] : ['하락', '가격이 내렸어요.', -1];
    var flatO = Math.abs(o) < 0.3 * s;
    if (flatP) return flatO ? ['횡보', '가격도 포지션도 거의 그대로예요.', 0]
        : o > 0 ? ['힘 모으는 중', '가격은 제자리인데 새 포지션이 쌓이고 있어요. 어느 한쪽이 틀리면 크게 움직일 수 있는 모양입니다.', 0]
        : ['정리 중', '가격은 제자리이고 포지션이 줄고 있어요.', 0];
    if (p > 0) return flatO ? ['상승', '포지션 변화 없이 올랐어요. 현물이나 기존 포지션이 끌어올린 모양입니다.', 1]
        : o > 0 ? ['롱 유입 상승', '새 포지션이 들어오면서 올랐어요. 추세에 연료가 붙는 모양입니다.', 1]
        : ['숏 정리 상승', '포지션이 줄면서 올랐어요. 숏 청산 · 커버링이 밀어 올린 상승이라 정리가 끝나면 힘이 빠지기 쉽습니다.', 1];
    return flatO ? ['하락', '포지션 변화 없이 내렸어요. 현물 매도나 기존 포지션이 끌어내린 모양입니다.', -1]
        : o > 0 ? ['숏 유입 하락', '새 포지션이 들어오면서 내렸어요. 숏이 공격적으로 쌓이는 모양입니다.', -1]
        : ['롱 정리 하락', '포지션이 줄면서 내렸어요. 롱 청산 · 손절이 만든 하락(투매형)이라, 역추세 관점에서는 정리가 끝나는지 지켜볼 구간입니다.', -1];
}
// the sentences under the table
function readings(d) {
    var out = [], w = d.win[0], s = Math.sqrt(w.h), big = Math.abs(w.price) >= 0.15 * s;
    if (big && w.cvd !== 0) {
        if (w.price > 0 === w.cvd > 0) out.push('시장가 ' + (w.cvd > 0 ? '매수' : '매도') + '가 가격을 끌고 갔어요 (1시간 선물 CVD ' + fmtUsdS(w.cvd) + ').');
        else if (w.price > 0) out.push('가격은 올랐는데 시장가는 매도가 더 많았어요. 지정가 매수가 받아내며 오른 모양(흡수)입니다.');
        else out.push('가격은 내렸는데 시장가는 매수가 더 많았어요. 위에서 지정가 매도가 눌러 내린 모양입니다.');
    } else if (!big && w.vol > 0 && Math.abs(w.cvd) / w.vol >= 0.05) {
        // a one-sided hour that went nowhere: the other side was resting in the book
        out.push(w.cvd < 0 ? '시장가 매도가 우세했는데(1시간 선물 CVD ' + fmtUsdS(w.cvd) + ') 가격은 버텼어요. 아래에서 지정가 매수가 받아낸 모양(흡수)입니다.'
            : '시장가 매수가 우세했는데(1시간 선물 CVD ' + fmtUsdS(w.cvd) + ') 가격은 못 올랐어요. 위에서 지정가 매도가 받아낸 모양(흡수)입니다.');
    }
    if (w.spot != null && (Math.abs(w.cvd) > 0 || Math.abs(w.spot) > 0)) {
        if (w.cvd > 0 && w.spot > 0) out.push('선물과 현물이 함께 사고 있어요 (실수요 동반).');
        else if (w.cvd < 0 && w.spot < 0) out.push('선물과 현물이 함께 팔고 있어요.');
        else if (w.cvd > 0) out.push('선물만 사고 현물은 따라오지 않아요 (레버리지 주도라 되돌리기 쉬운 모양).');
        else out.push('선물은 파는데 현물은 사고 있어요 (현물 매수가 받치는 모양).');
    }
    if (d.sizes) {
        var b = d.sizes.big, sm = d.sizes.small;
        if (b > 0 && sm < 0) out.push('큰 주문($10만 이상)은 사고 작은 주문($1만 미만)은 팔았어요: 큰손 ' + fmtUsdS(b) + ', 소액 ' + fmtUsdS(sm) + '.');
        else if (b < 0 && sm > 0) out.push('큰 주문($10만 이상)은 팔고 작은 주문($1만 미만)은 샀어요: 큰손 ' + fmtUsdS(b) + ', 소액 ' + fmtUsdS(sm) + '.');
        else out.push('큰 주문과 작은 주문이 같은 방향이에요: 큰손 ' + fmtUsdS(b) + ', 소액 ' + fmtUsdS(sm) + ' (1시간).');
    }
    if (d.fund != null) {
        if (d.fund >= 0.05) out.push('펀딩비 ' + d.fund.toFixed(4) + '%: 롱이 많이 몰려 비용을 크게 내고 있어요 (롱 과밀).');
        else if (d.fund <= -0.03) out.push('펀딩비 ' + d.fund.toFixed(4) + '%: 숏이 많이 몰려 비용을 내고 있어요 (숏 과밀, 숏 스퀴즈 재료).');
        else if (d.fund < -0.005) out.push('펀딩비 ' + d.fund.toFixed(4) + '%: 숏 쪽이 조금 우세해요.');
    }
    if (d.rsi15 != null && (d.rsi15 <= 30 || d.rsi15 >= 70)) out.push('15분봉 RSI ' + d.rsi15.toFixed(0) + ': ' + (d.rsi15 <= 30 ? '과매도' : '과매수') + ' 구간이에요.');
    if (d.vol15x != null && d.vol15x >= 2.5) out.push('지금 15분봉 거래량이 평균의 ' + d.vol15x.toFixed(1) + '배예요. 소진 알람(3배 · 캔들 0.8% · 꼬리 40%)은 봉이 마감돼야 판정됩니다.');
    return out;
}
function kv(label, value, sub) {
    return el('div', 'bf-kv', '<span class="k">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="v">' + value + '</span>');
}
var briefSeq = 0;
function openBrief() {
    var sym = CF.symbol();
    if (!/USDT$/.test(sym) || /^(HL|VAR)-/.test(sym)) { CF.toast('시장 브리핑은 Binance 선물 종목에서 볼 수 있어요'); return; }
    var base = sym.replace(/USDT$/, ''), seq = ++briefSeq;
    CF.openSheet('시장 브리핑 · ' + esc(base), [el('div', 'note', '불러오는 중…')]);
    briefData(sym).then(function (d) {
        if (seq !== briefSeq || !document.getElementById('sheet_bg').classList.contains('show')) return;
        renderBrief(d, base);
    }).catch(function () {
        if (seq !== briefSeq) return;
        var b = el('button', 'reset', '다시 시도'); b.onclick = openBrief;
        CF.openSheet('시장 브리핑 · ' + esc(base), [el('div', 'note', '데이터를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.'), b]);
    });
}
function renderBrief(d, base) {
    var rows = [], r1 = regime(d.win[0]), r4 = regime(d.win[1]);
    var tone = function (t) { return t > 0 ? 'up' : t < 0 ? 'down' : ''; };
    rows.push(el('div', 'bf-head', '<div class="t"><span class="' + tone(r1[2]) + '">' + esc(r1[0]) + '</span><small>최근 1시간</small></div><div class="s">' + esc(r1[1]) + '</div>' +
        '<div class="t2"><b class="' + tone(r4[2]) + '">' + esc(r4[0]) + '</b> <small>최근 4시간 · </small>' + esc(r4[1]) + '</div>'));
    // the numbers the reading is made of
    var g = '<div class="bf-grid"><span></span>' + d.win.map(function (w) { return '<span class="h">' + w.label + '</span>'; }).join('');
    function line(name, fn) { g += '<span class="n">' + name + '</span>' + d.win.map(function (w) { var v = fn(w); return '<span class="' + (v == null ? '' : cls(v[0])) + '">' + (v == null ? '—' : v[1]) + '</span>'; }).join(''); }
    line('가격', function (w) { return [w.price, pctS(w.price)]; });
    line('미결제약정', function (w) { return w.oi == null ? null : [w.oi, pctS(w.oi)]; });
    line('선물 CVD', function (w) { return [w.cvd, fmtUsdS(w.cvd)]; });
    line('현물 CVD', function (w) { return w.spot == null ? null : [w.spot, fmtUsdS(w.spot)]; });
    rows.push(el('div', '', g + '</div>'));
    var rd = readings(d);
    if (rd.length) { rows.push(CF.sectionTitle('읽기')); rows.push(el('div', 'bf-read', rd.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join(''))); }
    rows.push(CF.sectionTitle('포지션'));
    if (d.oiUsd != null) rows.push(kv('미결제약정', '$' + CF.fmtVol(d.oiUsd)));
    if (d.fund != null) {
        var left = Math.max(0, d.fundNext - Date.now()), hh = Math.floor(left / 3600000), mm = Math.floor(left % 3600000 / 60000);
        rows.push(kv('펀딩비 (예상)', '<span class="' + cls(d.fund) + '">' + d.fund.toFixed(4) + '%</span>', '다음 정산까지 ' + hh + '시간 ' + mm + '분 · 양수면 롱이 숏에게 냄'));
    }
    if (d.basis != null) rows.push(kv('선물 − 현물지수', '<span class="' + cls(d.basis) + '">' + pctS(d.basis, 3) + '</span>', '양수 = 선물이 더 비쌈'));
    if (d.longAcc != null) rows.push(kv('롱 계정 비율', d.longAcc.toFixed(1) + '%', '전체 계정 수 기준' + (d.longTop != null ? ' · 상위 트레이더 포지션 ' + d.longTop.toFixed(1) + '%' : '')));
    rows.push(CF.sectionTitle('유동성 · 청산'));
    if (d.bands) {
        var b1 = d.bands[1], ratio = b1.a > 0 ? b1.b / b1.a : 0;
        rows.push(kv('호가 ±1%', '<span class="up">$' + CF.fmtVol(b1.b) + '</span> / <span class="down">$' + CF.fmtVol(b1.a) + '</span>',
            '매수 대기 / 매도 대기' + (ratio ? ' · ' + (ratio >= 1 ? '매수가 ' + ratio.toFixed(1) + '배' : '매도가 ' + (1 / ratio).toFixed(1) + '배') + ' 두꺼움' : '')));
    } else rows.push(kv('호가 ±1%', '<span style="color:var(--muted)">꺼짐</span>', '지표에서 "호가 벽"을 켜면 나와요'));
    if (d.liq) rows.push(kv('청산 (1시간)', '<span class="down">롱 $' + CF.fmtVol(d.liq.L) + '</span> · <span class="up">숏 $' + CF.fmtVol(d.liq.S) + '</span>', '차트를 켜 둔 동안 받은 것만'));
    else rows.push(kv('청산 (1시간)', '<span style="color:var(--muted)">꺼짐</span>', '지표에서 "실시간 청산"을 켜면 나와요'));
    if (d.lmap) {
        if (d.lmap.below) rows.push(kv('아래 롱 청산 추정', CF.fmtPrice(d.lmap.below.p) + ' <small>(' + pctS(d.lmap.below.dist, 1) + ')</small>', '추정 $' + CF.fmtVol(d.lmap.below.v) + ' · 모델 값'));
        if (d.lmap.above) rows.push(kv('위 숏 청산 추정', CF.fmtPrice(d.lmap.above.p) + ' <small>(' + pctS(d.lmap.above.dist, 1) + ')</small>', '추정 $' + CF.fmtVol(d.lmap.above.v) + ' · 모델 값'));
    }
    rows.push(CF.sectionTitle('지금'));
    if (d.rsi15 != null) rows.push(kv('RSI (15분봉)', d.rsi15.toFixed(1), d.rsi15 <= 30 ? '과매도' : d.rsi15 >= 70 ? '과매수' : '중립'));
    if (d.vol15x != null) rows.push(kv('현재 15분봉 거래량', '평균의 ' + d.vol15x.toFixed(1) + '배', '직전 20봉 평균 대비 · 봉이 진행 중이면 작게 나옵니다'));
    if (d.rvol != null) rows.push(kv('최근 1시간 거래대금', '평소의 ' + d.rvol.toFixed(1) + '배', '24시간 시간당 평균 대비'));
    if (!d.sizes) rows.push(kv('큰손 vs 소액', '<span style="color:var(--muted)">꺼짐</span>', '지표에서 "주문 크기별 CVD"를 켜고 1시간쯤 지나면 나와요'));
    var again = el('button', 'reset', '새로 고침'); again.onclick = openBrief; rows.push(again);
    var t = new Date(d.at);
    rows.push(CF.noteRow(CF.pad2(t.getHours()) + ':' + CF.pad2(t.getMinutes()) + ' 기준 · Binance 선물 · 현물 공개 데이터를 정해진 규칙으로 읽은 요약입니다. 지나간 일을 설명할 뿐 다음 움직임을 예측하지 않고, 매매 조언이 아닙니다.'));
    CF.openSheet('시장 브리핑 · ' + esc(base), rows);
}
var btn = document.getElementById('brief_btn');
if (btn) btn.onclick = openBrief;
CF.openBrief = openBrief;
window.__pro = { whRows: whRows, briefData: briefData, regime: regime, readings: readings, sizeFlow: sizeFlow };
})();
