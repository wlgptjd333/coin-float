// Reading aids for counter-trend trading:
//  1. Exhaustion markers: the counter-trend alert rule ("소진") drawn on every closed candle where it held, with what the
//     price did afterwards, one marker at a time and summed up. The rule and its defaults are the ones the 180-day backtest
//     kept (tools/backtest, 2026-11-10). Built from the candles alone, so it works on every venue.
//  2. Key levels: the previous day's and week's high and low, today's open, from the exchange's daily and weekly candles.
//  3. Bar stats ("봉 통계"): a pane of thin colour rows under the chart, one cell per candle: taker buys, taker sells, delta,
//     delta share, volume, trade count, liquidations and the change of open interest, so the pieces of a climax (a delta
//     flip, a burst of liquidations, open interest dropping) line up under the candle they belong to.
// (1.45.0 removed "닮은 흐름", the look-alike scan: the 2026-11-25 backtest found no direction edge in it.)
(function () {
'use strict';
var CF = window.CF;
if (!CF) return;
var GOLD = '#F0B90B';
function pctS(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%'; }
function col(v) { return v > 0 ? CF.C.up : v < 0 ? CF.C.down : CF.C.inkDim; }
function span(c, t) { return '<span style="color:' + c + '">' + t + '</span>'; }
function muted(t) { return span(CF.C.muted, t); }
// bars that make up an hour and four hours on this chart (at least one)
function horizons() { var s = CF.secs(); return [Math.max(1, Math.round(3600 / s)), Math.max(1, Math.round(14400 / s))]; }
function hName(k) { var s = CF.secs(); return s <= 3600 ? (k ? '4h' : '1h') : (k ? '4봉' : '1봉'); }

// =====================================================================================================
// 1. Exhaustion markers
// =====================================================================================================
// the backtested settings per interval; any other interval uses the 15-minute ones
var EXH_AUTO = { '3m': { mult: 2, range: 1.2, wick: 0.4 }, '5m': { mult: 3, range: 0.8, wick: 0.5 } };
var EXH_15 = { mult: 3, range: 0.8, wick: 0.4 };
CF.defineSettings('exh', {
    title: '소진 마커 설정', onChange: function () { exh.key = ''; exhSync(); },
    fields: [
        { t: 'sec', label: '보일 마커' },
        { k: 'low', t: 'bool', label: '투매 소진 (신저가 뒤 반등 후보)', def: true },
        { k: 'high', t: 'bool', label: '과열 소진 (신고가 뒤 반락 후보)', sub: '백테스트에서 고점 쪽은 뚜렷한 차이가 없었습니다', def: false },
        { t: 'sec', label: '조건' },
        { k: 'auto', t: 'bool', label: '봉 길이별 검증된 값 쓰기', sub: '3분 2배 · 1.2% / 5분 3배 · 0.8% · 꼬리 50% / 그 밖 3배 · 0.8% · 꼬리 40%', def: true },
        { k: 'mult', t: 'num', label: '거래량 (직전 평균의 몇 배)', def: 3, min: 1.2, max: 20, step: 0.1, showIf: function (c) { return !c.auto; } },
        { k: 'range', t: 'num', label: '봉 길이 최소 (%)', def: 0.8, min: 0.1, max: 20, step: 0.1, showIf: function (c) { return !c.auto; } },
        { k: 'wick', t: 'range', label: '꼬리로 되돌린 비율 최소', def: 40, min: 10, max: 90, step: 5, unit: '%', showIf: function (c) { return !c.auto; } },
        { k: 'len', t: 'num', label: '비교할 직전 봉 수', def: 20, min: 5, max: 100, step: 1 },
        { t: 'note', label: '거래량이 직전 평균의 몇 배로 터지면서 직전 봉들의 신저가(신고가)를 찍고, 꼬리로 일정 비율 이상 되돌린 채 마감한 봉입니다. 알람의 "소진" 조건과 같은 계산이고, 마감한 봉에만 찍힙니다.' },
        { t: 'note', label: '180일 · 7개 코인 백테스트(2026-11-10): 15분 투매 소진은 1시간 뒤 평균 +0.15%, 4시간 뒤 +0.31%였고, 4시간 안에 꼬리 끝이 다시 깨진 경우가 47%였습니다. 과열 소진(고점)은 차이가 없었습니다. 지나간 기간의 기록이며 앞으로도 그렇다는 뜻은 아닙니다.' }
    ]
});
var exh = { key: '', list: [], byTime: {}, sum: null, off: null };
function exhParams() {
    var c = CF.S('exh'), a = c.auto ? EXH_AUTO[CF.interval()] || EXH_15 : { mult: c.mult, range: c.range, wick: c.wick / 100 };
    return { mult: a.mult, range: a.range, wick: a.wick, len: c.len, low: c.low, high: c.high };
}
function exhCompute() {
    var cs = CF.candles(), n = cs.length, p = exhParams();
    var key = n + '|' + (n ? cs[n - 1].time : 0) + '|' + CF.interval() + '|' + JSON.stringify(p);
    if (key === exh.key) return;
    exh.key = key; exh.list = []; exh.byTime = {};
    var hz = horizons(), len = p.len, i, j;
    // closed candles only: the last one is still forming
    for (i = len; i < n - 1; i++) {
        var c = cs[i], rng = c.high - c.low;
        if (!(rng > 0) || !(c.open > 0) || rng / c.open * 100 < p.range) continue;
        var sum = 0, lo = Infinity, hi = -Infinity;
        for (j = i - len; j < i; j++) { sum += cs[j].volume; if (cs[j].low < lo) lo = cs[j].low; if (cs[j].high > hi) hi = cs[j].high; }
        var avg = sum / len;
        if (!(avg > 0) || c.volume < p.mult * avg) continue;
        var dir = 0, back = 0;
        if (p.low && c.low < lo && (c.close - c.low) / rng >= p.wick) { dir = 1; back = (c.close - c.low) / rng; }
        else if (p.high && c.high > hi && (c.high - c.close) / rng >= p.wick) { dir = -1; back = (c.high - c.close) / rng; }
        if (!dir) continue;
        var m = { i: i, time: c.time, dir: dir, ratio: c.volume / avg, back: back, ext: dir > 0 ? c.low : c.high, close: c.close, ret: [null, null], broken: null };
        // what followed, in the direction of the fade (up after a flush, down after a blow-off)
        // (closed candles only, so a result does not change while the candle it ends on is still forming)
        hz.forEach(function (h, k) { if (i + h < n - 1) m.ret[k] = (cs[i + h].close - c.close) / c.close * 100 * dir; });
        if (i + hz[1] < n - 1) {
            var br = false;
            for (j = i + 1; j <= i + hz[1]; j++) if (dir > 0 ? cs[j].low < c.low : cs[j].high > c.high) { br = true; break; }
            m.broken = br;
        }
        exh.list.push(m); exh.byTime[c.time] = m;
    }
    // the record over the loaded candles: markers whose 4h are complete
    var done = exh.list.filter(function (m) { return m.ret[1] != null; });
    if (!done.length) { exh.sum = { n: 0 }; return; }
    var avg = function (k) { return done.reduce(function (a, m) { return a + m.ret[k]; }, 0) / done.length; };
    exh.sum = {
        n: done.length, all: exh.list.length, r1: avg(0), r4: avg(1),
        up4: done.filter(function (m) { return m.ret[1] > 0; }).length / done.length * 100,
        broke: done.filter(function (m) { return m.broken; }).length / done.length * 100
    };
}
function exhPaint(ctx, w, h) {
    if (!exh.list.length) return;
    var bs = CF.barSpacing ? CF.barSpacing() : 8, s = Math.max(4, Math.min(7, bs * 0.45));
    exh.list.forEach(function (m) {
        var x = CF.xOf(m.time); if (x == null || x < -10 || x > w + 10) return;
        var c = CF.candles()[m.i]; if (!c || c.time !== m.time) return;
        var y = CF.yOf(m.dir > 0 ? c.low : c.high); if (y == null) return;
        var y0 = m.dir > 0 ? y + 6 : y - 6;
        ctx.beginPath();
        if (m.dir > 0) { ctx.moveTo(x, y0); ctx.lineTo(x - s, y0 + s * 1.5); ctx.lineTo(x + s, y0 + s * 1.5); }
        else { ctx.moveTo(x, y0); ctx.lineTo(x - s, y0 - s * 1.5); ctx.lineTo(x + s, y0 - s * 1.5); }
        ctx.closePath();
        ctx.fillStyle = GOLD; ctx.fill();
    });
}
function exhLegend(i) {
    var cs = CF.candles(), c = cs[i], m = c && exh.byTime[c.time], hz = horizons();
    if (m) {
        var h = span(GOLD, (m.dir > 0 ? '투매 소진' : '과열 소진') + ' · 거래량 ' + m.ratio.toFixed(1) + '배 · 꼬리 ' + Math.round(m.back * 100) + '%');
        [0, 1].forEach(function (k) { if (m.ret[k] != null) h += ' ' + muted(hName(k) + ' 뒤') + ' ' + span(col(m.ret[k]), pctS(m.ret[k])); });
        if (m.broken != null) h += ' ' + muted(m.broken ? '꼬리 끝 다시 깨짐' : '꼬리 끝 지킴');
        else if (m.ret[1] == null) h += ' ' + muted(hName(1) + ' 지나는 중');
        return h;
    }
    var s = exh.sum;
    if (!s) return '';
    if (!s.n) return muted(exh.list.length ? '마커 ' + exh.list.length + '개 · 결과가 나오려면 ' + hName(1) + ' 지나야 해요' : '불러온 봉에는 없어요');
    return muted('불러온 봉 ' + s.n + '개 마커 · ' + hName(0)) + ' ' + span(col(s.r1), pctS(s.r1)) + ' ' + muted(hName(1)) + ' ' + span(col(s.r4), pctS(s.r4)) +
        ' ' + muted('(평균, 되돌린 방향 기준) · ' + hName(1) + ' 뒤 그쪽으로 가 있던 비율 ' + Math.round(s.up4) + '% · 꼬리 끝 다시 깨짐 ' + Math.round(s.broke) + '%');
}
function exhSync() {
    if (CF.ind.exh) {
        exhCompute();
        if (!exh.off) exh.off = CF.layer('top', exhPaint);
        CF.redrawNow();
    } else if (exh.off) { exh.off(); exh.off = null; exh.list = []; exh.byTime = {}; exh.sum = null; exh.key = ''; }
    CF.scheduleLegend();
}

// =====================================================================================================
// 2. Key levels: the previous day's and week's high and low, today's (and this week's) open
// =====================================================================================================
// Sweeps of these levels and the turn back from them are what a counter-trend trade often waits for. Days and weeks are
// the exchange's own (00:00 UTC, weeks from Monday), read from its daily and weekly candles every 10 minutes.
CF.defineSettings('levels', {
    title: '주요 레벨 설정', onChange: function () { CF.redrawNow(); CF.scheduleLegend(); },
    fields: [
        { k: 'day', t: 'bool', label: '전일 고가 · 저가', def: true },
        { k: 'week', t: 'bool', label: '전주 고가 · 저가', def: true },
        { k: 'dopen', t: 'bool', label: '오늘 시가', def: true },
        { k: 'wopen', t: 'bool', label: '이번 주 시가', def: false },
        { k: 'labels', t: 'bool', label: '선 위에 이름 표시', def: true },
        { k: 'cDay', t: 'color', label: '전일 색', def: '#9598A1' },
        { k: 'cWeek', t: 'color', label: '전주 색', def: '#E0B04A' },
        { t: 'note', label: '하루는 UTC 0시(한국 오전 9시), 한 주는 월요일 UTC 0시에 바뀝니다. 거래소의 일봉 · 주봉 값을 그대로 씁니다.' }
    ]
});
var lv = { sym: '', at: 0, day: '', d: null, w: null, off: null, seq: 0 };
function lvBars(iv) {
    var sym = CF.symbol(), v = CF.venue();
    if (v === 'bn') {
        return fetch('https://fapi.binance.com/fapi/v1/klines?symbol=' + sym + '&interval=' + iv + '&limit=2').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (a) { return a.map(function (k) { return { t: k[0], o: +k[1], h: +k[2], l: +k[3] }; }); });
    }
    if (v === 'hl') {
        var span = iv === '1w' ? 15 * 86400000 : 3 * 86400000, end = Date.now();
        return CF.hlCoin(sym).then(function (coin) { return CF.hlPost({ type: 'candleSnapshot', req: { coin: coin, interval: iv, startTime: end - span, endTime: end } }); })
            .then(function (a) { return (Array.isArray(a) ? a : []).slice(-2).map(function (k) { return { t: k.t, o: +k.o, h: +k.h, l: +k.l }; }); });
    }
    return Promise.resolve([]);
}
function lvLoad() {
    var sym = CF.symbol(), today = new Date().toISOString().slice(0, 10);
    if (lv.sym === sym && lv.day === today && Date.now() - lv.at < 600000) return;
    if (lv.sym !== sym) lv.d = lv.w = null;                           // another coin: never draw the last one's levels
    var seq = ++lv.seq;
    lv.sym = sym; lv.day = today; lv.at = Date.now();
    if (CF.venue() === 'var') { lv.d = lv.w = null; return; }
    Promise.all([lvBars('1d'), lvBars('1w')]).then(function (r) {
        if (seq !== lv.seq) return;
        // [previous, current] of each
        lv.d = r[0].length === 2 ? { prev: r[0][0], cur: r[0][1] } : null;
        lv.w = r[1].length === 2 ? { prev: r[1][0], cur: r[1][1] } : null;
        CF.redrawNow(); CF.scheduleLegend();
    }, function () { lv.at = 0; });
}
function lvList() {
    var c = CF.S('levels'), out = [];
    if (lv.d && c.day) { out.push({ p: lv.d.prev.h, n: '전일 고', col: c.cDay }); out.push({ p: lv.d.prev.l, n: '전일 저', col: c.cDay }); }
    if (lv.w && c.week) { out.push({ p: lv.w.prev.h, n: '전주 고', col: c.cWeek }); out.push({ p: lv.w.prev.l, n: '전주 저', col: c.cWeek }); }
    if (lv.d && c.dopen) out.push({ p: lv.d.cur.o, n: '오늘 시가', col: c.cDay, dot: true });
    if (lv.w && c.wopen) out.push({ p: lv.w.cur.o, n: '주 시가', col: c.cWeek, dot: true });
    return out;
}
function lvPaint(ctx, w, h) {
    var c = CF.S('levels'), list = lvList();
    if (!list.length) return;
    var used = CF.pocY != null ? [CF.pocY] : [];                       // centres of the tags already on screen
    var clear = function (ty) { return used.every(function (u) { return Math.abs(u - ty) >= 12; }); };
    list.forEach(function (l) {
        var y = CF.yOf(l.p); if (y == null || y < -2 || y > h + 2) return;
        y = Math.round(y) + 0.5;
        ctx.strokeStyle = CF.hexA(l.col, 0.75); ctx.lineWidth = 1; ctx.setLineDash(l.dot ? [1, 3] : [6, 4]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
        if (!c.labels) return;
        // above the line, or below it when that spot is taken; with a dark halo so it stays readable over the profile,
        // walls and heatmap at the right edge; left out when both spots are taken (the legend still lists it)
        var ty = clear(y - 7) ? y - 7 : clear(y + 8) ? y + 8 : null;
        if (ty == null) return;
        used.push(ty);
        ctx.font = '600 10px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 3; ctx.strokeStyle = CF.C.halo; ctx.strokeText(l.n, w - 6, ty);
        ctx.fillStyle = CF.hexA(l.col, 0.95); ctx.fillText(l.n, w - 6, ty);
        ctx.textAlign = 'start';
    });
}
function lvLegend(i) {
    var c = CF.S('levels'), cs = CF.candles(), cl = cs[i] && cs[i].close, parts = [];
    if (CF.venue() === 'var') return muted('이 거래소는 일봉을 주지 않아요');
    if (!lv.d && !lv.w) return muted('불러오는 중');
    var dist = function (p) { return cl ? ' ' + muted('(' + pctS((p - cl) / cl * 100, 1) + ')') : ''; };
    if (lv.d && c.day) parts.push(span(c.cDay, '전일 고 ' + CF.fmtPrice(lv.d.prev.h)) + dist(lv.d.prev.h) + ' ' + span(c.cDay, '저 ' + CF.fmtPrice(lv.d.prev.l)) + dist(lv.d.prev.l));
    if (lv.w && c.week) parts.push(span(c.cWeek, '전주 고 ' + CF.fmtPrice(lv.w.prev.h)) + dist(lv.w.prev.h) + ' ' + span(c.cWeek, '저 ' + CF.fmtPrice(lv.w.prev.l)) + dist(lv.w.prev.l));
    if (lv.d && c.dopen) parts.push(span(c.cDay, '오늘 시가 ' + CF.fmtPrice(lv.d.cur.o)));
    if (lv.w && c.wopen) parts.push(span(c.cWeek, '주 시가 ' + CF.fmtPrice(lv.w.cur.o)));
    return parts.join(' ' + muted('·') + ' ');
}
function lvSync() {
    if (CF.ind.levels) {
        lvLoad();
        if (!lv.off) lv.off = CF.layer('bottom', lvPaint);
    } else if (lv.off) { lv.off(); lv.off = null; }
}

// =====================================================================================================
// 3. Bar stats: one thin colour row per measure, one cell per candle
// =====================================================================================================
// Each cell's strength is its size against the same row's own big values (a high quantile over the loaded candles), so a
// bright cell means "large for this coin and interval". Money rows are in dollars (quote volume), open interest in coins,
// so a price move alone does not change it.
var BS_ROWS = [
    { k: 'buy', n: '매수', label: '시장가 매수 금액', def: true },
    { k: 'sell', n: '매도', label: '시장가 매도 금액', def: true },
    { k: 'delta', n: '델타', label: '델타 (매수 − 매도)', def: true },
    { k: 'dpct', n: '델타%', label: '델타 비율 (델타 ÷ 거래대금)', def: true },
    { k: 'vol', n: '거래대금', label: '거래대금', def: false },
    { k: 'cnt', n: '체결 수', label: '체결 수', def: true },
    { k: 'liq', n: '청산', label: '청산 (롱 · 숏)', def: true },
    { k: 'oi', n: 'OI', label: 'OI 변화 (코인 수량 기준)', def: true }
];
var BS_VOL = '#4FC3F7', BS_CNT = '#B388FF';
CF.defineSettings('bstat', {
    title: '봉 통계 설정', onChange: function () { bs.key = ''; CF.refreshSub('bstat'); },
    fields: [{ t: 'sec', label: '보일 줄 (위에서부터)' }].concat(BS_ROWS.map(function (r) { return { k: r.k, t: 'bool', label: r.label, def: r.def }; })).concat([
        { t: 'sec', label: '표시' },
        { k: 'gain', t: 'range', label: '민감도 (높을수록 작은 값도 진하게)', def: 5, min: 1, max: 10, step: 1 },
        { k: 'labels', t: 'bool', label: '줄 이름 표시', def: true },
        { t: 'note', label: '봉마다 한 칸씩, 값이 클수록 진하게 칠합니다. 진하기는 같은 줄의 다른 봉들과 비교한 크기라, 가장 진한 칸 = 이 코인 · 이 봉 주기에서 큰 편입니다.\n색: 매수 · 매도는 초록 · 빨강, 델타 · 델타% · OI는 늘면 초록 줄면 빨강, 청산은 숏청산이 많으면 초록 롱청산이 많으면 빨강입니다.\n읽는 법: 급락 끝의 봉에서 매도 · 청산이 진하고 OI가 빨갛게(포지션 정리) 겹치면 강제 정리가 몰린 자리입니다. 가격은 새 저점인데 델타 칸이 앞선 저점보다 옅으면 파는 힘이 줄었다는 뜻입니다. 방향을 알려 주는 신호는 아닙니다.' },
        { t: 'note', label: '데이터: 매수 · 매도 · 체결 수는 거래소 봉 데이터, OI는 바이낸스 기록(1분 · 3분봉은 5분마다 한 칸)입니다. 하이퍼리퀴드 코인은 매수 · 매도 구분과 OI 기록이 없어 그 줄을 빼고 보여 줍니다. 청산은 차트를 켜 둔 동안 모은 것만 있습니다(최근 3일).' }
    ])
});
var bs = { key: '', rows: null, ref: {}, oi: [], oiSym: '', oiAt: 0, oiSeq: 0, liqM: null, liqAt: 0, liqSym: '', timer: 0 };
var BS_OI_PERIOD = { '1m': '5m', '3m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1d': '1d', '3d': '1d', '1w': '1d', '1M': '1d' };
function bsLoadOi() {
    var sym = CF.symbol(), iv = CF.interval(), id = sym + '|' + iv;
    if (CF.venue() !== 'bn') { bs.oi = []; bs.oiSym = id; return; }
    if (bs.oiSym === id && Date.now() - bs.oiAt < 60000) return;
    if (bs.oiSym !== id) bs.oi = [];
    var seq = ++bs.oiSeq;
    bs.oiSym = id; bs.oiAt = Date.now();
    fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + sym + '&period=' + (BS_OI_PERIOD[iv] || '1h') + '&limit=500')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (rows) {
            if (seq !== bs.oiSeq || !Array.isArray(rows)) return;
            bs.oi = rows.map(function (r) { return { t: Math.floor(r.timestamp / 1000), v: +r.sumOpenInterest }; }).sort(function (a, b) { return a.t - b.t; });
            bs.key = ''; CF.refreshSub('bstat');
        }, function () { if (seq === bs.oiSeq) bs.oiAt = 0; });
}
// per-minute liquidations { minute: { L, S } } of this coin: the live ones while the liquidation feature runs, else what it
// saved on the phone the last time it ran
function bsLiqMinutes() {
    var FL = window.__flow, sym = CF.symbol();
    if (FL && FL.liq && FL.liq.sym === sym && FL.liq.min) return { m: FL.liq.min, ver: FL.liq.ver };
    if (bs.liqSym !== sym || Date.now() - bs.liqAt > 60000) { bs.liqSym = sym; bs.liqAt = Date.now(); bs.liqM = CF.LS.get('liq.m.' + sym, null) || {}; }
    return { m: bs.liqM, ver: -Math.floor(bs.liqAt / 1000) };
}
// index of the candle that contains t (seconds), or -1
function bsIndexAt(cs, t) {
    var lo = 0, hi = cs.length - 1, best = -1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (cs[m].time <= t) { best = m; lo = m + 1; } else hi = m - 1; }
    if (best < 0) return -1;
    var end = best + 1 < cs.length ? cs[best + 1].time : CF.nextOpen(cs[best].time);
    return t < end ? best : -1;
}
function bsQuantile(vals, q) {
    if (!vals.length) return 0;
    var a = vals.slice().sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))];
}
// one object per candle with the raw values (null = no data), rebuilt at most once a second
function bsData() {
    var cs = CF.candles(), n = cs.length, lq = bsLiqMinutes(), hl = CF.venue() !== 'bn';
    var key = n + '|' + (n ? cs[0].time + ':' + cs[n - 1].time : '') + '|' + CF.interval() + '|' + lq.ver + '|' + bs.oi.length + ':' + bs.oiAt + '|' + Math.floor(Date.now() / 1000);
    if (bs.key === key && bs.rows) return bs.rows;
    var rows = new Array(n), i;
    for (i = 0; i < n; i++) {
        var c = cs[i], qv = c.qv, qb = c.qb, ok = !hl && qv > 0 && qb >= 0;
        rows[i] = { buy: ok ? qb : null, sell: ok ? qv - qb : null, delta: ok ? 2 * qb - qv : null, dpct: ok ? (2 * qb - qv) / qv * 100 : null,
            vol: qv > 0 ? qv : null, cnt: c.n > 0 ? c.n : null, liq: null, liqL: 0, liqS: 0, oi: null };
    }
    Object.keys(lq.m || {}).forEach(function (k) {
        var e = lq.m[k], j = bsIndexAt(cs, +k); if (j < 0 || !e) return;
        rows[j].liqL += e.L || 0; rows[j].liqS += e.S || 0;
    });
    for (i = 0; i < n; i++) if (rows[i].liqL || rows[i].liqS) rows[i].liq = rows[i].liqS - rows[i].liqL;
    // open interest: the last sample inside each candle against the last one before it
    var last = {}, prev = null;
    bs.oi.forEach(function (p) { var j = bsIndexAt(cs, p.t); if (j >= 0) last[j] = p.v; });
    for (i = 0; i < n; i++) {
        if (last[i] == null) continue;
        if (prev != null && prev > 0) rows[i].oi = (last[i] - prev) / prev * 100;
        prev = last[i];
    }
    // the reference size of each row: a high quantile of its sizes over the closed candles (lower with more gain)
    var q = 1 - CF.S('bstat').gain * 0.01, ref = {};                // gain 5: the 95th percentile is full strength
    BS_ROWS.forEach(function (r) {
        var vals = [];
        for (var j = 0; j < n - 1; j++) {
            var v = r.k === 'liq' ? rows[j].liqL + rows[j].liqS : rows[j][r.k];
            if (v != null && v !== 0) vals.push(Math.abs(v));
        }
        ref[r.k] = bsQuantile(vals, q);
    });
    bs.key = key; bs.rows = rows; bs.ref = ref;
    return rows;
}
// the colour of one cell, or null for an empty one
function bsCell(rk, row) {
    var v = rk === 'liq' ? (row.liqL + row.liqS) : row[rk], ref = bs.ref[rk];
    if (v == null || v === 0 || !(ref > 0)) return null;
    var a = 0.05 + 0.9 * Math.min(1, Math.abs(v) / ref), c;
    if (rk === 'buy') c = CF.C.up;
    else if (rk === 'sell') c = CF.C.down;
    else if (rk === 'vol') c = BS_VOL;
    else if (rk === 'cnt') c = BS_CNT;
    else if (rk === 'liq') c = row.liqS >= row.liqL ? CF.C.up : CF.C.down;
    else c = v > 0 ? CF.C.up : CF.C.down;
    return CF.hexA(c, a);
}
// Hyperliquid's candles have no buyer / seller split and it has no open-interest history: those rows are left out there
var BS_BN_ONLY = { buy: 1, sell: 1, delta: 1, dpct: 1, oi: 1 };
function bsActive() { var c = CF.S('bstat'), bn = CF.venue() === 'bn'; return BS_ROWS.filter(function (r) { return c[r.k] && (bn || !BS_BN_ONLY[r.k]); }); }
function fmtCnt(v) { return v >= 1000 ? CF.fmtVol(v) : String(Math.round(v)); }
function bsDraw(ctx, w, h) {
    var list = bsActive(), cs = CF.candles(); if (!list.length || !cs.length) return;
    var ts = CF.chart.timeScale(), vr = ts.getVisibleLogicalRange(), sp = CF.barSpacing(); if (!vr || !sp) return;
    // the pane's legend line sits at the top, as in the other panes: the rows start under it
    var top = Math.min(20, Math.round(h * 0.2)), rows = bsData(), rh = (h - top) / list.length, gap = rh >= 7 ? 1 : 0;
    var i0 = Math.max(0, Math.floor(vr.from) - 1), i1 = Math.min(cs.length - 1, Math.ceil(vr.to) + 1);
    for (var i = i0; i <= i1; i++) {
        var x = ts.logicalToCoordinate(i); if (x == null) continue;
        var x0 = Math.round(x - sp / 2), x1 = Math.round(x + sp / 2), cw = Math.max(1, x1 - x0 - (sp >= 4 ? 1 : 0));
        for (var r = 0; r < list.length; r++) {
            var fill = bsCell(list[r].k, rows[i]); if (!fill) continue;
            ctx.fillStyle = fill;
            ctx.fillRect(x0, top + Math.round(r * rh), cw, Math.max(1, Math.round((r + 1) * rh) - Math.round(r * rh) - gap));
        }
    }
    if (!CF.S('bstat').labels || rh < 9) return;
    var fs = rh >= 13 ? 10 : 9;
    // names on the left edge: the newest candles at the right stay uncovered
    ctx.font = '600 ' + fs + 'px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    list.forEach(function (r, k) {
        var y = top + Math.round((k + 0.5) * rh);
        ctx.lineWidth = 3; ctx.strokeStyle = CF.C.halo; ctx.strokeText(r.n, 5, y);
        ctx.fillStyle = CF.hexA(CF.C.ink, 0.9); ctx.fillText(r.n, 5, y);
    });
}
// the pane is a hidden, flat series (it keeps the pane on the candles' time scale) with the cells drawn over it
function bsPrimitive() {
    var prim = { _req: null, attached: function (p) { prim._req = p.requestUpdate; }, detached: function () { prim._req = null; }, updateAllViews: function () {},
        paneViews: function () { return [view]; } };
    var view = { zOrder: function () { return 'top'; }, renderer: function () { return renderer; } };
    var renderer = { draw: function (target) {
        target.useMediaCoordinateSpace(function (sc) { try { bsDraw(sc.context, sc.mediaSize.width, sc.mediaSize.height); } catch (e) { console.error(e); } });
    } };
    return prim;
}
function bsFlat() { return CF.candles().map(function (c) { return { time: c.time, value: 0 }; }); }
function usdS(v) { return (v < 0 ? '-$' : '+$') + CF.fmtVol(Math.abs(v)); }
CF.registerSub('bstat', {
    name: '봉 통계',
    color: function () { return BS_CNT; },
    create: function (pane, sid) {
        var o = { s: CF.chart.addSeries(CF.LW.HistogramSeries, { color: 'rgba(0,0,0,0)', priceLineVisible: false, lastValueVisible: false, priceScaleId: sid || 'bstat' }, pane) };
        if (!sid) { try { o.s.priceScale().applyOptions({ visible: false }); } catch (e) { /* older engine */ } }
        o.prim = bsPrimitive(); o.s.attachPrimitive(o.prim);
        return o;
    },
    setData: function (o) { bs.key = ''; o.s.setData(bsFlat()); if (o.prim._req) o.prim._req(); },
    update: function (o, i) {
        var c = CF.candles()[i]; if (!c) return;
        try { o.s.update({ time: c.time, value: 0 }); } catch (e) { o.s.setData(bsFlat()); }
        if (o.prim._req) o.prim._req();
    },
    legend: function (i, c, open) {
        var rows = bsData(), r = rows[i], cfg = CF.S('bstat'), parts = [];
        if (!r) return span(CF.C.muted, '봉 통계');
        if (cfg.buy && r.buy != null) parts.push(span(CF.C.up, '매수 $' + CF.fmtVol(r.buy)));
        if (cfg.sell && r.sell != null) parts.push(span(CF.C.down, '매도 $' + CF.fmtVol(r.sell)));
        if ((cfg.delta || cfg.dpct) && r.delta != null) parts.push(span(col(r.delta), '델타 ' + usdS(r.delta) + ' (' + pctS(r.dpct, 0) + ')'));
        if (cfg.vol && r.vol != null) parts.push(span(BS_VOL, '거래대금 $' + CF.fmtVol(r.vol)));
        if (cfg.cnt && r.cnt != null) parts.push(span(BS_CNT, '체결 ' + fmtCnt(r.cnt)));
        if (cfg.liq && (r.liqL || r.liqS)) parts.push(muted('청산') + ' ' + span(CF.C.down, '롱 $' + CF.fmtVol(r.liqL)) + ' ' + span(CF.C.up, '숏 $' + CF.fmtVol(r.liqS)));
        if (cfg.oi && r.oi != null) parts.push(span(col(r.oi), 'OI ' + pctS(r.oi)));
        var h = span(CF.C.muted, '봉 통계') + (parts.length ? ' ' + parts.join(' ') : '');
        if (open) h += ' ' + muted('· 칸이 진할수록 이 코인 · 봉 주기에서 큰 값' + (CF.venue() !== 'bn' ? ' · 이 거래소는 매수 · 매도 구분과 OI 기록이 없어 체결 수 · 청산만' : ''));
        return h;
    }
});
CF.registerFeature('bstat', {
    byInterval: true,
    start: function () {
        bs.key = ''; bs.oiSym = ''; bsLoadOi();
        // open interest and the saved liquidations come in slowly: look again every 20 s
        bs.timer = setInterval(function () { if (document.hidden) return; bsLoadOi(); CF.refreshSub('bstat'); }, 20000);
    },
    stop: function () { clearInterval(bs.timer); bs.timer = 0; bs.oiSeq++; bs.oi = []; bs.oiSym = ''; bs.rows = null; bs.key = ''; }
});

// ---- wiring --------------------------------------------------------------------------------------------------------
CF.onData(function (kind) {
    if (kind === 'new' && CF.ind.levels) lvLoad();                     // a new day or week starts on a candle open
    if (kind === 'last') return;
    exhSync(); lvSync();
});
CF.legendItems(function (i) {
    var out = [];
    [['levels', '레벨', lvLegend], ['exh', '소진', exhLegend]].forEach(function (x) {
        var k = x[0];
        if (!CF.ind[k] && !CF.isHidden(k)) return;
        var v = CF.ind[k] ? x[2](i) : '';
        out.push(CF.builtinItem(k, '<b>' + x[1] + '</b>' + (v ? ' ' + v : '')));
    });
    return out;
});
window.__sig = { exh: exh, lv: lv, bs: bs };
})();
