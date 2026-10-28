// The chart page in a browser (GitHub Pages). In the app, the Android side opens the coin search, shows the symbol and
// price above the chart and stores alerts; here the page shows its own top bar and this file stands in for the rest.
// Loaded before chart.js: chart.js calls window.AndroidBridge.<name> only when such a function exists.
(function () {
'use strict';
var LAST = 'cf.web.last', TICKERS = 'https://fapi.binance.com/fapi/v1/ticker/24hr';

function readLast() { try { return JSON.parse(localStorage.getItem(LAST)) || {}; } catch (e) { return {}; } }
function saveLast(s, i) { try { localStorage.setItem(LAST, JSON.stringify({ s: s, i: i })); } catch (e) { /* private mode */ } }
function clean(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// coin and interval live in the address (?s=ETHUSDT&i=1h), so a link opens the same chart
function syncUrl() {
    if (!window.CF) return;
    var s = window.CF.symbol(), i = window.CF.interval();
    var url = location.pathname + '?s=' + encodeURIComponent(s) + '&i=' + encodeURIComponent(i);
    if (location.search !== url.slice(location.pathname.length)) history.replaceState(null, '', url);
    saveLast(s, i);
    titleFeed(s);
}

// ---- live price in the tab title ("BTC 80,512.3 +0.52%"), to glance at from other tabs -----------------------------
// The chart closes its sockets while the tab is hidden, so the title has its own feed: the coin's 24h mini ticker, one
// small message a second, kept open in the background too (browsers keep delivering socket messages to hidden tabs).
var WS_URL = 'wss://fstream.binance.com/market/stream';
var tf = { sym: null, ws: null, delay: 1000, timer: 0, shown: '' };
function setTitle(text) { if (text !== tf.shown) { tf.shown = text; document.title = text; } }
function titleFeed(sym) {
    if (sym === tf.sym && tf.ws) return;
    tf.sym = sym;
    if (tf.ws) { tf.ws.onclose = null; try { tf.ws.close(); } catch (e) { /* closing */ } tf.ws = null; }
    clearTimeout(tf.timer);
    setTitle(sym.replace(/USDT$/, '') + ' · CoinFloat');
    connectTitle();
}
function connectTitle() {
    var sym = tf.sym, name = sym.toLowerCase() + '@miniTicker', ws;
    try { ws = new WebSocket(WS_URL); } catch (e) { retryTitle(); return; }
    tf.ws = ws;
    ws.onopen = function () { tf.delay = 1000; ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [name], id: 1 })); };
    ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        var d = m && m.stream === name && m.data;
        if (!d || sym !== tf.sym) return;
        var close = +d.c, open = +d.o;
        if (!(close > 0)) return;
        var price = window.CF && window.CF.symbol() === sym ? window.CF.fmtPrice(close) : String(close);
        var pct = open > 0 ? (close - open) / open * 100 : null;
        setTitle(sym.replace(/USDT$/, '') + ' ' + price + (pct == null ? '' : ' ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'));
    };
    ws.onclose = function () { if (tf.ws === ws) { tf.ws = null; retryTitle(); } };
}
function retryTitle() {
    clearTimeout(tf.timer);
    tf.timer = setTimeout(function () { if (!tf.ws && tf.sym) connectTitle(); }, tf.delay);
    tf.delay = Math.min(tf.delay * 2, 30000);
}

// ---- coin search: all USDT perpetuals by 24h volume, from one public request ------------------------------------
var tickers = null, tickersAt = 0;
function loadTickers() {
    if (tickers && Date.now() - tickersAt < 60000) return Promise.resolve(tickers);
    return fetch(TICKERS).then(function (r) { return r.json(); }).then(function (a) {
        tickers = (Array.isArray(a) ? a : []).filter(function (t) { return /USDT$/.test(t.symbol) && +t.quoteVolume > 0; })
            .sort(function (x, y) { return +y.quoteVolume - +x.quoteVolume; });
        tickersAt = Date.now();
        return tickers;
    });
}
function fmtVol(v) { v = +v; return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : (v / 1e3).toFixed(0) + 'K'; }

function openSearch() {
    var CF = window.CF; if (!CF) return;
    var box = document.createElement('div');
    var inp = document.createElement('input');
    inp.type = 'search'; inp.placeholder = '코인 검색 (예: BTC, SOL)'; inp.autocomplete = 'off';
    inp.style.cssText = 'width:100%;padding:10px 12px;margin:4px 0 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;user-select:text;-webkit-user-select:text';
    var list = document.createElement('div');
    box.appendChild(inp); box.appendChild(list);
    function render() {
        var q = clean(inp.value), cur = CF.symbol(), n = 0;
        list.innerHTML = '';
        (tickers || []).some(function (t) {
            if (q && t.symbol.indexOf(q) < 0) return false;
            var chg = +t.priceChangePercent, b = document.createElement('button');
            b.className = 'row-opt';
            b.innerHTML = '<span><b>' + t.symbol.replace(/USDT$/, '') + '</b><small>' + t.symbol + ' · 거래대금 ' + fmtVol(t.quoteVolume) + '</small></span>' +
                '<span style="text-align:right">' + (+t.lastPrice) + '<small style="color:' + (chg >= 0 ? 'var(--up)' : 'var(--down)') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</small></span>' +
                (t.symbol === cur ? '<span class="check">✓</span>' : '');
            b.onclick = function () { CF.closeSheet(); window.loadSymbol(t.symbol); setTimeout(syncUrl, 0); };
            list.appendChild(b);
            return ++n >= 80;
        });
        if (!n) list.appendChild(CF.noteRow(tickers ? '찾는 코인이 없어요' : '불러오는 중…'));
    }
    inp.oninput = render;
    inp.onkeydown = function (e) { if (e.key === 'Enter') { var b = list.querySelector('button'); if (b) b.click(); } };
    CF.openSheet('코인 선택', [box]);
    render();
    loadTickers().then(render, function () { list.innerHTML = ''; list.appendChild(CF.noteRow('목록을 불러오지 못했어요')); });
    setTimeout(function () { inp.focus(); }, 50);
}

window.AndroidBridge = {
    openSymbolSearch: function () { openSearch(); },
    exitImmersive: function () { /* nothing to leave: the browser always shows the page's own top bar */ },
    candleClose: function () { syncUrl(); },          // called when the chart (re)loads a coin or interval
    backState: function () {}
};

window.addEventListener('load', function () {
    var p = new URLSearchParams(location.search), last = readLast();
    var s = clean(p.get('s')) || clean(last.s) || 'BTCUSDT';
    var i = p.get('i') || last.i || '';
    var st = document.createElement('style');
    st.textContent = '#app.web #exit_btn { display: none !important; }';
    document.head.appendChild(st);
    document.getElementById('app').classList.add('web');
    window.setImmersive(true);
    window.loadSymbol(s, i || '15m', i);
    setTimeout(syncUrl, 0);
});
})();
