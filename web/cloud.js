// Google Drive sync for the web version: the settings file (sync.js) is kept in the app's hidden Drive folder
// (appDataFolder: only CoinFloat can see it, it does not show up in the user's Drive). Sign-in is Google's own popup
// (Google Identity Services); nothing goes through a server of ours. Off until config.js has an OAuth client ID.
(function () {
'use strict';
var CLIENT_ID = window.CF_GOOGLE_CLIENT_ID;
if (!CLIENT_ID) return;
var SCOPE = 'https://www.googleapis.com/auth/drive.appdata', NAME = 'coinfloat-settings.json';
var DRIVE = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
var token = null, expires = 0;

function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (res, rej) {
        var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res;
        s.onerror = function () { rej(new Error('Google 로그인을 불러오지 못했어요')); };
        document.head.appendChild(s);
    });
}
function signIn() {
    if (token && Date.now() < expires) return Promise.resolve(token);
    return loadGis().then(function () {
        return new Promise(function (res, rej) {
            google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID, scope: SCOPE,
                callback: function (r) {
                    if (r.error) { rej(new Error('Google 로그인이 취소됐어요')); return; }
                    token = r.access_token; expires = Date.now() + (r.expires_in - 60) * 1000; res(token);
                },
                error_callback: function () { rej(new Error('Google 로그인 창을 열지 못했어요 (팝업 차단 확인)')); }
            }).requestAccessToken();
        });
    });
}
function api(url, opt) {
    return signIn().then(function (t) {
        opt = opt || {};
        opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {});
        return fetch(url, opt).then(function (r) {
            if (r.status === 401) { token = null; throw new Error('다시 로그인해 주세요'); }
            if (!r.ok) throw new Error('Google 드라이브 오류 (' + r.status + ')');
            return r;
        });
    });
}
function findFile() {
    var q = encodeURIComponent("name='" + NAME + "'");
    return api(DRIVE + '?spaces=appDataFolder&q=' + q + '&fields=files(id,modifiedTime)').then(function (r) { return r.json(); })
        .then(function (j) { return j.files && j.files[0]; });
}
function upload(json) {
    return findFile().then(function (f) {
        var b = 'cf' + Date.now(), meta = f ? {} : { name: NAME, parents: ['appDataFolder'] };
        var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
            '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + json + '\r\n--' + b + '--';
        return api(f ? UPLOAD + '/' + f.id + '?uploadType=multipart' : UPLOAD + '?uploadType=multipart',
            { method: f ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body });
    });
}
function download() {
    return findFile().then(function (f) {
        if (!f) throw new Error('드라이브에 저장된 설정이 없어요');
        return api(DRIVE + '/' + f.id + '?alt=media').then(function (r) { return r.text(); });
    });
}

function row(title, sub, fn) {
    var b = document.createElement('button'); b.className = 'row-opt';
    b.innerHTML = '<span>' + title + '<small>' + sub + '</small></span><span style="color:var(--muted)">›</span>';
    b.onclick = fn; return b;
}

window.CF_CLOUD = {
    rows: function (collect, importText) {
        var CF = window.CF;
        // load Google's sign-in script now: if it only started loading on the tap, the sign-in popup could open too
        // long after the tap and the browser would block it
        loadGis().catch(function () { /* the tap reports it */ });
        return [
            CF.sectionTitle('Google 드라이브 동기화'),
            row('☁️  드라이브에 저장', '내 Google 계정의 앱 전용 공간에 지금 설정 올리기', function () {
                upload(JSON.stringify(collect())).then(function () { CF.toast('Google 드라이브에 저장했어요'); }, function (e) { CF.toast(e.message); });
            }),
            row('☁️  드라이브에서 불러오기', '다른 기기에서 올린 설정으로 바꾸기', function () {
                download().then(importText, function (e) { CF.toast(e.message); });
            })
        ];
    }
};
})();
