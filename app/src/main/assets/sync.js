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

function alertRules() {
    try { var a = window.__alerts && window.__alerts.data(); return a && Array.isArray(a.rules) ? a.rules : []; } catch (e) { return []; }
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

function validate(o) {
    if (!o || o.kind !== KIND || typeof o.ls !== 'object' || !o.ls) throw new Error('CoinFloat 설정 파일이 아니에요');
    if (o.v > VERSION) throw new Error('더 새 버전에서 만든 파일이에요. 앱을 업데이트해 주세요');
    return o;
}

function apply(o) {
    var drop = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0 && k !== PREFIX + 'alertsDev') drop.push(k); }
    drop.forEach(function (k) { localStorage.removeItem(k); });
    Object.keys(o.ls).forEach(function (name) { localStorage.setItem(PREFIX + name, JSON.stringify(o.ls[name])); });
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

// In the app, Google Drive goes through Android's own Google sign-in (Google does not allow it inside a WebView); the
// web version's web/cloud.js does the same with Google's browser sign-in. Both use the same file in the same folder.
if (isApp && typeof B.driveSave === 'function' && !window.CF_CLOUD) {
    var pending = {}, seq = 0;
    window.__driveDone = function (id, ok, text) { var cb = pending[id]; delete pending[id]; if (cb) cb(ok, text); };
    var drive = function (name, arg, cb) {
        var id = 'd' + (++seq); pending[id] = cb;
        try { B[name](id + '|' + (arg || '')); } catch (e) { delete pending[id]; cb(false, 'Google 드라이브에 연결하지 못했어요'); }
    };
    window.CF_CLOUD = {
        rows: function (collect, importText) {
            return [
                CF.sectionTitle('Google 드라이브 동기화'),
                row('☁️  드라이브에 저장', '내 Google 계정의 앱 전용 공간에 지금 설정 올리기 (웹과 같은 파일)', function () {
                    CF.toast('Google 드라이브에 저장하는 중…');
                    drive('driveSave', JSON.stringify(collect()), function (ok, t) { CF.toast(ok ? 'Google 드라이브에 저장했어요' : t); });
                }),
                row('☁️  드라이브에서 불러오기', '다른 기기 · 웹에서 올린 설정으로 바꾸기', function () {
                    drive('driveLoad', '', function (ok, t) { if (ok) importText(t); else CF.toast(t); });
                })
            ];
        }
    };
}

CF.openSync = function (backFn) {
    var rows = [
        CF.noteRow('지표 · 지표 프로필 · 작도 · 화면 배치 · Pine 스크립트 · 알람 규칙을 한 파일로 옮겨요. 앱과 웹(브라우저) 어디서 만든 파일이든 서로 가져올 수 있어요.'),
        CF.sectionTitle('내보내기'),
        row('📤  설정 파일로 저장', isApp ? '공유 창에서 내 파일 · 드라이브 · 카톡 등으로 보내기' : 'JSON 파일 다운로드', exportFile),
        row('📋  클립보드에 복사', '메신저나 메모에 붙여 넣어 옮기기', copyText),
        CF.sectionTitle('가져오기 (이 기기 설정을 덮어써요)'),
        row('📥  설정 파일 열기', '저장해 둔 coinfloat-settings 파일 선택', pickFile),
        row('📋  클립보드에서 가져오기', '복사해 둔 설정 붙여 넣기', pasteText)
    ];
    if (window.CF_CLOUD && typeof window.CF_CLOUD.rows === 'function') rows = rows.concat(window.CF_CLOUD.rows(collect, importText));
    CF.openSheet('설정 백업 · 가져오기', rows);
    if (backFn) {
        var h = document.querySelector('#sheet h3');
        if (h && !h.querySelector('.back')) {
            var bk = el('button', 'back', '‹'); bk.setAttribute('aria-label', '뒤로'); bk.onclick = backFn;
            h.insertBefore(bk, h.firstChild);
        }
    }
};
CF.syncData = { collect: collect, importText: importText };
})();
