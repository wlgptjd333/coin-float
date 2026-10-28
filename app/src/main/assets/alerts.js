// Chart alerts: the 🔔 sheet lists, adds and edits the rules; the app stores them and checks them at every candle close
// (AlarmManager, also while the app is closed) and posts a notification. Fired alerts are marked on the chart.
// Kinds: volume spike, divergence (RSI / MACD / CVD / volume, regular / hidden), N-candle high / low breakout,
// price level or a drawn line crossed.
(function () {
'use strict';
var CF = window.CF; if (!CF) return;
var LS = CF.LS;
var IVS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w'];
var IV_LABEL = { '1m': '1분', '3m': '3분', '5m': '5분', '15m': '15분', '30m': '30분', '1h': '1시간', '2h': '2시간', '4h': '4시간', '6h': '6시간', '8h': '8시간', '12h': '12시간', '1d': '일봉', '1w': '주봉' };
// how often "volume >= N x the average of the 20 candles before" fires (Binance USD-M, BTC / ETH / SOL / DOGE, 78 days of 15m and
// 312 days of 1h candles), so the threshold can be picked by how many alerts a day is bearable
var VOL_GUIDE = '하루에 몇 번 울리나 (실측, BTC · ETH 기준 / 알트는 20% 정도 적음)\n' +
    '· 15분봉: 2배 약 10번 · 3배 4~5번 · 4배 2~3번 · 5배 1~1.5번\n' +
    '· 1시간봉: 2배 약 3번 · 3배 1.3번 · 4배 0.7번 · 5배 0.4번\n' +
    '추천: 15분봉은 4~5배, 1시간봉은 3배. 3배 신호의 약 3분의 1이 미국 장 시작 무렵(UTC 12~14시)에 몰립니다.';
var SRC_LABEL = { rsi: 'RSI', macd: 'MACD', cvd: 'CVD', vol: '거래량' };

// ---- storage: the app (bridge); in a desktop browser a local copy so the page can be tried out -------------------------
var B = window.AndroidBridge;
var hasBridge = !!(B && typeof B.alertsGet === 'function');
var data = { rules: [], history: [], exact: true, notif: true };
var ALERT_PROFILES = LS.get('alertProfiles', []); if (!Array.isArray(ALERT_PROFILES)) ALERT_PROFILES = [];
var BUILTIN_ALERT_PROFILES = [
    {
        n: '추천 정예 · 실전 표준',
        d: '기본 추천 · 15m 거래량 4배(몸통 0.2%) · 1h 20봉 돌파 · 1h RSI 다이버전스 · 4h EMA200 (하루 ~4.3회)',
        rules: [
            { interval: '15m', kind: 'vol', mult: 4, vlen: 20, minBody: 0.2, up: true, down: true },
            { interval: '1h', kind: 'brk', len: 20, volMult: 1.5, up: true, down: true },
            { interval: '1h', kind: 'div', src: 'rsi', reg: true, hid: false, right: 3, up: true, down: true },
            { interval: '4h', kind: 'ind', cond: 'pma', ma: 'ema', len: 200, up: true, down: true }
        ]
    },
    {
        n: '초집중 · 저빈도 (확실한 자리만)',
        d: '피로도 최소 · 15m 거래량 5배(몸통 0.5%) · 1h 50봉 돌파 · 4h RSI 다이버전스 · 4h EMA200 (하루 1~2회)',
        rules: [
            { interval: '15m', kind: 'vol', mult: 5, vlen: 20, minBody: 0.5, up: true, down: true },
            { interval: '1h', kind: 'brk', len: 50, volMult: 1.5, up: true, down: true },
            { interval: '4h', kind: 'div', src: 'rsi', reg: true, hid: false, right: 3, up: true, down: true },
            { interval: '4h', kind: 'ind', cond: 'pma', ma: 'ema', len: 200, up: true, down: true }
        ]
    },
    {
        n: '단타 · 변동성 스캘핑',
        d: '15분봉 집중 · 거래량 3배(몸통 0.2%) · 20봉 돌파 · 볼린저 이탈 · CVD 다이버전스 (하루 6~8회)',
        rules: [
            { interval: '15m', kind: 'vol', mult: 3, vlen: 20, minBody: 0.2, up: true, down: true },
            { interval: '15m', kind: 'brk', len: 20, volMult: 1.5, up: true, down: true },
            { interval: '15m', kind: 'ind', cond: 'bb', len: 20, bbm: 2, up: true, down: true },
            { interval: '15m', kind: 'div', src: 'cvd', reg: true, hid: false, right: 3, up: true, down: true }
        ]
    },
    {
        n: '스윙 · 구조 & 다이버전스',
        d: '1시간·4시간봉 중심 · 1h 거래량 3배 · 1h RSI/MACD 다이버전스 · 4h 20봉 돌파 · 4h EMA 50×200 교차',
        rules: [
            { interval: '1h', kind: 'vol', mult: 3, vlen: 20, minBody: 0.2, up: true, down: true },
            { interval: '1h', kind: 'div', src: 'rsi', reg: true, hid: false, right: 3, up: true, down: true },
            { interval: '1h', kind: 'div', src: 'macd', reg: true, hid: false, right: 3, up: true, down: true },
            { interval: '4h', kind: 'brk', len: 20, volMult: 1.5, up: true, down: true },
            { interval: '4h', kind: 'ind', cond: 'mama', ma: 'ema', len: 50, len2: 200, up: true, down: true }
        ]
    }
];
var alertProfOpen = false;
var curAlertProfile = LS.get('curAlertProfile', BUILTIN_ALERT_PROFILES[0].n);
function makeRule(sym, tpl) {
    return Object.assign({
        id: uid(), symbol: sym, interval: '15m', kind: 'vol', on: true, once: false,
        mult: 4, vlen: 20, minBody: 0.2, src: 'rsi', reg: true, hid: false,
        up: true, down: true, len: 20, right: 3, volMult: 1.5,
        cond: 'pma', ma: 'ema', len2: 200, lvl: 70, bbm: 2,
        t1: 0, p1: 0, t2: 0, p2: 0, label: '', drawing: ''
    }, JSON.parse(JSON.stringify(tpl)), { id: uid(), symbol: tpl.symbol && tpl.allCoins ? tpl.symbol : sym, on: tpl.on !== false });
}
function applyAlertProfile(prof, syms, silent) {
    if (prof.allCoins && Array.isArray(prof.rules)) {
        data.rules = prof.rules.map(function (r) { return Object.assign({}, JSON.parse(JSON.stringify(r)), { id: uid() }); });
    } else {
        var targets = Array.isArray(syms) && syms.length ? syms : [CF.symbol()];
        // Keep other coins' rules and any drawn-line rules on the target coin
        var kept = data.rules.filter(function (r) { return targets.indexOf(r.symbol) < 0 || !!r.drawing; });
        var added = [];
        targets.forEach(function (s) {
            (prof.rules || []).forEach(function (tpl) { added.push(makeRule(s, tpl)); });
        });
        data.rules = kept.concat(added).slice(0, 100);
    }
    curAlertProfile = prof.n; LS.set('curAlertProfile', curAlertProfile);
    store(); refreshMarkers();
    if (!silent) CF.toast('"' + prof.n + '" 알람 프로필을 적용했어요');
}
function load() {
    try { var t = hasBridge ? B.alertsGet('') : JSON.stringify(Object.assign({ exact: true, notif: true }, LS.get('alertsDev', { rules: [], history: [] }))); data = JSON.parse(t) || data; }
    catch (e) { /* keep what we had */ }
    data.rules = Array.isArray(data.rules) ? data.rules : []; data.history = Array.isArray(data.history) ? data.history : [];
    if (!LS.get('alertProfileInitV129', false)) {
        LS.set('alertProfileInitV129', true);
        if (data.rules.length) {
            var isAlreadyDefault = data.rules.length === 4 && data.rules.every(function (r) { return String(r.id || '').indexOf('def-') === 0; });
            if (!isAlreadyDefault && !ALERT_PROFILES.some(function (p) { return p.n === '이전 내 알람 (백업)'; })) {
                ALERT_PROFILES.unshift({
                    n: '이전 내 알람 (백업)',
                    d: '업데이트 전 설정해 둔 알람 (' + data.rules.length + '개 · 전체 코인 복원)',
                    allCoins: true,
                    rules: JSON.parse(JSON.stringify(data.rules))
                });
                LS.set('alertProfiles', ALERT_PROFILES);
            }
            var syms = [];
            data.rules.forEach(function (r) { if (r.symbol && syms.indexOf(r.symbol) < 0 && syms.length < 3) syms.push(r.symbol); });
            if (!syms.length) syms = [CF.symbol() || 'BTCUSDT'];
            if (!isAlreadyDefault) applyAlertProfile(BUILTIN_ALERT_PROFILES[0], syms, true);
        } else {
            applyAlertProfile(BUILTIN_ALERT_PROFILES[0], [CF.symbol() || 'BTCUSDT'], true);
        }
    }
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
    if (r.kind === 'vol') return '거래량 급증 · 직전 ' + (r.vlen || 20) + '봉 평균의 ' + r.mult + '배 이상' + (r.up && r.down ? '' : r.up ? ' · 양봉만' : ' · 음봉만') + (r.minBody > 0 ? ' · 몸통 ' + r.minBody + '%↑' : '');
    if (r.kind === 'div') return SRC_LABEL[r.src] + ' 다이버전스 · ' + [r.reg ? '일반' : '', r.hid ? '히든' : ''].filter(Boolean).join('·') + ' · ' + dirText(r, '상승', '하락');
    if (r.kind === 'brk') return r.len + '봉 ' + dirText(r, '고점 돌파', '저점 이탈') + (r.volMult ? ' · 거래량 확인' : '');
    if (r.kind === 'line') return (r.label || CF.fmtPrice(r.p1)) + ' ' + dirText(r, '상향 돌파', '하향 이탈');
    if (r.kind === 'ind') {
        var ma = r.ma === 'sma' ? 'SMA' : 'EMA';
        if (r.cond === 'rsi') return 'RSI(' + r.len + ') ' + r.lvl + ' ' + dirText(r, '상향 돌파', '하향 이탈');
        if (r.cond === 'pma') return '가격 × ' + ma + r.len + ' ' + dirText(r, '돌파', '이탈');
        if (r.cond === 'mama') return ma + r.len + ' × ' + ma + r.len2 + ' ' + dirText(r, '골든', '데드') + ' 크로스';
        if (r.cond === 'macd') return 'MACD × 시그널 ' + dirText(r, '상향', '하향');
        if (r.cond === 'macd0') return 'MACD × 0선 ' + dirText(r, '상향', '하향');
        if (r.cond === 'bb') return '볼린저(' + r.len + ', ' + r.bbm + ') ' + dirText(r, '상단 돌파', '하단 이탈');
    }
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
    // the bell sits on the candle the alert was about (the one that closed when the notification came): green below for a
    // bullish signal, red above for a bearish one, amber for the rest
    var list = data.history.filter(function (e) { return e.symbol === sym && e.interval === iv; }).map(function (e) {
        var d = e.dir || 0, col = d > 0 ? CF.C.up : d < 0 ? CF.C.down : '#F0B90B';
        return { time: Math.floor(e.t / 1000), position: d > 0 ? 'belowBar' : 'aboveBar', shape: 'circle', color: col, size: 0.6, text: '🔔' + (e.marker || '') };
    }).sort(function (a, b) { return a.time - b.time; });
    if (!list.length && !markers) return;
    if (!markers) { markers = CF.LW.createSeriesMarkers(ms, []); markersOn = ms; }
    markers.setMarkers(list);
}
CF.onData(function (kind) { if (kind === 'all') { refreshMarkers(); refreshBadge(); } });

// ---- the sheet --------------------------------------------------------------------------------------------------------------
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmtTime(ms) {                                  // in the chart's time zone (phone or UTC), like the time axis
    var d = new Date(ms), utc = CF.S('chart').tz === 'utc';
    return (utc ? d.getUTCMonth() + 1 : d.getMonth() + 1) + '/' + (utc ? d.getUTCDate() : d.getDate()) + ' ' + CF.pad2(utc ? d.getUTCHours() : d.getHours()) + ':' + CF.pad2(utc ? d.getUTCMinutes() : d.getMinutes());
}
// from the history list: take the chart to the candle an alert fired on, so the bell and the notification can be compared
function showEvent(e) {
    if (e.symbol !== CF.symbol()) { CF.toast(base(e.symbol) + ' 차트에서 볼 수 있어요'); return; }
    if (e.interval !== CF.interval()) { CF.changeInterval(e.interval); CF.toast(IV_LABEL[e.interval] + '으로 바꿨어요 · 다시 눌러 위치로 이동'); CF.closeSheet(); return; }
    var i = CF.indexOfTime(Math.floor(e.t / 1000));
    if (i < 0) { CF.toast('그 봉은 아직 불러오지 않았어요 · 차트를 왼쪽으로 밀어 보세요'); return; }
    CF.closeSheet();
    try { CF.chart.timeScale().setVisibleLogicalRange({ from: i - 40, to: i + 12 }); } catch (err) { /* ignore */ }
}
function alertProfilesBox() {
    var box = el('div', 'tplbox'), sym = CF.symbol();
    var bar = el('div', 'drow', '<button class="tplb">알람 프로필 · ' + esc(curAlertProfile) + ' ' + (alertProfOpen ? '▴' : '▾') + '</button><span style="flex:1;color:var(--muted);font-size:12px">' + esc(base(sym)) + ' 알람 세트 전환 · 저장</span>');
    bar.querySelector('.tplb').onclick = function () { alertProfOpen = !alertProfOpen; openList(); };
    box.appendChild(bar);
    if (!alertProfOpen) return box;
    var menu = el('div', 'tplmenu');
    BUILTIN_ALERT_PROFILES.concat(ALERT_PROFILES).forEach(function (prof, i) {
        var mine = i >= BUILTIN_ALERT_PROFILES.length, r = el('div', 'tplrow');
        var isCur = curAlertProfile === prof.n;
        r.innerHTML = '<button class="ap"></button>' + (mine ? '<button class="rm" aria-label="삭제">✕</button>' : '');
        r.querySelector('.ap').innerHTML = (isCur ? '<span style="color:#F0B90B">● </span>' : '') + esc(prof.n) +
            '<small style="display:block;color:var(--muted);font-size:11px">' + esc(prof.d || ((prof.rules ? prof.rules.length : 0) + '개 알람 규칙')) + '</small>';
        r.querySelector('.ap').onclick = function () { applyAlertProfile(prof, [sym]); openList(); };
        if (mine) r.querySelector('.rm').onclick = function () { ALERT_PROFILES.splice(i - BUILTIN_ALERT_PROFILES.length, 1); LS.set('alertProfiles', ALERT_PROFILES); openList(); };
        menu.appendChild(r);
    });
    var add = el('div', 'tplrow', '<input type="text" maxlength="24" placeholder="새 알람 프로필 이름"><button class="sv">' + esc(base(sym)) + ' 알람 저장</button>');
    var inp = add.querySelector('input');
    add.querySelector('.sv').onclick = function () {
        var mine = data.rules.filter(function (r) { return r.symbol === sym && !r.drawing; });
        if (!mine.length) { CF.toast('저장할 알람 규칙이 없어요'); return; }
        var name = inp.value.trim() || ('내 알람 ' + (ALERT_PROFILES.length + 1));
        var cleanRules = mine.map(function (r) {
            var cp = JSON.parse(JSON.stringify(r));
            delete cp.id; delete cp.symbol;
            return cp;
        });
        var prof = { n: name, d: cleanRules.map(function (r) { return (IV_LABEL[r.interval] || r.interval) + ' ' + describe(r).split(' · ')[0]; }).join(' · '), rules: cleanRules }, at = -1;
        ALERT_PROFILES.forEach(function (x, j) { if (x.n === name) at = j; });
        if (at >= 0) ALERT_PROFILES[at] = prof; else ALERT_PROFILES.push(prof);
        if (ALERT_PROFILES.length > 20) ALERT_PROFILES.shift();
        curAlertProfile = name; LS.set('curAlertProfile', curAlertProfile);
        LS.set('alertProfiles', ALERT_PROFILES); CF.toast('"' + name + '" 알람 프로필 저장'); openList();
    };
    menu.appendChild(add);
    box.appendChild(menu);
    return box;
}
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
    rows.push(alertProfilesBox());
    var guideRow = el('div', 'row-opt', '<span style="flex:1">📖 알람 3단계 대응법 · 실측 빈도 설명서<small>알람이 울렸을 때 차트에서 확인하는 순서와 백테스트 결과</small></span><span style="color:var(--muted)">›</span>');
    guideRow.setAttribute('role', 'button');
    guideRow.onclick = function () { if (CF.openGuide) CF.openGuide(openList, 'alerts'); };
    rows.push(guideRow);
    rows.push(CF.sectionTitle(base(sym) + ' 알람'));
    var mine = data.rules.filter(function (r) { return r.symbol === sym; });
    mine.forEach(function (r) { rows.push(ruleRow(r, false)); });
    if (!mine.length) rows.push(CF.noteRow('아직 없어요. 위 알람 프로필에서 추천 세트를 고르거나 아래에서 추가하세요.'));
    var add = el('button', 'reset', '＋ 알람 추가'); add.onclick = function () { openForm(null); }; rows.push(add);
    var others = data.rules.filter(function (r) { return r.symbol !== sym; });
    if (others.length) { rows.push(CF.sectionTitle('다른 코인')); others.forEach(function (r) { rows.push(ruleRow(r, true)); }); }
    if (data.history.length) {
        rows.push(CF.sectionTitle('최근 울린 알람'));
        data.history.slice(0, 15).forEach(function (e) {
            var hr = el('div', 'row-opt', '<span style="flex:1;min-width:0"><b>' + esc(base(e.symbol)) + '</b> ' + esc(IV_LABEL[e.interval] || e.interval) + ' · ' + esc(e.title) +
                '<small>' + esc(e.detail) + '</small><small>' + fmtTime(e.t) + ' 봉 · 알림 ' + fmtTime(e.at) + ' · 눌러서 차트에서 보기</small></span>');
            hr.onclick = function () { showEvent(e); };
            rows.push(hr);
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
// sensible starting values per condition
function indDefaults(r, c) {
    r.cond = c; r.up = true; r.down = true;
    if (c === 'rsi') { r.len = 14; r.lvl = 70; r.down = false; }
    if (c === 'pma') { r.len = 200; r.ma = 'ema'; }
    if (c === 'mama') { r.len = 50; r.len2 = 200; r.ma = 'ema'; }
    if (c === 'bb') { r.len = 20; r.bbm = 2; }
}
function lastClose() { var cs = CF.candles(); return cs.length ? cs[cs.length - 1].close : 0; }
function openForm(rule, preset) {
    if (rule) { draft = { orig: rule, r: JSON.parse(JSON.stringify(rule)) }; if (draft.r.vlen == null) draft.r.vlen = 20; if (draft.r.minBody == null) draft.r.minBody = 0; }
    else {
        var p = lastClose();
        draft = { orig: null, r: Object.assign({ id: uid(), symbol: CF.symbol(), interval: curIv(), kind: 'vol', on: true, once: false, mult: 4, vlen: 20, minBody: 0.2, src: 'rsi', reg: true, hid: false,
            up: true, down: true, len: 20, right: 3, volMult: 1.5, t1: 0, p1: +CF.fmtPrice(p).replace(/,/g, '') || p, t2: 0, p2: 0, label: '', drawing: '' }, preset || {}) };
    }
    renderForm();
}
function renderForm() {
    var r = draft.r, rows = [], rr = function () { renderForm(); };
    var fromLine = !!r.drawing;
    if (!fromLine) rows.push(seg('종류', [['vol', '거래량 급증'], ['div', '다이버전스'], ['ind', '지표 조건'], ['brk', '고점·저점 돌파'], ['line', '가격 돌파']], r.kind, function (k) {
        r.kind = k; if (k === 'line') { r.once = true; if (!(r.p1 > 0)) r.p1 = lastClose(); r.p2 = r.p1; r.t1 = r.t2 = 0; }
        if (k === 'ind') { indDefaults(r, r.cond || 'rsi'); } rr();
    }));
    rows.push(seg('확인할 봉', IVS.map(function (i) { return [i, IV_LABEL[i]]; }), r.interval, function (i) { r.interval = i; rr(); }));
    if (r.kind === 'vol') {
        rows.push(seg('평균의 몇 배 이상', [[2, '2배'], [3, '3배'], [4, '4배'], [5, '5배'], [10, '10배']], r.mult, function (m) { r.mult = m; rr(); }));
        rows.push(numField('직접 입력 (배)', r.mult, function (n) { r.mult = Math.max(1.2, Math.min(50, n)); }));
        rows.push(seg('평균을 낼 직전 봉 수', [[10, '10'], [20, '20'], [50, '50'], [100, '100']], r.vlen, function (n) { r.vlen = n; rr(); }));
        rows.push(toggle('양봉일 때', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }, '오르는 쪽 거래량 폭발'));
        rows.push(toggle('음봉일 때', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }, '내리는 쪽 거래량 폭발'));
        rows.push(seg('캔들 몸통이 최소', [[0, '제한 없음'], [0.1, '0.1%'], [0.2, '0.2%'], [0.5, '0.5%']], r.minBody, function (v) { r.minBody = v; rr(); }));
        rows.push(CF.noteRow('거래량만 크고 가격이 거의 안 움직인 봉(도지 · 흡수)을 거르려면 몸통 조건을 켜세요. 3배 신호의 약 3분의 1이 몸통 0.2% 미만이었습니다.'));
        rows.push(CF.noteRow(VOL_GUIDE));
    } else if (r.kind === 'div') {
        rows.push(seg('지표', [['rsi', 'RSI'], ['macd', 'MACD'], ['cvd', 'CVD'], ['vol', '거래량']], r.src, function (s) { r.src = s; if (s === 'vol') { r.reg = true; r.hid = false; } rr(); }));
        rows.push(toggle('일반 다이버전스', r.reg, function (v) { r.reg = v; if (!v && !r.hid) r.hid = true; rr(); }, '가격은 새 고점(저점)인데 지표는 못 따라감 · 추세 전환 신호'));
        if (r.src !== 'vol') rows.push(toggle('히든 다이버전스', r.hid, function (v) { r.hid = v; if (!v && !r.reg) r.reg = true; rr(); }, '가격은 고점(저점)을 못 넘었는데 지표는 넘음 · 추세 지속 신호'));
        rows.push(toggle('상승(강세) 다이버전스', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
        rows.push(toggle('하락(약세) 다이버전스', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
        rows.push(seg('고점·저점 확인에 필요한 봉 수', [[2, '2'], [3, '3'], [5, '5']], r.right, function (n) { r.right = n; rr(); }));
        rows.push(CF.noteRow('다이버전스는 고점·저점이 확정된 뒤에 알 수 있어서, 그 봉 수만큼 늦게 울립니다. 작을수록 빠르지만 잘못된 신호가 늘어요. 기준은 트레이딩뷰 다이버전스 지표와 같습니다(왼쪽 5봉, 두 고점·저점 사이 5~60봉).'));
    } else if (r.kind === 'ind') {
        rows.push(seg('조건', [['rsi', 'RSI 레벨'], ['pma', '가격 × 이평'], ['mama', '이평 교차'], ['macd', 'MACD 교차'], ['macd0', 'MACD 0선'], ['bb', '볼린저 이탈']], r.cond, function (c) { indDefaults(r, c); rr(); }));
        if (r.cond === 'rsi') {
            rows.push(numField('RSI 기간', r.len, function (n) { r.len = Math.round(Math.max(2, Math.min(100, n))); }));
            rows.push(seg('기준선', [[70, '70'], [50, '50'], [30, '30'], [80, '80'], [20, '20']], r.lvl, function (v) { r.lvl = v; rr(); }));
            rows.push(toggle('위로 넘을 때', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
            rows.push(toggle('아래로 넘을 때', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
        } else if (r.cond === 'pma' || r.cond === 'mama') {
            rows.push(seg('이동평균', [['ema', 'EMA'], ['sma', 'SMA']], r.ma, function (v) { r.ma = v; rr(); }));
            rows.push(seg(r.cond === 'mama' ? '빠른 이평' : '기간', [[9, '9'], [20, '20'], [50, '50'], [100, '100'], [200, '200']], r.len, function (v) { r.len = v; rr(); }));
            if (r.cond === 'mama') rows.push(seg('느린 이평', [[21, '21'], [50, '50'], [100, '100'], [200, '200']], r.len2, function (v) { r.len2 = v; rr(); }));
            rows.push(toggle(r.cond === 'mama' ? '골든 크로스 (빠른 이평이 위로)' : '가격이 위로 돌파', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
            rows.push(toggle(r.cond === 'mama' ? '데드 크로스 (빠른 이평이 아래로)' : '가격이 아래로 이탈', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
        } else if (r.cond === 'bb') {
            rows.push(numField('기간', r.len, function (n) { r.len = Math.round(Math.max(2, Math.min(200, n))); }));
            rows.push(seg('표준편차 배수', [[1.5, '1.5'], [2, '2'], [2.5, '2.5'], [3, '3']], r.bbm, function (v) { r.bbm = v; rr(); }));
            rows.push(toggle('상단 위로 마감', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
            rows.push(toggle('하단 아래로 마감', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
        } else {
            rows.push(toggle('상향 교차 (매수 신호)', r.up, function (v) { r.up = v; if (!v && !r.down) r.down = true; rr(); }));
            rows.push(toggle('하향 교차 (매도 신호)', r.down, function (v) { r.down = v; if (!v && !r.up) r.up = true; rr(); }));
            rows.push(CF.noteRow('MACD는 12 · 26 · 9 기본값으로 계산합니다(트레이딩뷰와 같음). 짧은 봉에서는 자주 울려요: BTC 15분봉 시그널 교차는 하루 7번 안팎이라, 1시간봉 이상을 권합니다.'));
        }
        rows.push(CF.noteRow('봉이 마감된 값으로 판단하고, 조건이 새로 만들어진 봉에서 한 번만 울립니다(트레이딩뷰의 교차와 같은 방식).'));
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
    var horiz = d.type === 'hline' || d.type === 'hray';
    return { t1: horiz ? 0 : Math.round(a.time * 1000), p1: a.price, t2: horiz ? 0 : Math.round(b.time * 1000), p2: horiz ? a.price : b.price,
        label: horiz ? (d.type === 'hray' ? '수평 레이 ' : '수평선 ') + CF.fmtPrice(a.price) : (d.type === 'ray' ? '연장선' : '추세선') };
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
// from elsewhere (a tap on the order book): an alert at a price
CF.alertAt = function (price) { openForm(null, { kind: 'line', once: true, p1: price, p2: price, t1: 0, t2: 0, label: '' }); };
if (btn) btn.onclick = openList;
load();
// fired alerts arrive while the page is open: pick them up now and then (a cheap read from the app's storage)
setInterval(function () { if (CF.active() && !document.hidden) load(); }, 60000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
window.__alerts = { data: function () { return data; }, openList: openList, openForm: openForm, load: load };
})();
