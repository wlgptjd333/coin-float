// Overlays on the price chart. The first two are built from the candles alone (so they work on every venue); the third,
// key levels, reads the exchange's daily and weekly candles:
//  1. Exhaustion markers: the counter-trend alert rule ("소진") drawn on every closed candle where it held, with what the
//     price did afterwards, one marker at a time and summed up. The rule and its defaults are the ones the 180-day backtest
//     kept (tools/backtest, 2026-11-10).
//  2. Similar past moves ("닮은 흐름"): the stretches of the loaded history whose shape is closest to the last N candles,
//     and what came after each of them, drawn as a band ahead of the last candle. It describes the past; it is not a
//     forecast, and the legend says how often the same method has pointed the right way on this chart before.
(function () {
'use strict';
var CF = window.CF;
if (!CF) return;
var GOLD = '#F0B90B', VIOLET = '#B388FF';
var AN_PAL = ['#B388FF', '#FF8A80', '#80D8FF', '#FFD180', '#A7FFEB', '#F48FB1', '#CCFF90', '#FFE57F', '#82B1FF', '#EA80FC'];
function pctS(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%'; }
function col(v) { return v > 0 ? CF.C.up : v < 0 ? CF.C.down : '#B2B5BE'; }
function span(c, t) { return '<span style="color:' + c + '">' + t + '</span>'; }
function muted(t) { return span('#848E9C', t); }
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
// 2. Similar past moves
// =====================================================================================================
CF.defineSettings('analog', {
    title: '닮은 흐름 설정', onChange: function () { an.key = ''; anSync(); },
    fields: [
        { t: 'sec', label: '비교' },
        { k: 'len', t: 'num', label: '비교할 최근 봉 수', def: 30, min: 10, max: 120, step: 1 },
        { k: 'ahead', t: 'num', label: '이어 볼 봉 수', def: 20, min: 5, max: 100, step: 1 },
        { k: 'k', t: 'num', label: '찾을 닮은 구간 수', def: 20, min: 3, max: 30, step: 1 },
        { k: 'pool', t: 'sel', label: '찾을 곳', def: 'same', opts: [['same', '이 차트 봉만'], ['tf', '이 코인 1분~4시간 모두']] },
        { t: 'note', label: '"1분~4시간 모두"는 거래소에서 1분 · 5분 · 15분 · 1시간 · 4시간 봉을 1,500개씩 더 받아 와 함께 찾습니다 (바이낸스 · 하이퍼리퀴드). 다른 봉에서 찾은 구간도 지금 차트의 봉 수만큼 이어 그립니다.', showIf: function (c) { return c.pool === 'tf'; } },
        { t: 'sec', label: '표시' },
        { k: 'band', t: 'bool', label: '범위 띠 (중간 절반)', sub: '닮은 구간들 뒤 움직임의 25~75% 범위', def: true },
        { k: 'paths', t: 'bool', label: '구간마다 이어진 선 (번호)', sub: '범례의 ⚙ 를 누르면 구간 목록이 나와요', def: false },
        { k: 'marks', t: 'bool', label: '닮은 과거 구간 위치 표시', sub: '차트 아래쪽에 짧은 막대로', def: true },
        { k: 'color', t: 'color', label: '색', def: VIOLET },
        { t: 'note', label: '최근 봉들의 모양(로그 가격을 평균 0, 크기 1로 맞춘 것)과 가장 닮은 과거 구간을 불러온 봉 안에서 찾고, 그 구간들 바로 뒤에 실제로 움직인 비율을 지금 가격에 이어 그립니다. 움직임 크기가 다른 구간(다른 봉 길이 포함)은 지금 봉의 움직임 크기에 맞춰 키우거나 줄입니다.' },
        { t: 'note', label: '백테스트(바이낸스 10개 코인, 최근 90일)에서 방향은 맞히지 못했고, 띠의 폭은 실제 흔들림과 대체로 맞았습니다. 닮은 구간이 적으면 띠가 실제보다 좁아져서 기본값을 20개로 두었습니다.' },
        { t: 'note', label: '과거에 닮은 모양이 있었다는 기록일 뿐, 앞으로 그렇게 간다는 뜻이 아닙니다. 범례의 "같은 방법으로 과거에 방향 맞춘 비율"이 50% 근처면 이 차트에서는 동전 던지기와 다르지 않다는 뜻입니다.' }
    ]
});
var an = { key: '', res: null, off: null, test: null, testKey: '' };
function logs(cs) { var p = new Array(cs.length); for (var i = 0; i < cs.length; i++) p[i] = Math.log(cs[i].close); return p; }
// mean and standard deviation of p over the window that ends at e (length L), from prefix sums
function stats(S1, S2, e, L) { var s = S1[e + 1] - S1[e + 1 - L], q = S2[e + 1] - S2[e + 1 - L], mu = s / L, v = q / L - mu * mu; return [mu, v > 1e-18 ? Math.sqrt(v) : 0]; }
function retSd(p, e, L) { var s = 0, q = 0; for (var j = e - L + 2; j <= e; j++) { var r = p[j] - p[j - 1]; s += r; q += r * r; } var m = s / (L - 1); return Math.sqrt(Math.max(0, q / (L - 1) - m * m)); }
// best K windows (ending before `limit` - H, not overlapping each other) for the window that ends at `q`
function matches(p, S1, S2, q, L, H, K, limit) {
    var st = stats(S1, S2, q, L); if (!(st[1] > 0)) return [];
    var z = new Array(L), j;
    for (j = 0; j < L; j++) z[j] = (p[q - L + 1 + j] - st[0]) / st[1];
    var cand = [];
    for (var e = L - 1; e + H <= limit && e <= q - L; e++) {
        var se = stats(S1, S2, e, L); if (!(se[1] > 0)) continue;
        var dot = 0, base = e - L + 1;
        for (j = 0; j < L; j++) dot += z[j] * p[base + j];
        cand.push({ e: e, r: dot / (L * se[1]) });
    }
    cand.sort(function (a, b) { return b.r - a.r; });
    var out = [], gap = Math.max(3, Math.floor(L / 2));
    for (var c = 0; c < cand.length && out.length < K; c++) {
        if (out.some(function (o) { return Math.abs(o.e - cand[c].e) < gap; })) continue;
        out.push(cand[c]);
    }
    return out;
}
function quant(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); }
// ---- the other intervals of this coin (pool "tf"): closed candles only, refreshed every few minutes --------------------
var AN_IVS = [['1m', 60], ['5m', 300], ['15m', 900], ['1h', 3600], ['4h', 14400]];
var anPool = { sym: '', at: 0, busy: false, list: [], seq: 0 };
function anFetch(iv, sec) {
    var sym = CF.symbol(), v = CF.venue();
    var keep = function (a) { return a.filter(function (k) { return isFinite(k.c) && k.c > 0; }).slice(0, -1); };   // the last one is still forming
    if (v === 'bn') {
        return fetch('https://fapi.binance.com/fapi/v1/klines?symbol=' + sym + '&interval=' + iv + '&limit=1500').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (a) { return keep(a.map(function (k) { return { t: k[0] / 1000, c: +k[4] }; })); });
    }
    if (v === 'hl') {
        var end = Date.now();
        return CF.hlCoin(sym).then(function (coin) { return CF.hlPost({ type: 'candleSnapshot', req: { coin: coin, interval: iv, startTime: end - 1500 * sec * 1000, endTime: end } }); })
            .then(function (a) { return keep((Array.isArray(a) ? a : []).map(function (k) { return { t: k.t / 1000, c: +k.c }; })); });
    }
    return Promise.resolve([]);
}
function anPoolLoad() {
    var sym = CF.symbol(), v = CF.venue();
    if (CF.S('analog').pool !== 'tf' || (v !== 'bn' && v !== 'hl')) return;
    if (anPool.busy || (anPool.sym === sym && Date.now() - anPool.at < 300000)) return;
    if (anPool.sym !== sym) anPool.list = [];
    var seq = ++anPool.seq;
    anPool.busy = true; anPool.sym = sym;
    Promise.all(AN_IVS.map(function (x) { return anFetch(x[0], x[1]).then(null, function () { return []; }); })).then(function (rs) {
        anPool.busy = false;
        if (seq !== anPool.seq || CF.symbol() !== sym) return;
        anPool.list = rs.map(function (a, j) { return { iv: AN_IVS[j][0], sec: AN_IVS[j][1], t: a.map(function (k) { return k.t; }), c: a.map(function (k) { return k.c; }) }; })
            .filter(function (s) { return s.t.length > 0; });
        anPool.at = anPool.list.length ? Date.now() : Date.now() - 240000;  // nothing came: try again in a minute
        an.key = ''; anSync();
    }, function () { anPool.busy = false; });
}
// a series to search: log closes with their prefix sums; `own` is this chart's, where matches must also end before the query
function anSeries(iv, sec, t, closes, own) {
    var n = closes.length, p = new Array(n), S1 = [0], S2 = [0];
    for (var i = 0; i < n; i++) { p[i] = Math.log(closes[i]); S1.push(S1[i] + p[i]); S2.push(S2[i] + p[i] * p[i]); }
    return { iv: iv, sec: sec, t: t, p: p, S1: S1, S2: S2, own: own };
}
// best K windows over all series, most alike first, apart from each other inside a series
function anMatchAll(series, z, L, H, K) {
    var cand = [];
    series.forEach(function (s) {
        var n = s.p.length, last = s.own ? Math.min(n - 1 - H, n - 1 - L) : n - 1 - H;
        for (var e = L - 1; e <= last; e++) {
            var se = stats(s.S1, s.S2, e, L); if (!(se[1] > 0)) continue;
            var dot = 0, base = e - L + 1;
            for (var j = 0; j < L; j++) dot += z[j] * s.p[base + j];
            cand.push({ s: s, e: e, r: dot / (L * se[1]) });
        }
    });
    cand.sort(function (a, b) { return b.r - a.r; });
    var out = [], gap = Math.max(3, Math.floor(L / 2));
    for (var c = 0; c < cand.length && out.length < K; c++) {
        var x = cand[c];
        if (out.some(function (o) { return o.s === x.s && Math.abs(o.e - x.e) < gap; })) continue;
        out.push(x);
    }
    return out;
}
function anCompute() {
    var cs = CF.candles(), n = cs.length, c = CF.S('analog'), L = c.len, H = c.ahead, K = c.k, iv = CF.interval();
    var usePool = c.pool === 'tf' && anPool.sym === CF.symbol() && anPool.list.length > 0;
    var key = n + '|' + (n ? cs[n - 1].time + '|' + cs[n - 1].close : 0) + '|' + L + '|' + H + '|' + K + '|' + c.pool + '|' + (usePool ? anPool.at : 0);
    if (key === an.key) return;
    an.key = key; an.res = null;
    if (n < L * 3 + H) return;
    var own = anSeries(iv, CF.secs(), cs.map(function (k) { return k.time; }), cs.map(function (k) { return k.close; }), true);
    var p = own.p, S1 = own.S1, S2 = own.S2;
    var q = n - 1, st = stats(S1, S2, q, L); if (!(st[1] > 0)) return;
    var z = new Array(L), j;
    for (j = 0; j < L; j++) z[j] = (p[q - L + 1 + j] - st[0]) / st[1];
    var series = [own];
    if (usePool) anPool.list.forEach(function (s) { if (s.iv !== iv && s.c.length >= L + H + 1) series.push(anSeries(s.iv, s.sec, s.t, s.c, false)); });
    var ms = anMatchAll(series, z, L, H, K);
    if (!ms.length) return;
    var vq = retSd(p, q, L);
    var paths = ms.map(function (m) {
        // to today's size: the move times (today's bar-to-bar spread / the match's); a 1-minute look-alike moves far less per
        // bar than a 4-hour one, so across intervals the ratio is wide, clamped only against freak values
        var sp = m.s.p, vc = retSd(sp, m.e, L), k = vc > 0 ? Math.max(0.05, Math.min(20, vq / vc)) : 1, path = [], hi = -Infinity, lo = Infinity;
        for (var h = 1; h <= H; h++) { var v = (sp[m.e + h] - sp[m.e]) * k; path.push(v); if (v > hi) hi = v; if (v < lo) lo = v; }
        return { e: m.e, r: m.r, iv: m.s.iv, own: m.s.own, t0: m.s.t[m.e - L + 1], t1: m.s.t[m.e], path: path, raw: sp[m.e + H] - sp[m.e], hi: hi, lo: lo };
    });
    var med = [], lo = [], hi = [];
    for (var h = 0; h < H; h++) {
        var col_ = paths.map(function (x) { return x.path[h]; });
        med.push(quant(col_, 0.5)); lo.push(quant(col_, 0.25)); hi.push(quant(col_, 0.75));
    }
    var ends = paths.map(function (x) { return x.path[H - 1]; });
    an.res = {
        last: cs[n - 1], paths: paths, med: med, lo: lo, hi: hi, H: H, L: L, pool: usePool,
        up: ends.filter(function (v) { return v > 0; }).length, k: paths.length,
        r: paths.reduce(function (a, x) { return a + x.r; }, 0) / paths.length
    };
    anTest(cs, p, S1, S2, L, H, K);
}
// The same method run on this chart's own past: at evenly spaced points, using only the candles before each point, did the
// middle of the matches point the way the price then went over the next H candles? Recomputed when the inputs change.
function anTest(cs, p, S1, S2, L, H, K) {
    var n = cs.length, key = n + '|' + (n ? cs[0].time : 0) + '|' + L + '|' + H + '|' + K + '|' + CF.interval();
    if (key === an.testKey) return;
    an.testKey = key; an.test = null;
    var start = L * 3 + H, end = n - 1 - H, step = Math.max(1, Math.floor((end - start) / 200)), hit = 0, tot = 0, up = 0;
    for (var q = start; q <= end; q += step) {
        var ms = matches(p, S1, S2, q, L, H, K, q);
        if (ms.length < 3) continue;
        var ends = ms.map(function (m) { return p[m.e + H] - p[m.e]; }), med = quant(ends, 0.5), real = p[q + H] - p[q];
        if (med === 0 || real === 0) continue;
        tot++; if ((med > 0) === (real > 0)) hit++; if (real > 0) up++;
    }
    if (tot >= 20) an.test = { n: tot, hit: hit / tot * 100, up: up / tot * 100 };
}
function anPaint(ctx, w, h) {
    var r = an.res; if (!r) return;
    var c = CF.S('analog'), sec = CF.secs(), last = r.last, base = last.close, x0 = CF.xOf(last.time), y0 = CF.yOf(base);
    if (x0 == null || y0 == null) return;
    var pt = function (k, v) { return { x: CF.xOf(last.time + (k + 1) * sec), y: CF.yOf(base * Math.exp(v)) }; };
    var color = c.color;
    if (c.band) {
        ctx.beginPath(); ctx.moveTo(x0, y0);
        var k, q;
        for (k = 0; k < r.H; k++) { q = pt(k, r.hi[k]); if (q.x == null || q.y == null) return; ctx.lineTo(q.x, q.y); }
        for (k = r.H - 1; k >= 0; k--) { q = pt(k, r.lo[k]); ctx.lineTo(q.x, q.y); }
        ctx.closePath(); ctx.fillStyle = CF.hexA(color, 0.14); ctx.fill();
    }
    if (c.paths) {
        // one colour and number per look-alike (the same numbers as the list), the most alike drawn last, on top
        var ends = [];
        ctx.lineWidth = 1.2;
        for (var pi = r.paths.length - 1; pi >= 0; pi--) {
            var x = r.paths[pi], pc = AN_PAL[pi % AN_PAL.length], q2 = null;
            ctx.strokeStyle = CF.hexA(pc, 0.7); ctx.beginPath(); ctx.moveTo(x0, y0);
            // the number goes where the line leaves the screen (or ends), not where the off-screen end would be
            x.path.forEach(function (v, k) { var q = pt(k, v); if (q.x != null && q.y != null) { ctx.lineTo(q.x, q.y); if (q.x <= w - 4) q2 = q; } });
            ctx.stroke();
            if (q2) ends.push({ x: q2.x, y: q2.y, n: pi + 1, c: pc });
        }
        // the number at each line's end, nudged apart so they do not sit on each other
        ends.sort(function (a, b) { return a.y - b.y; });
        var lastY = -1e9;
        ctx.font = '600 9px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
        ends.forEach(function (e) {
            var y = Math.max(e.y, lastY + 10); lastY = y;
            var t = '#' + e.n, tx = Math.min(e.x + 3, w - ctx.measureText(t).width - 2);
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(19,23,34,.92)'; ctx.strokeText(t, tx, y);
            ctx.fillStyle = e.c; ctx.fillText(t, tx, y);
        });
    }
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    r.med.forEach(function (v, k) { var q = pt(k, v); if (q.x != null && q.y != null) ctx.lineTo(q.x, q.y); });
    ctx.stroke(); ctx.setLineDash([]);
    if (c.marks) {
        ctx.fillStyle = CF.hexA(color, 0.55);
        r.paths.forEach(function (x) {
            if (!x.own) return;                                              // found on another interval: not on this chart
            var a = CF.xOf(x.t0), b = CF.xOf(x.t1);
            if (a == null || b == null || b < 0 || a > w) return;
            ctx.fillRect(a, h - 5, Math.max(2, b - a), 3);
        });
    }
}
function anLegend() {
    var r = an.res, c = CF.S('analog');
    if (!r) return muted(CF.candles().length ? '비교할 봉이 모자라요 (봉 ' + (c.len * 3 + c.ahead) + '개 이상)' : '');
    var where = r.pool ? '1분~4시간' : c.pool === 'tf' && anPool.busy ? '이 차트 (다른 봉 받는 중)' : '';
    var end = Math.exp(r.med[r.H - 1]) - 1, h = span(c.color, '닮은 구간 ' + r.k + '개') + ' ' + muted((where ? '· ' + where + ' ' : '') + '· 유사도 ' + r.r.toFixed(2) + ' · ' + r.H + '봉 뒤 중간값') + ' ' +
        span(col(end), pctS(end * 100)) + ' ' + muted('· 오른 구간 ' + r.up + '/' + r.k);
    // next to the plain baseline: always naming the side that was more common in that stretch would have scored this much
    if (an.test) h += ' ' + muted('· 같은 방법으로 과거에 방향 맞춘 비율 ' + Math.round(an.test.hit) + '% (' + an.test.n + '번, 늘 많았던 쪽만 골랐으면 ' + Math.round(Math.max(an.test.up, 100 - an.test.up)) + '%)');
    return h;
}
// the look-alikes one by one: where each was found, how alike, what followed it as it was and at today's size
function anWhen(t) { var d = new Date(t * 1000); return CF.pad2(d.getMonth() + 1) + '.' + CF.pad2(d.getDate()) + ' ' + CF.pad2(d.getHours()) + ':' + CF.pad2(d.getMinutes()); }
function anPct(v) { var x = (Math.exp(v) - 1) * 100; return span(col(x), pctS(x, Math.abs(x) >= 10 ? 1 : 2)); }
function anOpen() {
    var r = an.res, c = CF.S('analog'), rows = [];
    var cfg = document.createElement('button'); cfg.className = 'row-opt';
    cfg.innerHTML = '<span>⚙ 닮은 흐름 설정<small>비교할 봉 수 · 찾을 곳 · 표시</small></span><span style="color:var(--muted)">›</span>';
    cfg.onclick = function () { CF.openSettings('analog'); };
    if (!r) {
        rows.push(CF.noteRow(CF.candles().length ? '아직 닮은 구간이 없어요. 불러온 봉이 ' + (c.len * 3 + c.ahead) + '개 이상이어야 찾아요.' : '봉을 불러오는 중이에요.'), cfg);
        CF.openSheet('닮은 흐름', rows); return;
    }
    var ends = r.paths.map(function (x) { return x.path[r.H - 1]; }), up = ends.filter(function (v) { return v > 0; }).length;
    var sum = document.createElement('div'); sum.className = 'note'; sum.style.lineHeight = '1.6';
    sum.innerHTML = '최근 ' + r.L + '봉과 닮은 구간 ' + r.k + '개 (' + (r.pool ? '이 코인 1분~4시간' : '이 차트 봉') + ') · ' + r.H + '봉 뒤 ' +
        span(CF.C.up, '오름 ' + up) + ' / ' + span(CF.C.down, '내림 ' + (r.k - up)) + ' · 중간값 ' + anPct(r.med[r.H - 1]) +
        ' · 중간 절반 ' + anPct(r.lo[r.H - 1]) + ' ~ ' + anPct(r.hi[r.H - 1]) +
        (an.test ? '<br>이 차트에서 같은 방법으로 과거에 방향을 맞춘 비율 ' + Math.round(an.test.hit) + '% (' + an.test.n + '번 · 늘 많았던 쪽만 골랐으면 ' + Math.round(Math.max(an.test.up, 100 - an.test.up)) + '%)' : '');
    rows.push(sum);
    rows.push(CF.noteRow(AN_BT));
    var tb = document.createElement('div'); tb.style.cssText = 'overflow-x:auto;margin:4px 0 8px';
    var th = 'style="text-align:right;padding:4px 5px;font-weight:500;color:var(--muted);white-space:nowrap"', td = 'style="text-align:right;padding:5px;white-space:nowrap"';
    var h = '<table style="width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums">' +
        '<tr><th ' + th + '>#</th><th ' + th + '>봉</th><th ' + th + '>구간 끝</th><th ' + th + '>닮음</th><th ' + th + '>이후 ' + r.H + '봉</th><th ' + th + '>지금 크기로</th><th ' + th + '>중간 최고 / 최저</th></tr>';
    r.paths.forEach(function (x, i) {
        h += '<tr data-i="' + i + '" style="border-top:1px solid var(--line)' + (x.own ? ';cursor:pointer' : '') + '">' +
            '<td ' + td + '><b style="color:' + AN_PAL[i % AN_PAL.length] + '">#' + (i + 1) + '</b></td><td ' + td + '>' + x.iv + '</td><td ' + td + '>' + anWhen(x.t1) + '</td>' +
            '<td ' + td + '>' + Math.round(x.r * 100) + '%</td><td ' + td + '>' + anPct(x.raw) + '</td><td ' + td + '>' + anPct(x.path[r.H - 1]) + '</td>' +
            '<td ' + td + '>' + anPct(x.hi) + ' / ' + anPct(x.lo) + '</td></tr>';
    });
    tb.innerHTML = h + '</table>';
    tb.onclick = function (e) {
        var tr = e.target.closest('tr[data-i]'); if (!tr) return;
        var x = r.paths[+tr.getAttribute('data-i')]; if (!x || !x.own) return;
        var i1 = CF.indexOfTime(x.t1); if (i1 == null || i1 < 0) return;
        CF.closeSheet();
        CF.chart.timeScale().setVisibleLogicalRange({ from: i1 - r.L - 15, to: i1 + r.H + 15 });
    };
    rows.push(tb);
    rows.push(CF.noteRow('"지금 크기로"는 그 구간 뒤 움직임을 지금 봉의 움직임 크기에 맞춘 값이고, 차트의 선과 띠는 이 값으로 그립니다. 이 차트 봉에서 찾은 줄을 누르면 그 자리로 갑니다.'));
    rows.push(cfg);
    CF.openSheet('닮은 흐름 · 닮은 구간', rows);
}
// tools/backtest/Analog.java, results-2026-11-25-analog.txt: 10 Binance coins, last 90 days, 5m / 15m / 1h, ~15,000 points per pool
var AN_BT = '백테스트 (바이낸스 10개 코인 · 최근 90일 · 5분 · 15분 · 1시간봉 약 1만 5천 번): 닮은 구간의 중간값이 방향을 맞힌 비율은 50~55%로, ' +
    '그 기간에 늘 더 많았던 쪽만 고른 54~57%보다 낮았어요. 닮은 구간이 70% 넘게 한쪽으로 몰려도, 1분~4시간이나 여러 코인에서 찾아도 같았어요. ' +
    '실제 움직임이 띠(중간 절반) 안에 든 비율은 41~48%(이론상 50%)라, 방향보다는 흔들릴 폭을 보는 데 맞아요.';
var anOffset = null;
function anSync() {
    var ts = CF.chart.timeScale();
    if (CF.ind.analog) {
        anPoolLoad();
        anCompute();
        if (!an.off) an.off = CF.layer('top', anPaint);
        // room on the right for the band, but never more than a third of the width: counted from the width and bar spacing,
        // since the visible range already includes the empty room (and is not known yet on the first call)
        var o = ts.options(), w = ts.width(), slots = w > 0 && o.barSpacing > 0 ? w / o.barSpacing : 60;
        if (anOffset == null) anOffset = o.rightOffset;
        var want = Math.max(anOffset, Math.min(CF.S('analog').ahead + 4, Math.max(6, Math.floor(slots / 3))));
        if (o.rightOffset !== want) ts.applyOptions({ rightOffset: want });
        CF.redrawNow();
    } else if (an.off) {
        an.off(); an.off = null; an.res = null; an.key = '';
        if (anOffset != null) { ts.applyOptions({ rightOffset: anOffset }); anOffset = null; }
    }
    CF.scheduleLegend();
}

// =====================================================================================================
// 3. Key levels: the previous day's and week's high and low, today's (and this week's) open
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
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(19,23,34,.92)'; ctx.strokeText(l.n, w - 6, ty);
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

// ---- wiring --------------------------------------------------------------------------------------------------------
CF.onData(function (kind) {
    if (kind === 'new' && CF.ind.levels) lvLoad();                     // a new day or week starts on a candle open
    if (kind === 'last') {
        // the forming candle moved: the band starts at its close, so only the drawing and the analog's end point follow
        if (an.res && CF.ind.analog) { an.key = ''; anCompute(); CF.redraw(); }
        return;
    }
    exhSync(); anSync(); lvSync();
});
CF.legendItems(function (i) {
    var out = [];
    [['levels', '레벨', lvLegend], ['exh', '소진', exhLegend], ['analog', '닮은 흐름', anLegend]].forEach(function (x) {
        var k = x[0];
        if (!CF.ind[k] && !CF.isHidden(k)) return;
        var v = CF.ind[k] ? x[2](i) : '';
        var it = CF.builtinItem(k, '<b>' + x[1] + '</b>' + (v ? ' ' + v : ''));
        if (k === 'analog') it.settings = anOpen;                       // ⚙ opens the list of look-alikes (with the settings in it)
        out.push(it);
    });
    return out;
});
window.__sig = { exh: exh, an: an, lv: lv, pool: anPool };
})();
