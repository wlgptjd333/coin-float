// Chart alerts: the 🔔 sheet lists, adds and edits the rules; the app stores them and checks them at every candle close
// (AlarmManager, also while the app is closed) and posts a notification. Fired alerts are marked on the chart.
// Kinds: volume spike, divergence (RSI / MACD / CVD / volume, regular / hidden), N-candle high / low breakout,
// price level or a drawn line crossed.
(function () {
'use strict';
var CF = window.CF; if (!CF) return;
var LS = CF.LS;
var IVS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'];
var IV_LABEL = { '1m': '1분', '3m': '3분', '5m': '5분', '15m': '15분', '30m': '30분', '1h': '1시간', '2h': '2시간', '4h': '4시간', '6h': '6시간', '12h': '12시간', '1d': '일봉', '1w': '주봉' };
var SRC_LABEL = { rsi: 'RSI', macd: 'MACD', cvd: 'CVD', vol: '거래량' };

// ---- storage: the app (bridge); in a desktop browser a local copy so the page can be tried out -------------------------
var B = window.AndroidBridge;
var hasBridge = !!(B && typeof B.alertsGet === 'function');
var data = { rules: [], history: [], exact: true, notif: true };
function load() {
    try { var t = hasBridge ? B.alertsGet('') : JSON.stringify(Object.assign({ exact: true, notif: true }, LS.get('alertsDev', { rules: [], history: [] }))); data = JSON.parse(t) || data; }
    catch (e) { /* keep what we had */ }
    data.rules = Array.isArray(data.rules) ? data.rules : []; data.history = Array.isArray(data.history) ? data.history : [];
    refreshBadge(); refreshMarkers();
}
function store() {
    if (hasBridge) { try { B.alertsPut(JSON.stringify(data.rules)); } catch (e) { CF.toast('알람을 저장하지 못했어요'); } }
    else LS.set('alertsDev', { rules: data.rules, history: data.history });
    refreshBadge();
}
function action(a) { if (hasBridge && typeof B.alertsAction === 'function') { try { B.alertsAction(a); } catch (e) { /* ignore */ } } }
function uid() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function base(sym) { return String(sym).replace(/USDT$/, ''); }
function curIv() { var i = CF.interval(); return IVS.indexOf(i) >= 0 ? i : '15m'; }

// ---- describing a rule ---------------------------------------------------------------------------------------------------
function dirText(r, a, b) { return r.up && r.down ? a + '·' + b : r.up ? a : b; }
function describe(r) {
    if (r.kind === 'vol') return '거래량 급증 · 평균의 ' + r.mult + '배 이상';
    if (r.kind === 'div') return SRC_LABEL[r.src] + ' 다이버전스 · ' + [r.reg ? '일반' : '', r.hid ? '히든' : ''].filter(Boolean).join('·') + ' · ' + dirText(r, '상승', '하락');
    if (r.kind === 'brk') return r.len + '봉 ' + dirText(r, '고점 돌파', '저점 이탈') + (r.volMult ? ' · 거래량 확인' : '');
    if (r.kind === 'line') return (r.label || CF.fmtPrice(r.p1)) + ' ' + dirText(r, '상향 돌파', '하향 이탈');
    return r.kind;
}

// ---- toolbar badge and chart markers -------------------------------------------------------------------------------------
function refreshBadge() {
    var btn = document.getElementById('alert_btn'); if (!btn) return;
    btn.classList.toggle('has', data.rules.some(function (r) { return r.on && r.symbol === CF.symbol(); }));
}
var markers = null, markersOn = null;
function refreshMarkers() {
    var ms = CF.mainSeries(), sym = CF.symbol(), iv = CF.interval();
    if (markers && markersOn !== ms) { try { markers.detach(); } catch (e) { /* gone */ } markers = null; }
    var list = data.history.filter(function (e) { return e.symbol === sym && e.interval === iv; }).map(function (e) {
        return { time: Math.floor(e.t / 1000), position: 'aboveBar', shape: 'circle', color: '#F0B90B', size: 0.6, text: '🔔' + (e.marker || '') };
    }).sort(function (a, b) { return a.time - b.time; });
    if (!list.length && !markers) return;
    if (!markers) { markers = CF.LW.createSeriesMarkers(ms, []); markersOn = ms; }
    markers.setMarkers(list);
}
CF.onData(function (kind) { if (kind === 'all') { refreshMarkers(); refreshBadge(); } });

// ---- the sheet --------------------------------------------------------------------------------------------------------------
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmtTime(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + CF.pad2(d.getHours()) + ':' + CF.pad2(d.getMinutes()); }
function ruleRow(r, showSym) {
    var row = el('div', 'row-opt');
    row.innerHTML = '<span style="flex:1;min-width:0">' + (showSym ? '<b>' + esc(base(r.symbol)) + '</b> ' : '') + esc(IV_LABEL[r.interval] || r.interval) + ' · ' + esc(describe(r)) +
        (r.once ? '<small>한 번 울리면 꺼짐</small>' : '') + '</span><span class="switch' + (r.on ? ' on' : '') + '"></span><button class="x" aria-label="삭제" style="padding:4px 6px;color:var(--muted)">✕</button>';
    row.querySelector('.switch').onclick = function (e) { e.stopPropagation(); r.on = !r.on; store(); openList(); };
    row.querySelector('.x').onclick = function (e) { e.stopPropagation(); data.rules = data.rules.filter(function (x) { return x !== r; }); store(); openList(); };
    row.onclick = function () { openForm(r); };
    return row;
}
function openList() {
    load();
    var sym = CF.symbol(), rows = [];
    if (!data.notif) rows.push(warnRow('알림이 꺼져 있어 알람이 와도 보이지 않아요', '알림 켜기', 'notif'));
    if (!data.exact) rows.push(warnRow('정확한 시간 알람이 꺼져 있어 몇 분 늦게 울릴 수 있어요', '허용하기', 'exact'));
    rows.push(CF.sectionTitle(base(sym) + ' 알람'));
    var mine = data.rules.filter(function (r) { return r.symbol === sym; });
    mine.forEach(function (r) { rows.push(ruleRow(r, false)); });
    if (!mine.length) rows.push(CF.noteRow('아직 없어요. 아래에서 추가하거나, 그린 수평선·추세선을 눌러 "🔔 알람"으로 만들 수 있어요.'));
    var add = el('button', 'reset', '＋ 알람 추가'); add.onclick = function () { openForm(null); }; rows.push(add);
    var others = data.rules.filter(function (r) { return r.symbol !== sym; });
    if (others.length) { rows.push(CF.sectionTitle('다른 코인')); others.forEach(function (r) { rows.push(ruleRow(r, true)); }); }
    if (data.history.length) {
        rows.push(CF.sectionTitle('최근 울린 알람'));
        data.history.slice(0, 15).forEach(function (e) {
            rows.push(el('div', 'row-opt', '<span style="flex:1;min-width:0"><b>' + esc(base(e.symbol)) + '</b> ' + esc(IV_LABEL[e.interval] || e.interval) + ' · ' + esc(e.title) +
                '<small>' + esc(e.detail) + ' · ' + fmtTime(e.at) + '</small></span>'));
        });
        var clr = el('button', 'reset', '기록 지우기'); clr.onclick = function () { action('clear'); data.history = []; if (!hasBridge) store(); refreshMarkers(); openList(); };
        rows.push(clr);
    }
    rows.push(CF.noteRow('봉이 마감될 때마다 확인하고, 앱을 닫아도 알림으로 알려줍니다. 화면이 꺼진 채 오래 두면 휴대폰 절전 때문에 몇 분 늦을 수 있어요. 알람은 매매 조언이 아니라 관찰 도구입니다.'));
    CF.openSheet('알람', rows);
}
function warnRow(text, btn, act) {
    var r = el('div', 'row-opt', '<span style="flex:1;color:#F0B90B">' + esc(text) + '</span><button class="tag" style="color:var(--accent)">' + esc(btn) + '</button>');
    r.querySelector('button').onclick = function () { action(act); };
    return r;
}

// ---- the add / edit form -------------------------------------------------------------------------------------------------
function seg(label, opts, cur, set) {
    var f = el('div', 'fld', '<div class="top"><span>' + esc(label) + '</span></div><div class="seg"></div>'), s = f.querySelector('.seg');
    opts.forEach(function (o) { var b = el('button', o[0] === cur ? 'on' : '', esc(o[1])); b.onclick = function () { set(o[0]); }; s.appendChild(b); });
    return f;
}
function toggle(label, on, set, sub) {
    var f = el('div', 'fld', '<div class="top"><span>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="switch' + (on ? ' on' : '') + '"></span></div>');
    f.onclick = function () { set(!on); };
    return f;
}
function numField(label, v, set) {
    var f = el('div', 'fld', '<div class="top"><span>' + esc(label) + '</span><input type="number" inputmode="decimal" step="any" value="' + v + '"></div>');
    var inp = f.querySelector('input'); inp.onchange = function () { var n = parseFloat(inp.value); if (isFinite(n) && n > 0) set(n); };
    return f;
}
var draft = null;
function lastClose() { var cs = CF.candles(); return cs.length ? cs[cs.length - 1].close : 0; }
function openForm(rule, preset) {
    if (rule) draft = { orig: rule, r: JSON.parse(JSON.stringify(rule)) };
    else {
        var p = lastClose();
        draft = { orig: null, r: Object.assign({ id: uid(), symbol: CF.symbol(), interval: curIv(), kind: 'vol', on: true, once: false, mult: 3, src: 'rsi', reg: true, hid: false,
            up: true, down: true, len: 50, right: 3, volMult: 1.5, t1: 0, p1: +CF.fmtPrice(p).replace(/,/g, '') || p, t2: 0, p2: 0, label: '', drawing: '' }, preset || {}) };
    }
    renderForm();
}
function renderForm() {
    var r = draft.r, rows = [], rr = function () { renderForm(); };
    var fromLine = !!r.drawing;
    if (!fromLine) rows.push(seg('종류', [['vol', '거래량 급증'], ['div', '다이버전스'], ['brk', '고점·저점 돌파'], ['line', '가격 돌파']], r.kind, function (k) {
        r.kind = k; if (k === 'line') { r.once = true; if (!(r.p1 > 0)) r.p1 = lastClose(); r.p2 = r.p1; r.t1 = r.t2 = 0; } rr();
    }));
    rows.push(seg('확인할 봉', IVS.map(function (i) { return [i, IV_LABEL[i]]; }), r.interval, function (i) { r.interval = i; rr(); }));
    if (r.kind === 'vol') {
        rows.push(seg('직전 20봉 평균의 몇 배 이상', [[2, '2배'], [3, '3배'], [5, '5배'], [10, '10배']].map(function (o) { return [o[0], o[1]]; }), r.mult, function (m) { r.mult = m; rr(); }));
        rows.push(numField('직접 입력 (배)', r.mult, function (n) { r.mult = Math.max(1.2, Math.min(50, n)); }));
    } else if (r.kind === 'div') {
        rows.push(seg('지표', [['rsi', 'RSI'], ['macd', 'MACD'], ['cvd', 'CVD'], ['vol', '거래량']], r.src, function (s) { r.src = s; if (s === 'vol') { r.reg = true; r.hid = false; } rr(); }));
        rows.push(toggle('일반 다이버전스', r.reg, function (v) { r.reg = v; if (!v && !r.hid) r.hid = true; rr(); }, '가격은 새 고점(저점)인데 지표는 못 따라감 · 추세 전환 신호'));
        if (r.src !== 'vol') rows.push(toggle('히든 다이버전스', r.hid, function (v) { r.hid = v; if (!v && !r.reg) r.reg = true; rr(); }, '가격은 고점(저점)을 못 넘었는데 지표는 넘음 · 추세 지속 신호'));
        rows.push(toggle('상승(강세) 다이버전스', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
        rows.push(toggle('하락(약세) 다이버전스', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
        rows.push(seg('고점·저점 확인에 필요한 봉 수', [[2, '2'], [3, '3'], [5, '5']], r.right, function (n) { r.right = n; rr(); }));
        rows.push(CF.noteRow('다이버전스는 고점·저점이 확정된 뒤에 알 수 있어서, 그 봉 수만큼 늦게 울립니다. 작을수록 빠르지만 잘못된 신호가 늘어요. 기준은 트레이딩뷰 다이버전스 지표와 같습니다(왼쪽 5봉, 두 고점·저점 사이 5~60봉).'));
    } else if (r.kind === 'brk') {
        rows.push(seg('기준 기간', [[20, '20봉'], [50, '50봉'], [100, '100봉'], [200, '200봉']], r.len, function (n) { r.len = n; rr(); }));
        rows.push(toggle('고점 돌파 (직전 최고가 위로 마감)', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
        rows.push(toggle('저점 이탈 (직전 최저가 아래로 마감)', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
        rows.push(toggle('거래량이 평균의 1.5배 이상일 때만', r.volMult > 0, function (v) { r.volMult = v ? 1.5 : 0; rr(); }, '거래량 없는 가짜 돌파를 거릅니다'));
    } else if (r.kind === 'line') {
        if (fromLine) rows.push(CF.noteRow((r.t1 === r.t2 || r.p1 === r.p2 ? '수평선 ' + CF.fmtPrice(r.p1) : '추세선 (오른쪽으로 연장)') + ' · 선을 옮기면 알람도 따라갑니다'));
        else rows.push(numField('가격', r.p1, function (n) { r.p1 = r.p2 = n; r.label = ''; }));
        rows.push(toggle('위로 돌파 (선 위에서 마감)', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
        rows.push(toggle('아래로 이탈 (선 아래에서 마감)', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
    }
    rows.push(toggle('한 번 울리면 끄기', r.once, function (v) { r.once = v; rr(); }));
    var foot = el('div', 'dfoot', '<div class="drow"><button class="cancel">취소</button><span style="flex:1"></span><button class="ok">' + (draft.orig ? '저장' : '알람 켜기') + '</button></div>');
    foot.querySelector('.cancel').onclick = function () { draft = null; openList(); };
    foot.querySelector('.ok').onclick = function () {
        var rule = draft.r; rule.on = true;
        if (draft.orig) data.rules = data.rules.map(function (x) { return x === draft.orig ? rule : x; });
        else data.rules.push(rule);
        if (data.rules.length > 100) { CF.toast('알람은 100개까지 만들 수 있어요'); data.rules.pop(); return; }
        store(); draft = null; openList();
        CF.toast(base(rule.symbol) + ' ' + (IV_LABEL[rule.interval] || rule.interval) + ' 알람을 켰어요 · 다음 봉 마감부터 확인');
    };
    CF.openSheet(draft.orig ? '알람 수정' : '알람 추가 · ' + base(r.symbol), rows, foot);
}

// ---- lines drawn on the chart --------------------------------------------------------------------------------------------
function lineOf(d) {
    var a = d.a, b = d.b || d.a;
    var horiz = d.type === 'hline';
    return { t1: horiz ? 0 : Math.round(a.time * 1000), p1: a.price, t2: horiz ? 0 : Math.round(b.time * 1000), p2: horiz ? a.price : b.price,
        label: horiz ? '수평선 ' + CF.fmtPrice(a.price) : (d.type === 'ray' ? '연장선' : '추세선') };
}
CF.onDrawingAlert(function (d) {
    var existing = data.rules.filter(function (r) { return r.symbol === CF.symbol() && r.drawing === String(d.id); })[0];
    if (existing) { openForm(existing); return; }
    openForm(null, Object.assign({ kind: 'line', once: true, drawing: String(d.id) }, lineOf(d)));
});
// moving a line moves its alert; deleting it deletes the alert
CF.onDrawingsSaved(function (sym, list) {
    var changed = false;
    data.rules = data.rules.filter(function (r) {
        if (r.symbol !== sym || !r.drawing) return true;
        var d = list.filter(function (x) { return String(x.id) === r.drawing; })[0];
        if (!d) { changed = true; return false; }
        var l = lineOf(d);
        if (l.t1 !== r.t1 || l.p1 !== r.p1 || l.t2 !== r.t2 || l.p2 !== r.p2) { Object.assign(r, l); changed = true; }
        return true;
    });
    if (changed) store();
});

var btn = document.getElementById('alert_btn');
if (btn) btn.onclick = openList;
load();
// fired alerts arrive while the page is open: pick them up now and then (a cheap read from the app's storage)
setInterval(function () { if (CF.active() && !document.hidden) load(); }, 60000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
window.__alerts = { data: function () { return data; }, openList: openList, openForm: openForm, load: load };
})();
