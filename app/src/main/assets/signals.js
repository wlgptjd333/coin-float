// Two overlays on the price chart, built from the candles alone (so they work on every venue):
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
        { k: 'k', t: 'num', label: '찾을 닮은 구간 수', def: 8, min: 3, max: 20, step: 1 },
        { t: 'sec', label: '표시' },
        { k: 'band', t: 'bool', label: '범위 띠 (중간 절반)', sub: '닮은 구간들 뒤 움직임의 25~75% 범위', def: true },
        { k: 'paths', t: 'bool', label: '구간마다 이어진 선', def: false },
        { k: 'marks', t: 'bool', label: '닮은 과거 구간 위치 표시', sub: '차트 아래쪽에 짧은 막대로', def: true },
        { k: 'color', t: 'color', label: '색', def: VIOLET },
        { t: 'note', label: '최근 봉들의 모양(로그 가격을 평균 0, 크기 1로 맞춘 것)과 가장 닮은 과거 구간을 불러온 봉 안에서 찾고, 그 구간들 바로 뒤에 실제로 움직인 비율을 지금 가격에 이어 그립니다. 변동성이 다른 구간은 최근 변동성에 맞춰 키우거나 줄입니다(0.5~2배).' },
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
function anCompute() {
    var cs = CF.candles(), n = cs.length, c = CF.S('analog'), L = c.len, H = c.ahead, K = c.k;
    var key = n + '|' + (n ? cs[n - 1].time + '|' + cs[n - 1].close : 0) + '|' + L + '|' + H + '|' + K;
    if (key === an.key) return;
    an.key = key; an.res = null;
    if (n < L * 3 + H) return;
    var p = logs(cs), S1 = [0], S2 = [0], i;
    for (i = 0; i < n; i++) { S1.push(S1[i] + p[i]); S2.push(S2[i] + p[i] * p[i]); }
    var q = n - 1, ms = matches(p, S1, S2, q, L, H, K, n - 1);
    if (!ms.length) return;
    var vq = retSd(p, q, L);
    var paths = ms.map(function (m) {
        var vc = retSd(p, m.e, L), k = vc > 0 ? Math.max(0.5, Math.min(2, vq / vc)) : 1, path = [];
        for (var h = 1; h <= H; h++) path.push((p[m.e + h] - p[m.e]) * k);          // log move, scaled to today's volatility
        return { e: m.e, r: m.r, t0: cs[m.e - L + 1].time, t1: cs[m.e].time, path: path };
    });
    var med = [], lo = [], hi = [];
    for (var h = 0; h < H; h++) {
        var col_ = paths.map(function (x) { return x.path[h]; });
        med.push(quant(col_, 0.5)); lo.push(quant(col_, 0.25)); hi.push(quant(col_, 0.75));
    }
    var ends = paths.map(function (x) { return x.path[H - 1]; });
    an.res = {
        last: cs[n - 1], paths: paths, med: med, lo: lo, hi: hi, H: H,
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
        ctx.lineWidth = 1; ctx.strokeStyle = CF.hexA(color, 0.35);
        r.paths.forEach(function (x) {
            ctx.beginPath(); ctx.moveTo(x0, y0);
            x.path.forEach(function (v, k) { var q = pt(k, v); if (q.x != null && q.y != null) ctx.lineTo(q.x, q.y); });
            ctx.stroke();
        });
    }
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    r.med.forEach(function (v, k) { var q = pt(k, v); if (q.x != null && q.y != null) ctx.lineTo(q.x, q.y); });
    ctx.stroke(); ctx.setLineDash([]);
    if (c.marks) {
        ctx.fillStyle = CF.hexA(color, 0.55);
        r.paths.forEach(function (x) {
            var a = CF.xOf(x.t0), b = CF.xOf(x.t1);
            if (a == null || b == null || b < 0 || a > w) return;
            ctx.fillRect(a, h - 5, Math.max(2, b - a), 3);
        });
    }
}
function anLegend() {
    var r = an.res, c = CF.S('analog');
    if (!r) return muted(CF.candles().length ? '비교할 봉이 모자라요 (봉 ' + (c.len * 3 + c.ahead) + '개 이상)' : '');
    var end = Math.exp(r.med[r.H - 1]) - 1, h = span(c.color, '닮은 구간 ' + r.k + '개') + ' ' + muted('· 유사도 ' + r.r.toFixed(2) + ' · ' + r.H + '봉 뒤 중간값') + ' ' +
        span(col(end), pctS(end * 100)) + ' ' + muted('· 오른 구간 ' + r.up + '/' + r.k);
    // next to the plain baseline: always naming the side that was more common in that stretch would have scored this much
    if (an.test) h += ' ' + muted('· 같은 방법으로 과거에 방향 맞춘 비율 ' + Math.round(an.test.hit) + '% (' + an.test.n + '번, 늘 많았던 쪽만 골랐으면 ' + Math.round(Math.max(an.test.up, 100 - an.test.up)) + '%)');
    return h;
}
var anOffset = null;
function anSync() {
    var ts = CF.chart.timeScale();
    if (CF.ind.analog) {
        anCompute();
        if (!an.off) an.off = CF.layer('top', anPaint);
        // room on the right for the band, but never more than a third of what is on screen
        var vr = ts.getVisibleLogicalRange(), shown = vr ? vr.to - vr.from : 60;
        var want = Math.min(CF.S('analog').ahead + 4, Math.max(6, Math.floor(shown / 3))), cur = ts.options().rightOffset;
        if (anOffset == null) anOffset = cur;
        if (cur < want) ts.applyOptions({ rightOffset: want });
        CF.redrawNow();
    } else if (an.off) {
        an.off(); an.off = null; an.res = null; an.key = '';
        if (anOffset != null) { ts.applyOptions({ rightOffset: anOffset }); anOffset = null; }
    }
    CF.scheduleLegend();
}

// ---- wiring --------------------------------------------------------------------------------------------------------
CF.onData(function (kind) {
    if (kind === 'last') {
        // the forming candle moved: the band starts at its close, so only the drawing and the analog's end point follow
        if (an.res && CF.ind.analog) { an.key = ''; anCompute(); CF.redraw(); }
        return;
    }
    exhSync(); anSync();
});
CF.legendItems(function (i) {
    var out = [];
    [['exh', '소진', exhLegend], ['analog', '닮은 흐름', anLegend]].forEach(function (x) {
        var k = x[0];
        if (!CF.ind[k] && !CF.isHidden(k)) return;
        var v = CF.ind[k] ? x[2](i) : '';
        out.push(CF.builtinItem(k, '<b>' + x[1] + '</b>' + (v ? ' ' + v : '')));
    });
    return out;
});
window.__sig = { exh: exh, an: an };
})();
