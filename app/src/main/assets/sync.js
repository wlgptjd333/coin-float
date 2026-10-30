// Settings backup: everything the chart page keeps (indicators, their settings, profiles, drawings, pane layout, Pine
// scripts) plus the alert rules, as one JSON file. The same file moves settings between the app and the web version
// (and between phones). Import replaces this device's chart settings.
(function () {
'use strict';
var CF = window.CF, B = window.AndroidBridge;
var PREFIX = 'cf.', KIND = 'coinfloat-settings', VERSION = 1, MAX_BYTES = 5000000;
var isApp = !!(B && typeof B.alertsGet === 'function');

function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function stamp() { var d = new Date(); return d.getFullYear() + CF.pad2(d.getMonth() + 1) + CF.pad2(d.getDate()) + '-' + CF.pad2(d.getHours()) + CF.pad2(d.getMinutes()); }

// read from where the rules are kept: the alert screen's copy is empty until that screen has loaded, and an empty list here
// would erase the rules on the other side
function alertRules() {
    try {
        var a = isApp ? JSON.parse(B.alertsGet('')) : CF.LS.get('alertsDev', null);
        return a && Array.isArray(a.rules) ? a.rules : [];
    } catch (e) { return []; }
}

function collect() {
    var ls = {};
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        var name = k.slice(PREFIX.length);
        if (name === 'alertsDev') continue;                      // the web's alert store: carried as "alerts" below
        try { ls[name] = JSON.parse(localStorage.getItem(k)); } catch (e) { /* not ours */ }
    }
    return { kind: KIND, v: VERSION, at: new Date().toISOString(), from: isApp ? 'app' : 'web', ls: ls, alerts: alertRules() };
}

// The automatic sync leaves out what belongs to this device or changes all the time, so that switching the interval on one
// device neither reloads nor overwrites another; keys in a stable order, so "unchanged" compares equal.
// "liq.<coin>" is not a setting at all but the recent liquidations, rewritten every few seconds: synced, it made the devices
// overwrite each other non-stop.
var DEVICE_KEYS = { interval: 1, barSpacing: 1, railCur: 1, rail: 1, legendOpen: 1, domTab: 1, domShut: 1, ofBin: 1, heatIdx: 1, 'web.last': 1 };
function isDeviceKey(name) { return !!DEVICE_KEYS[name] || name.indexOf('liq.') === 0; }
function collectSync() {
    var all = collect(), ls = {};
    Object.keys(all.ls).sort().forEach(function (name) { if (!isDeviceKey(name)) ls[name] = all.ls[name]; });
    return { kind: KIND, v: VERSION, ls: ls, alerts: all.alerts };
}

function validate(o) {
    if (!o || o.kind !== KIND || typeof o.ls !== 'object' || !o.ls) throw new Error('CoinFloat 설정 파일이 아니에요');
    if (o.v > VERSION) throw new Error('더 새 버전에서 만든 파일이에요. 앱을 업데이트해 주세요');
    return o;
}

function apply(o, keepDeviceKeys) {
    var drop = [];
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0 || k === PREFIX + 'alertsDev') continue;
        if (keepDeviceKeys && isDeviceKey(k.slice(PREFIX.length))) continue;
        drop.push(k);
    }
    drop.forEach(function (k) { localStorage.removeItem(k); });
    Object.keys(o.ls).forEach(function (name) {
        if (keepDeviceKeys && isDeviceKey(name)) return;
        localStorage.setItem(PREFIX + name, JSON.stringify(o.ls[name]));
    });
    var rules = Array.isArray(o.alerts) ? o.alerts : [];
    if (isApp) { try { B.alertsPut(JSON.stringify(rules)); } catch (e) { /* kept the chart settings at least */ } }
    else {
        var cur = CF.LS.get('alertsDev', { rules: [], history: [] }) || {};
        CF.LS.set('alertsDev', { rules: rules, history: Array.isArray(cur.history) ? cur.history : [] });
    }
    // the alert profiles' one-time migration must not run again on top of imported rules
    localStorage.setItem(PREFIX + 'alertProfileInitV129', 'true');
    location.reload();
}

function importText(text) {
    var o;
    try { o = validate(JSON.parse(text)); } catch (e) { CF.toast(e instanceof SyntaxError ? '파일을 읽지 못했어요' : e.message); return; }
    var n = Object.keys(o.ls).length, when = String(o.at || '').slice(0, 16).replace('T', ' ');
    if (!window.confirm('이 기기의 차트 설정과 알람을 파일 내용으로 바꿀까요?\n\n' + (o.from === 'app' ? '앱' : '웹') + '에서 ' + when + ' 저장 · 항목 ' + n + '개 · 알람 ' + (o.alerts || []).length + '개')) return;
    apply(o);
}

function exportFile() {
    var json = JSON.stringify(collect()), name = 'coinfloat-settings-' + stamp() + '.json';
    if (isApp && typeof B.saveSettings === 'function') { try { B.saveSettings(name + '|' + json); } catch (e) { CF.toast('파일을 만들지 못했어요'); } return; }
    var a = el('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    CF.toast('설정 파일을 저장했어요');
}

function pickFile() {
    var inp = el('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        if (f.size > MAX_BYTES) { CF.toast('파일이 너무 커요'); return; }
        var r = new FileReader(); r.onload = function () { importText(String(r.result || '')); }; r.onerror = function () { CF.toast('파일을 읽지 못했어요'); };
        r.readAsText(f);
    };
    inp.click();
}

function copyText() {
    var json = JSON.stringify(collect());
    if (isApp && typeof B.copyText === 'function') { try { B.copyText(json); CF.toast('클립보드에 복사했어요'); } catch (e) { CF.toast('복사하지 못했어요'); } return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function () { CF.toast('클립보드에 복사했어요'); }, function () { CF.toast('복사하지 못했어요'); });
    else CF.toast('이 브라우저는 복사를 지원하지 않아요');
}

function pasteText() {
    if (isApp && typeof B.readClipboard === 'function') { var t = ''; try { t = B.readClipboard('') || ''; } catch (e) { t = ''; } if (t) importText(t); else CF.toast('클립보드가 비어 있어요'); return; }
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { if (t) importText(t); else CF.toast('클립보드가 비어 있어요'); }, function () { CF.toast('클립보드를 읽지 못했어요'); });
    else CF.toast('이 브라우저는 붙여넣기를 지원하지 않아요');
}

function row(title, sub, fn) {
    var b = el('button', 'row-opt', '<span>' + title + '<small>' + sub + '</small></span><span style="color:var(--muted)">›</span>');
    b.onclick = fn; return b;
}

CF.openSync = function (backFn) {
    var cloud = window.CF_CLOUD ? window.CF_CLOUD.rows(function () { CF.openSync(backFn); }) : [];
    var rows = cloud.concat([
        CF.sectionTitle('파일로 옮기기'),
        CF.noteRow('지표 · 지표 프로필 · 작도 · 화면 배치 · Pine 스크립트 · 알람 규칙을 한 파일로 옮겨요. 앱과 웹(브라우저) 어디서 만든 파일이든 서로 가져올 수 있어요.'),
        CF.sectionTitle('내보내기'),
        row('📤  설정 파일로 저장', isApp ? '공유 창에서 내 파일 · 드라이브 · 카톡 등으로 보내기' : 'JSON 파일 다운로드', exportFile),
        row('📋  클립보드에 복사', '메신저나 메모에 붙여 넣어 옮기기', copyText),
        CF.sectionTitle('가져오기 (이 기기 설정을 덮어써요)'),
        row('📥  설정 파일 열기', '저장해 둔 coinfloat-settings 파일 선택', pickFile),
        row('📋  클립보드에서 가져오기', '복사해 둔 설정 붙여 넣기', pasteText)
    ]);
    CF.openSheet('계정 · 설정 동기화', rows);
    if (backFn) {
        var h = document.querySelector('#sheet h3');
        if (h && !h.querySelector('.back')) {
            var bk = el('button', 'back', '‹'); bk.setAttribute('aria-label', '뒤로'); bk.onclick = backFn;
            h.insertBefore(bk, h.firstChild);
        }
    }
};
CF.syncData = { collect: collect, importText: importText, collectSync: collectSync, applySync: function (o) { apply(validate(o), true); } };
})();
