// The chart page in a browser (GitHub Pages). In the app, the Android side opens the coin search, shows the symbol and
// price above the chart and stores alerts; here the page shows its own top bar and this file stands in for the rest.
// Loaded before chart.js: chart.js calls window.AndroidBridge.<name> only when such a function exists.
(function () {
'use strict';
var LAST = 'cf.web.last', TICKERS = 'https://fapi.binance.com/fapi/v1/ticker/24hr';

function readLast() { try { return JSON.parse(localStorage.getItem(LAST)) || {}; } catch (e) { return {}; } }
function saveLast(s, i) { try { localStorage.setItem(LAST, JSON.stringify({ s: s, i: i })); } catch (e) { /* private mode */ } }
function clean(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''); }
function shortName(s) { return /^HL-/.test(s) ? (hlNames[s] || hlGuess(s)) : /^VAR-/.test(s) ? s.slice(4) : s.replace(/USDT$/, ''); }

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
var tf = { sym: null, ws: null, delay: 1000, timer: 0, ping: 0, shown: '' };
function setTitle(text) { if (text !== tf.shown) { tf.shown = text; document.title = text; } }
function titleFeed(sym) {
    if (sym === tf.sym && tf.ws) return;
    tf.sym = sym;
    if (tf.ws) { tf.ws.onclose = null; try { tf.ws.close(); } catch (e) { /* closing */ } tf.ws = null; }
    clearInterval(tf.ping);
    clearTimeout(tf.timer);
    setTitle(shortName(sym) + ' · CoinFloat');
    if (/^VAR-/.test(sym)) return;                       // Variational: no public stream
    connectTitle();
}
function connectTitle() {
    var sym = tf.sym, hl = /^HL-/.test(sym), name = sym.toLowerCase() + '@miniTicker', coin = hlNames[sym] || hlGuess(sym), ws;
    try { ws = new WebSocket(hl ? HL_WS : WS_URL); } catch (e) { retryTitle(); return; }
    tf.ws = ws;
    ws.onopen = function () {
        tf.delay = 1000;
        if (hl) {
            ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: coin } }));
            tf.ping = setInterval(function () { try { ws.send('{"method":"ping"}'); } catch (e) { /* closing */ } }, 30000);
        } else ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [name], id: 1 }));
    };
    ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        var d = hl ? m && m.channel === 'activeAssetCtx' && m.data && m.data.coin === coin && m.data.ctx && { c: +m.data.ctx.midPx || +m.data.ctx.markPx, o: +m.data.ctx.prevDayPx }
            : m && m.stream === name && m.data;
        if (!d || sym !== tf.sym) return;
        var close = +d.c, open = +d.o;
        if (!(close > 0)) return;
        var price = window.CF && window.CF.symbol() === sym ? window.CF.fmtPrice(close) : String(close);
        var pct = open > 0 ? (close - open) / open * 100 : null;
        setTitle(shortName(sym) + ' ' + price + (pct == null ? '' : ' ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'));
    };
    ws.onclose = function () { clearInterval(tf.ping); if (tf.ws === ws) { tf.ws = null; retryTitle(); } };
}
function retryTitle() {
    clearTimeout(tf.timer);
    tf.timer = setTimeout(function () { if (!tf.ws && tf.sym) connectTitle(); }, tf.delay);
    tf.delay = Math.min(tf.delay * 2, 30000);
}

// ---- coin search: Binance USDT perpetuals (coins, stocks, commodities) and Hyperliquid's markets, by 24h volume ---
var HL_INFO = 'https://api.hyperliquid.xyz/info', HL_WS = 'wss://api.hyperliquid.xyz/ws', hlNames = {};
function hlKey(coin) { return 'HL-' + String(coin).split(':').map(function (p) { return p.toUpperCase().replace(/[^A-Z0-9]/g, ''); }).join('-'); }
function hlGuess(key) { var p = key.slice(3).split('-'); return p.length > 1 ? p[0].toLowerCase() + ':' + p.slice(1).join('-') : p[0]; }
function hlPost(body) { return fetch(HL_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
// one market group (the main market, or a HIP-3 deployer such as XYZ with stocks and commodities) as search rows
function hlRows(dex, label) {
    return hlPost(dex ? { type: 'metaAndAssetCtxs', dex: dex } : { type: 'metaAndAssetCtxs' }).then(function (a) {
        var uni = a && a[0] && a[0].universe || [], ctx = a && a[1] || [];
        return uni.map(function (u, i) {
            var c = ctx[i] || {}, key = hlKey(u.name);
            hlNames[key] = u.name;
            if (u.isDelisted || !(+c.dayNtlVlm > 0)) return null;
            var last = +c.midPx || +c.markPx, prev = +c.prevDayPx;
            return { symbol: key, name: u.name, venue: 'Hyperliquid' + (label ? ' · ' + label : ''), lastPrice: last, quoteVolume: +c.dayNtlVlm, priceChangePercent: prev > 0 ? (last - prev) / prev * 100 : 0 };
        }).filter(Boolean);
    }, function () { return []; });
}
function loadHl() {
    return hlPost({ type: 'perpDexs' }).then(function (d) {
        var dexes = (Array.isArray(d) ? d : []).filter(function (x) { return x && x.name; });
        return Promise.all([hlRows('', '')].concat(dexes.map(function (x) { return hlRows(x.name, x.fullName || x.name); })));
    }, function () { return Promise.all([hlRows('', '')]); }).then(function (parts) { return [].concat.apply([], parts); });
}
var tickers = null, tickersAt = 0;
function loadTickers() {
    if (tickers && Date.now() - tickersAt < 60000) return Promise.resolve(tickers);
    var bn = fetch(TICKERS).then(function (r) { return r.json(); }).then(function (a) {
        return (Array.isArray(a) ? a : []).filter(function (t) { return /USDT$/.test(t.symbol) && +t.quoteVolume > 0; })
            .map(function (t) { return { symbol: t.symbol, name: t.symbol.replace(/USDT$/, ''), venue: 'Binance', lastPrice: +t.lastPrice, quoteVolume: +t.quoteVolume, priceChangePercent: +t.priceChangePercent }; });
    }, function () { return []; });
    return Promise.all([bn, loadHl()]).then(function (r) {
        var byVol = function (x, y) { return y.quoteVolume - x.quoteVolume; };
        tickers = r[0].sort(byVol).concat(r[1].sort(byVol));
        tickersAt = Date.now();
        return tickers;
    });
}
// the price as the exchange sent it, with thousands separators (59104.4 -> 59,104.4; 0.006082 stays as it is)
function fmtLast(p) { var s = String(+p), i = s.indexOf('.'), a = i < 0 ? s : s.slice(0, i); return a.replace(/\B(?=(\d{3})+$)/g, ',') + (i < 0 ? '' : s.slice(i)); }
function fmtVol(v) { v = +v; return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : (v / 1e3).toFixed(0) + 'K'; }

// ---- favorites (★) and the ranking the list is sorted by ------------------------------------------------------------
// Favorites follow the account like the chart settings (cf.web.fav); the chosen ranking stays on this device.
var FAV = 'cf.web.fav', SORT = 'cf.web.sort', MIN_MOVER_VOL = 1e5;     // risers / fallers: skip coins with < $100K turnover
function readFav() { try { var a = JSON.parse(localStorage.getItem(FAV)); return Array.isArray(a) ? a.filter(function (s) { return typeof s === 'string'; }) : []; } catch (e) { return []; } }
function saveFav(a) { try { localStorage.setItem(FAV, JSON.stringify(a)); } catch (e) { /* private mode */ } }
function readSort() { try { var s = localStorage.getItem(SORT); return s === 'fav' || s === 'up' || s === 'down' ? s : 'vol'; } catch (e) { return 'vol'; } }
function saveSort(s) { try { localStorage.setItem(SORT, s); } catch (e) { /* private mode */ } }
function ranked(sort, fav) {
    var all = tickers || [];
    if (sort === 'fav') return fav.map(function (s) { for (var i = 0; i < all.length; i++) if (all[i].symbol === s) return all[i]; return null; }).filter(Boolean);
    if (sort === 'vol') return all;                                    // already Binance by volume, then Hyperliquid by volume
    var pool = all.filter(function (t) { return t.quoteVolume >= MIN_MOVER_VOL && isFinite(+t.priceChangePercent); });
    return pool.sort(function (a, b) { return sort === 'up' ? b.priceChangePercent - a.priceChangePercent : a.priceChangePercent - b.priceChangePercent; });
}

function openSearch() {
    var CF = window.CF; if (!CF) return;
    var box = document.createElement('div');
    box.style.cssText = 'padding:0 20px';
    var inp = document.createElement('input');
    inp.type = 'search'; inp.placeholder = '종목 검색 (예: BTC, TSLA, GOLD)'; inp.autocomplete = 'off';
    inp.style.cssText = 'width:100%;padding:10px 12px;margin:4px 0 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;user-select:text;-webkit-user-select:text';
    var tabs = document.createElement('div');
    tabs.className = 'seg'; tabs.style.cssText = 'margin:0 0 6px';
    var list = document.createElement('div');
    list.style.cssText = 'margin:0 -20px';
    box.appendChild(inp); box.appendChild(tabs); box.appendChild(list);
    var fav = readFav(), sort = readSort();
    if (sort === 'fav' && !fav.length) sort = 'vol';
    [['fav', '★ 관심'], ['vol', '거래대금'], ['up', '상승'], ['down', '하락']].forEach(function (o) {
        var b = document.createElement('button');
        b.textContent = o[1]; b.className = o[0] === sort ? 'on' : '';
        b.onclick = function () {
            sort = o[0]; saveSort(sort);
            Array.prototype.forEach.call(tabs.children, function (x) { x.className = x === b ? 'on' : ''; });
            render();
        };
        tabs.appendChild(b);
    });
    function star(t, b) {
        var s = document.createElement('span'), on = fav.indexOf(t.symbol) >= 0;
        s.textContent = on ? '★' : '☆'; s.title = on ? '관심 종목에서 빼기' : '관심 종목에 추가';
        s.style.cssText = 'flex:0 0 auto;padding:6px 2px 6px 8px;font-size:18px;color:' + (on ? 'var(--gold)' : 'var(--muted)');
        s.onclick = function (e) {
            e.stopPropagation();
            var i = fav.indexOf(t.symbol);
            if (i >= 0) fav.splice(i, 1); else fav.push(t.symbol);
            saveFav(fav);
            if (sort === 'fav') render();
            else { var now = fav.indexOf(t.symbol) >= 0; s.textContent = now ? '★' : '☆'; s.style.color = now ? 'var(--gold)' : 'var(--muted)'; s.title = now ? '관심 종목에서 빼기' : '관심 종목에 추가'; }
        };
        b.appendChild(s);
    }
    function render() {
        var q = clean(inp.value), cur = CF.symbol(), n = 0;
        list.innerHTML = '';
        // a search looks through everything; the tabs rank what is shown without one
        (q ? tickers || [] : ranked(sort, fav)).some(function (t) {
            if (q && t.symbol.indexOf(q) < 0 && t.name.toUpperCase().indexOf(q) < 0) return false;
            var chg = +t.priceChangePercent, b = document.createElement('button');
            b.className = 'row-opt';
            b.innerHTML = '<span style="flex:1 1 auto;min-width:0"><b>' + t.name + '</b>' + (t.symbol === cur ? ' <span class="check">✓</span>' : '') + '<small>' + t.venue + ' · 거래대금 ' + fmtVol(t.quoteVolume) + '</small></span>' +
                '<span style="text-align:right">' + fmtLast(t.lastPrice) + '<small style="color:' + (chg >= 0 ? 'var(--up)' : 'var(--down)') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</small></span>';
            star(t, b);
            b.onclick = function () { CF.closeSheet(); window.loadSymbol(t.symbol); setTimeout(syncUrl, 0); };
            list.appendChild(b);
            return ++n >= 80;
        });
        if (!n) list.appendChild(CF.noteRow(!tickers ? '불러오는 중…' : !q && sort === 'fav' ? '☆를 눌러 관심 종목을 모아 두세요' : '찾는 종목이 없어요'));
    }
    inp.oninput = render;
    inp.onkeydown = function (e) { if (e.key === 'Enter') { var b = list.querySelector('button'); if (b) b.click(); } };
    CF.openSheet('종목 선택', [box]);
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
    // a mouse hovering an icon button says what it does (the app reads the same names out through accessibility)
    Array.prototype.forEach.call(document.querySelectorAll('#topbar [aria-label], #scale_btns [aria-label], #rail_toggle'), function (b) {
        if (!b.title) b.title = b.getAttribute('aria-label') || '';
    });
    var price = document.getElementById('top_price');
    if (price) price.title = '탭하면 시세 요약 줄을 접거나 펼쳐요';
    window.setImmersive(true);
    window.loadSymbol(s, i || '15m', i);
    setTimeout(syncUrl, 0);
});
})();
