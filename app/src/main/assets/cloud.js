// Google sign-in and automatic settings sync, the same code in the app and on the web. Firebase Authentication keeps the
// sign-in, Firestore keeps one small document per kind of settings (users/<uid>/sync/chart and /app), both over their
// REST APIs so neither side carries an SDK. The Google ID token comes from Android's account sheet in the app
// (AndroidBridge.googleSignIn) and from Google's button on the web. All values below are public identifiers: what
// protects the data are the Firestore rules (firestore.rules), which let a signed-in user reach only their own documents.
(function () {
'use strict';
var CF = window.CF, B = window.AndroidBridge, SD = CF && CF.syncData;
if (!SD) return;
var API_KEY = 'AIzaSyBzDU7R3JyPdctau4NULMQdPypSQwnd3dY', PROJECT = 'coin-float';
var WEB_CLIENT_ID = '534312997200-8e38s404douiq73396bgisbgjf16khpg.apps.googleusercontent.com';
var AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:', TOKEN = 'https://securetoken.googleapis.com/v1/token?key=' + API_KEY;
var STORE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/users/';
// kept outside the "cf." prefix: those keys are what the settings file and the sync carry, and this must never travel
var SESSION_KEY = 'cfauth', STATE_KEY = 'cfsync';
var MAX_BYTES = 1000000, POLL_MS = 30000, RECHECK_HIDDEN_MS = 30000;
var isApp = !!(B && typeof B.googleSignIn === 'function');

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full */ } }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

// ---- session -----------------------------------------------------------------------------------------------------
var session = lsGet(SESSION_KEY), idToken = null, idExpires = 0;
function saveSession() { lsSet(SESSION_KEY, session); }
function json(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { var e = new Error((j.error && j.error.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
            return j;
        });
    });
}
function signInWithGoogleToken(googleIdToken) {
    return json(AUTH + 'signInWithIdp?key=' + API_KEY, {
        postBody: 'id_token=' + encodeURIComponent(googleIdToken) + '&providerId=google.com',
        requestUri: 'http://localhost', returnSecureToken: true
    }).then(function (j) {
        session = { uid: j.localId, email: j.email || '', refresh: j.refreshToken };
        saveSession();
        idToken = j.idToken; idExpires = Date.now() + (+j.expiresIn || 3600) * 1000;
    });
}
function token() {
    if (!session) return Promise.reject(new Error('로그인이 필요해요'));
    if (idToken && Date.now() < idExpires - 60000) return Promise.resolve(idToken);
    return fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) {
                // only the server saying the sign-in is gone ends it; a network failure must not sign anyone out
                var m = (j.error && j.error.message) || '';
                if (r.status === 400 && /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND/.test(m)) forget();
                throw new Error('로그인을 확인하지 못했어요');
            }
            idToken = j.id_token; idExpires = Date.now() + (+j.expires_in || 3600) * 1000;
            if (j.refresh_token && session) { session.refresh = j.refresh_token; saveSession(); }
            return idToken;
        });
    });
}
function forget() { session = null; idToken = null; idExpires = 0; saveSession(); lsSet(STATE_KEY, null); }

// ---- Firestore ---------------------------------------------------------------------------------------------------
function docUrl(name) { return STORE + encodeURIComponent(session.uid) + '/sync/' + name; }
function api(url, opt) {
    return token().then(function (t) {
        opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {});
        return fetch(url, opt);
    });
}
function readDoc(name, metaOnly) {
    return api(docUrl(name) + (metaOnly ? '?mask.fieldPaths=at&mask.fieldPaths=hash' : '')).then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('동기화 오류 (' + r.status + ')');
        return r.json().then(function (d) {
            var f = d.fields || {};
            return { at: +(f.at && f.at.integerValue) || 0, hash: f.hash && f.hash.stringValue || '', json: f.json && f.json.stringValue || null };
        });
    });
}
function writeDoc(name, text, hash, keepalive) {
    var at = Date.now(), from = isApp ? 'app' : 'web';
    return api(docUrl(name), {
        method: 'PATCH', keepalive: !!keepalive, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { json: { stringValue: text }, hash: { stringValue: hash }, at: { integerValue: String(at) }, from: { stringValue: from } } })
    }).then(function (r) { if (!r.ok) throw new Error('동기화 오류 (' + r.status + ')'); return at; });
}

// ---- what is synced ----------------------------------------------------------------------------------------------
var DOCS = [];
// the floating window's look and the watchlist live in the app, so this one exists there only; it goes first because applying
// the chart settings reloads the page
if (isApp && typeof B.appSettingsGet === 'function') DOCS.push({
    name: 'app',
    get: function () { return B.appSettingsGet(''); },
    set: function (text) { B.appSettingsPut(text); }
});
DOCS.push({
    name: 'chart',
    get: function () { return JSON.stringify(SD.collectSync()); },
    set: function (text) { lsSet(STATE_KEY, state); SD.applySync(JSON.parse(text)); }
});
function hashOf(s) {                   // cyrb53: only tells "changed" from "unchanged"
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
function bytes(s) { return window.TextEncoder ? new TextEncoder().encode(s).length : s.length * 3; }

// ---- the sync ----------------------------------------------------------------------------------------------------
// state: { uid, docs: { name: { rev (the "at" last seen in the cloud), hash (this device's settings then), settle } } }
var state = lsGet(STATE_KEY), busy = false, lastError = '', lastDone = 0, hiddenAt = 0;
function freshState() { state = { uid: session.uid, docs: {} }; lsSet(STATE_KEY, state); }
function saveState() { lsSet(STATE_KEY, state); }
function fail(e) { lastError = (e && e.message) || '동기화하지 못했어요'; console.warn('sync', lastError); refreshRow(); }

function upload(doc, text, hash, keepalive) {
    if (bytes(text) >= MAX_BYTES) return Promise.reject(new Error('설정이 너무 커서 자동 동기화하지 못해요 (파일로 옮겨 주세요)'));
    return writeDoc(doc.name, text, hash, keepalive).then(function (at) { state.docs[doc.name] = { rev: at, hash: hash }; saveState(); lastDone = Date.now(); lastError = ''; });
}
// one document: the cloud or this device moved since the last sync, whichever did goes to the other; if both did, the newer wins
function syncDoc(doc) {
    var text = doc.get(), hash = hashOf(text), st = state.docs[doc.name];
    if (st && st.settle) {             // the page just came back from applying the cloud copy: what it holds now is "in sync"
        state.docs[doc.name] = { rev: st.rev, hash: hash }; saveState();
        lastDone = Date.now(); lastError = '';
        return Promise.resolve();
    }
    return readDoc(doc.name, true).then(function (meta) {
        if (!st) {                     // a kind of settings this device has not synced yet (added by an update)
            if (!meta) return upload(doc, text, hash);
            state.docs[doc.name] = { rev: meta.at, hash: hash }; saveState();
            return null;
        }
        var cloudMoved = !!meta && meta.at !== st.rev, localMoved = hash !== st.hash;
        if (!meta || (localMoved && !cloudMoved) || (localMoved && cloudMoved && (st.changed || 0) >= meta.at)) return upload(doc, text, hash);
        if (cloudMoved && meta.hash === hash) { state.docs[doc.name] = { rev: meta.at, hash: hash }; saveState(); return null; }
        if (cloudMoved) return readDoc(doc.name).then(function (full) { return applyCloud(doc, full); });
        lastDone = Date.now(); lastError = '';
        return null;
    });
}
function applyCloud(doc, full) {
    if (!full || !full.json) return null;
    state.docs[doc.name] = { rev: full.at, settle: true }; saveState();
    lastDone = Date.now(); lastError = '';
    doc.set(full.json);                // the chart settings reload the page here
    return null;
}
function syncAll() {
    if (!session || busy) return Promise.resolve();
    if (!state || state.uid !== session.uid) return firstSync();
    busy = true;
    var p = Promise.resolve();
    DOCS.forEach(function (d) { p = p.then(function () { return syncDoc(d); }); });
    return p.catch(fail).then(function () { busy = false; refreshRow(); });
}
// The first time this account meets this device: nothing in the cloud means upload; otherwise the user chooses, because either
// copy could be the one they care about (a fresh install must not overwrite years of settings, nor the reverse).
function firstSync() {
    busy = true;
    var metas = [];
    var p = Promise.resolve();
    DOCS.forEach(function (d) { p = p.then(function () { return readDoc(d.name, true).then(function (m) { metas.push({ doc: d, meta: m }); }); }); });
    return p.then(function () {
        freshState();
        var differs = metas.filter(function (x) { return x.meta && x.meta.hash !== hashOf(x.doc.get()); });
        if (!differs.length) {
            var up = Promise.resolve();
            metas.forEach(function (x) {
                var text = x.doc.get(), hash = hashOf(text);
                if (x.meta) state.docs[x.doc.name] = { rev: x.meta.at, hash: hash }; else up = up.then(function () { return upload(x.doc, text, hash); });
            });
            return up.then(function () { saveState(); lastDone = Date.now(); busy = false; refreshRow(); });
        }
        busy = false;
        lsSet(STATE_KEY, null); state = null;
        chooseCopy(metas);
    }).catch(function (e) { busy = false; fail(e); });
}
function chooseCopy(metas) {
    var newest = metas.reduce(function (a, x) { return Math.max(a, x.meta ? x.meta.at : 0); }, 0);
    var when = newest ? new Date(newest).toLocaleString() : '';
    CF.openSheet('이 계정에 저장된 설정이 있어요', [
        CF.noteRow('클라우드 설정은 ' + esc(when) + '에 저장됐어요. 어느 쪽을 쓸까요? 고르지 않은 쪽은 덮어써져요.'),
        row('☁️  클라우드 설정 쓰기', '이 기기의 설정을 클라우드 내용으로 바꿔요', function () {
            freshState();
            var p = Promise.resolve();
            metas.forEach(function (x) { p = p.then(function () { return x.meta ? readDoc(x.doc.name).then(function (f) { return applyCloud(x.doc, f); }) : upload(x.doc, x.doc.get(), hashOf(x.doc.get())); }); });
            p.then(function () { CF.closeSheet(); CF.toast('클라우드 설정으로 바꿨어요'); }, fail);
        }),
        row('📱  이 기기 설정 쓰기', '클라우드를 이 기기의 설정으로 덮어써요', function () {
            freshState();
            var p = Promise.resolve();
            metas.forEach(function (x) { p = p.then(function () { var text = x.doc.get(); return upload(x.doc, text, hashOf(text)); }); });
            p.then(function () { CF.closeSheet(); CF.toast('이 기기 설정을 클라우드에 저장했어요'); refreshRow(); }, fail);
        })
    ]);
}
// A change on this device only needs to compare locally; the network is used when something actually changed.
function poll(flush) {
    if (!session || busy || !state || state.uid !== session.uid || document.hidden && !flush) return;
    DOCS.forEach(function (d) {
        var st = state.docs[d.name]; if (!st || st.settle) return;
        var text = d.get(), hash = hashOf(text);
        if (hash === st.hash) return;
        st.changed = Date.now(); saveState();
        upload(d, text, hash, flush && text.length < 60000).then(refreshRow, fail);
    });
}
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); poll(true); return; }
    if (hiddenAt && Date.now() - hiddenAt > RECHECK_HIDDEN_MS) syncAll();
});
setTimeout(function () { if (session) syncAll(); }, 5000);     // once the page has settled: booting may rewrite its own settings

// ---- sign-in ----------------------------------------------------------------------------------------------------
var pending = {}, seq = 0;
window.__authDone = function (id, ok, text) { var cb = pending[id]; delete pending[id]; if (cb) cb(ok, text); };
function appGoogleToken() {
    return new Promise(function (res, rej) {
        var id = 'g' + (++seq);
        pending[id] = function (ok, text) { if (ok) res(text); else rej(new Error(text)); };
        try { B.googleSignIn(id); } catch (e) { delete pending[id]; rej(new Error('Google 로그인을 열 수 없어요')); }
    });
}
function loadGis() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    return new Promise(function (res, rej) {
        var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res;
        s.onerror = function () { rej(new Error('Google 로그인을 불러오지 못했어요')); };
        document.head.appendChild(s);
    });
}
var afterSignIn = null;
function signedIn() {
    var then = afterSignIn; afterSignIn = null;
    if (then) { then(); return; }
    CF.toast((session.email ? esc(session.email) + ' · ' : '') + '로그인했어요');
    syncAll().then(function () { if (document.querySelector('#sheet_bg.show') && !state) return; reopen(); });
}
function signInFailed(e) {
    var m = e && e.message || '';
    CF.toast(/^[A-Z_ :]+/.test(m) ? 'Google 로그인에 실패했어요 (' + esc(m) + ')' : (m || 'Google 로그인에 실패했어요'));
}
function appSignIn() { appGoogleToken().then(signInWithGoogleToken).then(signedIn, signInFailed); }
function webButton() {
    var box = el('div', 'gbtn');
    loadGis().then(function () {
        google.accounts.id.initialize({
            client_id: WEB_CLIENT_ID,
            callback: function (r) { signInWithGoogleToken(r.credential).then(signedIn, signInFailed); }
        });
        google.accounts.id.renderButton(box, { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', locale: 'ko', width: 260 });
    }).catch(signInFailed);
    return box;
}
function signOut() {
    forget();
    if (isApp && typeof B.googleSignOut === 'function') { try { B.googleSignOut(''); } catch (e) { /* signed out here anyway */ } }
    CF.toast('로그아웃했어요 · 이 기기의 설정은 그대로예요');
    reopen();
}

// ---- deleting the account: the documents, then the sign-in itself ---------------------------------------------------
function deleteAccount() {
    var p = Promise.resolve();
    // the sign-in goes last: without it nobody could reach documents that failed to delete
    ['app', 'chart'].forEach(function (n) { p = p.then(function () { return api(docUrl(n), { method: 'DELETE' }).then(function (r) { if (!r.ok) throw new Error('DOC_DELETE ' + r.status); }); }); });
    return p.then(token).then(function (t) { return json(AUTH + 'delete?key=' + API_KEY, { idToken: t }); }).then(function () {
        forget();
        if (isApp && typeof B.googleSignOut === 'function') { try { B.googleSignOut(''); } catch (e) { /* gone anyway */ } }
        CF.toast('계정과 클라우드 설정을 삭제했어요 · 이 기기의 설정은 그대로예요');
        reopen();
    }, function (e) {
        // Google wants a recent sign-in for this. The cloud settings are already gone; sign in once more to finish.
        if (!/CREDENTIAL_TOO_OLD|TOKEN_EXPIRED/.test(e.message || '')) { CF.toast('삭제하지 못했어요. 잠시 후 다시 시도해 주세요'); return; }
        afterSignIn = deleteAccount;
        if (isApp) { CF.toast('본인 확인을 위해 다시 로그인해 주세요'); appSignIn(); return; }
        CF.openSheet('본인 확인이 필요해요', [CF.noteRow('클라우드 설정은 삭제했어요. 계정까지 지우려면 Google로 한 번 더 로그인해 주세요.'), webButton()]);
    });
}
function confirmDelete() {
    CF.openSheet('계정을 삭제할까요?', [
        CF.noteRow(esc(session.email) + ' 로그인 정보와 클라우드에 저장된 설정이 영구히 삭제돼요. 되돌릴 수 없어요. 이 기기의 설정은 그대로 남고, 언제든 다시 가입할 수 있어요.'),
        row('🗑️  계정 삭제', '로그인 정보와 클라우드 설정 삭제', deleteAccount),
        row('취소', '', reopen)
    ]);
}

// ---- the settings sheet -------------------------------------------------------------------------------------------
function row(title, sub, fn) {
    var b = el('button', 'row-opt', '<span>' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span><span style="color:var(--muted)">›</span>');
    b.onclick = fn; return b;
}
var statusRow = null, reopenFn = null;
function statusText() {
    if (lastError) return esc(lastError);
    if (!lastDone) return '자동으로 동기화돼요';
    var d = new Date(lastDone);
    return '마지막 동기화 ' + CF.pad2(d.getHours()) + ':' + CF.pad2(d.getMinutes());
}
function refreshRow() { if (statusRow && statusRow.isConnected) statusRow.querySelector('small').innerHTML = statusText(); }
function reopen() { if (reopenFn) reopenFn(); }
window.CF_CLOUD = {
    rows: function (reopenSheet) {
        reopenFn = reopenSheet;
        if (!session) {
            var note = '지표 · 작도 · 화면 배치 · Pine · 알람' + (isApp ? ' · 시세창 모양 · 관심 종목' : '') + '이 내 계정에 저장되고 앱과 웹에서 자동으로 맞춰져요.';
            return [CF.sectionTitle('Google 계정'), CF.noteRow(note), isApp ? row('Google로 계속하기', '', appSignIn) : webButton()];
        }
        statusRow = row('🔄  지금 동기화', statusText(), function () { syncAll().then(function () { CF.toast(lastError || '동기화했어요'); }); });
        return [
            CF.sectionTitle('Google 계정 · ' + esc(session.email)),
            statusRow,
            row('로그아웃', '이 기기의 설정은 그대로예요', signOut),
            row('계정 삭제', '로그인 정보와 클라우드 설정을 지워요', confirmDelete)
        ];
    }
};
// the web version's account-deletion link (delete-account.html) opens this sheet
if (/[?&]account=1\b/.test(location.search)) setTimeout(function () { if (CF.openSync) CF.openSync(); }, 1500);
window.__cloud = { syncAll: syncAll, get session() { return session ? { uid: session.uid, email: session.email } : null; }, get state() { return state; }, hashOf: hashOf };
})();
