// Pine Script® indicators on the in-app chart. Scripts (the built-in library in pine_lib.js or code the user pastes)
// run with PineTS (AGPL-3.0) in a Web Worker, started only once a script is on, over the candles the chart already has;
// their plots become chart series, hlines price lines, plotshape/plotchar markers, and fill / bgcolor / line / label /
// box drawings paint through a series primitive. Pine Script® is a trademark of TradingView, Inc.
(function () {
'use strict';
var CF = window.CF; if (!CF) return;
var LW = CF.LW, chart = CF.chart, LS = CF.LS;

var MAX_FEED = 1500;        // newest candles a script runs on
var LIVE_MS = 4000;         // the forming candle is recomputed at most this often, and never more often than 4x the
                            // time the last run took (heavy script sets refresh less often instead of keeping a core busy)
var RUN_TIMEOUT_MS = 20000;
var MAX_ON = 10;
var CLEAR = 'rgba(0,0,0,0)';

// ---- storage -------------------------------------------------------------------------------------------------------
// [{ id, lib?, src, on, inputs: { in_0: v }, style: { plotTitle: { hide, c, w } } }]
var scripts = LS.get('pine', []);
if (!Array.isArray(scripts)) scripts = [];
scripts = scripts.filter(function (s) { return s && typeof s.src === 'string'; });
var nextId = scripts.reduce(function (m, s) { return Math.max(m, s.id || 0); }, 0) + 1;
function save() { LS.set('pine', scripts.map(function (s) { return { id: s.id, lib: s.lib, src: s.src, on: s.on, inputs: s.inputs || {}, style: s.style || {} }; })); }
function libOf(id) { return (window.PINE_LIB || []).filter(function (l) { return l.id === id; })[0]; }
function srcOf(s) { var l = s.lib && libOf(s.lib); return l ? l.src : s.src; }   // library scripts follow app updates

// ---- loading PineTS on demand -------------------------------------------------------------------------------------
var workerP = null, worker = null, reqs = {}, rid = 0;
function loadScript(src) {
    return new Promise(function (res, rej) {
        var el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = function () { rej(new Error('load ' + src)); };
        document.head.appendChild(el);
    });
}
// PineTS runs in a Web Worker, so a heavy script never stalls panning or the live price. The page is a file:// URL,
// which cannot start worker files: the worker is built from PineTS's source (pinets_src.js) plus workerMain below.
function workerMain() {
    var cache = {}, htf = {};
    // Market data for PineTS: the chart's own candles for the chart's symbol and interval; any other interval
    // (request.security) comes from Binance USD-M futures, cached for 30 s.
    var BINANCE_TF = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', '360': '6h',
        '480': '8h', '720': '12h', 'D': '1d', '1D': '1d', '3D': '3d', 'W': '1w', '1W': '1w', 'M': '1M', '1M': '1M' };
    function bare(t) { return String(t || '').replace(/^[A-Z]+:/, '').replace(/\.P$/, '').toUpperCase(); }
    function makeProvider(m) {
        return {
            configure: function () {},
            getSymbolInfo: function () {
                var sym = m.symbol;
                return Promise.resolve({ ticker: sym, tickerid: sym, main_tickerid: sym, prefix: 'BINANCE', root: sym, description: sym + ' Perpetual',
                    type: 'crypto', basecurrency: sym.replace(/USDT$|USDC$/, ''), currency: 'USDT', timezone: 'Etc/UTC', session: '24x7',
                    mintick: m.mintick, minmove: 1, pricescale: Math.round(1 / m.mintick), pointvalue: 1, volumetype: 'base', current_contract: '', isin: '', country: '',
                    employees: 0, industry: '', sector: '', shareholders: 0, shares_outstanding_float: 0, shares_outstanding_total: 0, expiration_date: 0,
                    mincontract: 0, recommendations_buy: 0, recommendations_buy_strong: 0, recommendations_date: 0, recommendations_hold: 0,
                    recommendations_sell: 0, recommendations_sell_strong: 0, recommendations_total: 0, target_price_average: 0, target_price_date: 0,
                    target_price_estimates: 0, target_price_high: 0, target_price_low: 0, target_price_median: 0 });
            },
            getMarketData: function (tickerId, tf, limit, sDate, eDate) {
                var sym = bare(tickerId) || m.symbol, t = String(tf || m.tf);
                if (sym === m.symbol && (t === m.tf || !tf)) return Promise.resolve(m.candles);
                var iv = BINANCE_TF[t]; if (!iv) return Promise.reject(new Error('지원하지 않는 시간대: ' + t));
                var key = sym + '|' + iv + '|' + (eDate || ''), c = htf[key];
                if (c && Date.now() - c.at < 30000) return Promise.resolve(c.data);
                var url = 'https://fapi.binance.com/fapi/v1/klines?symbol=' + encodeURIComponent(sym) + '&interval=' + iv + '&limit=1500' + (eDate ? '&endTime=' + Math.floor(eDate) : '');
                return fetch(url).then(function (r) { if (!r.ok) throw new Error('Binance ' + r.status); return r.json(); }).then(function (raw) {
                    var data = raw.map(function (k) { return { openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] + 1,
                        quoteAssetVolume: +k[7], numberOfTrades: k[8], takerBuyBaseAssetVolume: +k[9], takerBuyQuoteAssetVolume: +k[10], ignore: 0 }; });
                    htf[key] = { at: Date.now(), data: data };
                    return data;
                });
            }
        };
    }
    function plain(ctx) {
        var plots = {};
        Object.keys(ctx.plots || {}).forEach(function (k) {
            var p = ctx.plots[k];
            plots[k] = { options: p.options || {}, data: (p.data || []).map(function (d) { return { value: d.value, options: d.options }; }) };
        });
        var ind = ctx.indicator || {};
        return { plots: plots, indicator: { title: ind.title, shorttitle: ind.shorttitle, overlay: !!ind.overlay } };
    }
    self.onmessage = function (e) {
        var m = e.data;
        var fail = function (err) { self.postMessage({ rid: m.rid, error: String(err && err.message || err) }); };
        try {
            if (m.type === 'meta') { self.postMessage({ rid: m.rid, inputs: new PineTSLib.Indicator(m.src).getInputsMeta() }); return; }
            if (m.type === 'drop') { delete cache[m.id]; return; }
            if (m.type !== 'run') return;
            var c = cache[m.id];
            if (!c || c.src !== m.src) c = cache[m.id] = { src: m.src, ind: new PineTSLib.Indicator(m.src) };
            c.ind.inputs = m.inputs || {};
            var t0 = Date.now();
            new PineTS(makeProvider(m), m.symbol, m.tf, m.candles.length).run(c.ind).then(function (ctx) {
                var r = plain(ctx); r.rid = m.rid; r.ms = Date.now() - t0; self.postMessage(r);
            }, fail);
        } catch (err) { fail(err); }
    };
}
function ensureWorker() {
    if (worker) return Promise.resolve(worker);
    return workerP || (workerP = loadScript('pinets_src.js').then(function () {
        var code = window.PINETS_SRC + '\n;(' + workerMain.toString() + ')();';
        worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
        window.PINETS_SRC = null;                                          // the worker has it; free the page's copy
        worker.onmessage = function (e) { var r = reqs[e.data.rid]; if (r) { delete reqs[e.data.rid]; clearTimeout(r.t); r.res(e.data); } };
        worker.onerror = function (e) { console.error('pine worker', e.message); };
        return worker;
    }).catch(function (e) { workerP = null; throw e; }));
}
function ask(msg) {
    return ensureWorker().then(function (w) {
        return new Promise(function (res, rej) {
            var id = ++rid; msg.rid = id;
            // a script that never ends (an endless loop) takes the worker down; a fresh one serves the next request
            var t = setTimeout(function () { delete reqs[id]; restartWorker(); rej(new Error('계산이 ' + RUN_TIMEOUT_MS / 1000 + '초 안에 끝나지 않았어요')); }, RUN_TIMEOUT_MS);
            reqs[id] = { res: function (d) { if (d.error) rej(new Error(d.error)); else res(d); }, t: t };
            w.postMessage(msg);
        });
    });
}
function restartWorker() {
    try { worker && worker.terminate(); } catch (e) { /* gone */ }
    worker = null; workerP = null;
    Object.keys(reqs).forEach(function (k) { clearTimeout(reqs[k].t); reqs[k].res({ error: '중단됨' }); delete reqs[k]; });
}
function ensurePine() { return ensureWorker(); }
function ensureLib() { return window.PINE_LIB ? Promise.resolve() : loadScript('pine_lib.js'); }

// ---- run ---------------------------------------------------------------------------------------------------------
var rts = {};              // id -> runtime { ind, srcUsed, series, anchor, pane, prim, markers, priceLines, plots, feedStart, title, overlay, err }
var running = false, again = false, liveT = 0, lastRun = 0, lastCost = 0;

function tfOf(iv) {
    var n = parseInt(iv, 10), u = iv.slice(-1);
    if (u === 'm') return String(n);
    if (u === 'h') return String(n * 60);
    if (u === 'd') return n === 1 ? 'D' : n + 'D';
    if (u === 'w') return n === 1 ? 'W' : n + 'W';
    return n === 1 ? 'M' : n + 'M';
}
function feed() {
    var c = CF.candles(), start = Math.max(0, c.length - MAX_FEED), out = [], ms = CF.secs() * 1000;
    for (var i = start; i < c.length; i++) {
        var k = c[i];
        out.push({ openTime: k.time * 1000, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, closeTime: (k.time * 1000) + ms,
            quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: k.buy || 0, takerBuyQuoteAssetVolume: 0, ignore: 0 });
    }
    return { start: start, data: out };
}
function schedule(kind) {
    if (!scripts.some(function (s) { return s.on; })) return;
    if (kind === 'last') {
        var wait = Math.max(LIVE_MS, lastCost * 4) - (Date.now() - lastRun);
        if (wait > 0) { if (!liveT) liveT = setTimeout(function () { liveT = 0; runAll(); }, wait); return; }
    }
    clearTimeout(liveT); liveT = 0;
    runAll();
}
CF.onData(schedule);

function runAll() {
    if (!CF.active() || !CF.candles().length) return;
    if (running) { again = true; return; }
    running = true; again = false; lastRun = Date.now();
    var on = scripts.filter(function (s) { return s.on; }), t0 = Date.now();
    ensurePine().then(ensureLib).then(function () {
        var f = feed(), p = Promise.resolve();
        on.forEach(function (s) { p = p.then(function () { return runOne(s, f); }); });
        return p;
    }).catch(function (e) { console.error(e); }).then(function () {
        running = false; lastRun = Date.now(); lastCost = Date.now() - t0;
        CF.scheduleLegend(); CF.redrawNow();
        if (again) runAll();
    });
}
function runOne(s, f) {
    var rt = rts[s.id] || (rts[s.id] = { series: {}, priceLines: [], plots: {} });
    var sym = CF.symbol(), iv = CF.interval();
    return ask({ type: 'run', id: s.id, src: srcOf(s), inputs: Object.assign({}, s.inputs || {}), candles: f.data, symbol: sym, tf: tfOf(iv), mintick: Math.pow(10, -CF.precision()) }).then(function (ctx) {
        if (!s.on || !rts[s.id] || sym !== CF.symbol() || iv !== CF.interval()) return;   // switched off / chart moved on meanwhile
        rt.err = null; rt.feedStart = f.start; rt.n = f.data.length;
        rt.title = (ctx.indicator && (ctx.indicator.shorttitle || ctx.indicator.title)) || '스크립트';
        rt.fullTitle = (ctx.indicator && ctx.indicator.title) || rt.title;
        rt.overlay = !!(ctx.indicator && ctx.indicator.overlay);
        render(s, rt, ctx.plots || {});
    }, function (e) {
        rt.err = String(e && e.message || e).slice(0, 400);
        console.error('pine', rt.err);
    });
}

// ---- render ------------------------------------------------------------------------------------------------------
var LINE_STYLES = { dashed: 2, dotted: 1, solid: 0 };
function styleOf(p) { var st = p.options && p.options.style; return st ? String(st).replace(/^style_/, '') : 'line'; }
function isSeriesStyle(st) { return ['line', 'linebr', 'stepline', 'stepline_diamond', 'histogram', 'columns', 'area', 'areabr', 'circles', 'cross'].indexOf(st) >= 0; }
function colorOk(c) { return typeof c === 'string' && c.length > 3; }
function timeAt(rt, i) {             // time (s) of plot index i, or null outside the loaded candles
    var c = CF.candles(), k = rt.feedStart + i; return k >= 0 && k < c.length ? c[k].time : null;
}
function removeAll(rt) {
    Object.keys(rt.series).forEach(function (k) { try { chart.removeSeries(rt.series[k]); } catch (e) { /* gone */ } });
    rt.series = {}; rt.anchor = null; rt.priceLines = []; rt.prim = null; rt.markers = null; rt.hidden = null;
}
function render(s, rt, plots) {
    var st = s.style || {};
    // a script switching between overlay and its own pane starts over
    if (rt.overlayDrawn != null && rt.overlayDrawn !== rt.overlay) detachVisuals(rt);
    rt.overlayDrawn = rt.overlay;
    // a script in its own pane is a pane member of the chart: the chart decides its pane (order, merging, moving onto
    // the main chart) and mounts it, which renders it again from these plots
    if (!rt.overlay) {
        rt.lastPlots = plots;
        if (!rt.member) { rt.member = memberFor(s, rt); CF.paneMember('p' + s.id, rt.member); return; }
        if (!rt.mountedNow) return;
    } else if (rt.member) { rt.member = null; CF.paneMember('p' + s.id, null); }
    var pane = rt.overlay ? 0 : rt.pane, sid = rt.overlay ? null : rt.sid;
    rt.plots = {}; rt.ahead = 0;
    var keep = {}, markers = [], fills = [], bgs = [], hlines = [], tints = {}, drawings = { lines: [], labels: [], boxes: [] };
    Object.keys(plots).forEach(function (key) {
        var p = plots[key], o = p.options || {}, kind = styleOf(p), data = p.data || [];
        if (key === '__lines__' || key === '__labels__' || key === '__boxes__') {
            var last = data.length ? data[data.length - 1].value : null;
            if (Array.isArray(last)) drawings[key.slice(2, -2)] = last.filter(function (x) { return x && !x._deleted; });
            return;
        }
        if (key.indexOf('__') === 0) return;
        if (kind === 'fill') { fills.push({ o: o, data: data }); return; }
        if (kind === 'hline') { hlines.push({ title: key, value: data.length ? data[data.length - 1].value : null, o: o }); rt.plots[key] = { values: data.map(function (d) { return d.value; }), hline: true, color: colorOk(o.color) ? o.color : '#787B86' }; return; }
        if (kind === 'background') { bgs.push(data); return; }
        var off = +o.offset || 0;
        if (kind === 'barcolor') {                                      // candle colors: na keeps the candle's own
            data.forEach(function (d, i) {
                var c = d.options && d.options.color; if (!colorOk(c) || d.value == null || d.value === false) return;
                var t = timeAt(rt, i + off); if (t != null) tints[t] = c;
            });
            return;
        }
        var values = [], colors = [];
        data.forEach(function (d, i) { values[i] = d.value; colors[i] = d.options && d.options.color; });
        rt.plots[key] = { values: values, colors: colors, offset: off, color: o.color, kind: kind, width: +o.linewidth || 1 };
        if (kind === 'shape' || kind === 'char' || kind === 'arrow') {
            data.forEach(function (d, i) {
                var v = d.value; if (v == null || v === false || (typeof v === 'number' && isNaN(v))) return;
                var t = timeAt(rt, i + off); if (t == null) return;
                markers.push(markerOf(kind, d.options || o, o, v, t));
            });
            return;
        }
        if (!isSeriesStyle(kind) || o.display === 'none') return;
        var ps = st[key] || {};
        if (ps.hide) return;
        keep[key] = 1;
        var se = rt.series[key], type = kind === 'histogram' || kind === 'columns' ? 'hist' : kind === 'area' || kind === 'areabr' ? 'area' : 'line';
        if (se && se.__type !== type) { try { chart.removeSeries(se); } catch (e) { /* gone */ } se = null; }
        var base = ps.c || (colorOk(o.color) ? o.color : '#2962FF'), width = ps.w || +o.linewidth || 1;
        if (!se) {
            var common = { priceLineVisible: false, lastValueVisible: !rt.overlay, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: precisionFor(values), minMove: Math.pow(10, -precisionFor(values)) } };
            if (sid) common.priceScaleId = sid;
            if (type === 'hist') se = chart.addSeries(LW.HistogramSeries, Object.assign(common, { color: base }), pane);
            else if (type === 'area') se = chart.addSeries(LW.AreaSeries, Object.assign(common, { lineColor: base, topColor: CF.hexA(hex6(base), 0.25), bottomColor: CF.hexA(hex6(base), 0.02), lineWidth: width }), pane);
            else se = chart.addSeries(LW.LineSeries, Object.assign(common, { color: base, lineWidth: width }), pane);
            se.__type = type;
            rt.series[key] = se;
            if (sid) fitScale(se, pane);
        }
        if (type === 'line') se.applyOptions({
            color: base, lineWidth: width,
            lineType: kind.indexOf('stepline') === 0 ? 1 : 0,
            lineVisible: kind !== 'circles' && kind !== 'cross',
            pointMarkersVisible: kind === 'circles' || kind === 'cross', pointMarkersRadius: Math.max(1.5, width)
        });
        se.setData(seriesData(rt, values, colors, off, base, ps.c, kind));
        rt.plots[key].drawn = { base: base, forced: ps.c, width: width, type: type };
        if (off > 0) rt.ahead = Math.max(rt.ahead, off);
        if (!rt.anchor) rt.anchor = se;
    });
    CF.barTint(s.id, tints, CF.symbol() + '|' + CF.interval());
    // series of plots that are gone or hidden
    Object.keys(rt.series).forEach(function (k) { if (k !== '__carrier' && !keep[k]) { try { chart.removeSeries(rt.series[k]); } catch (e) { /* gone */ } delete rt.series[k]; } });
    if (rt.anchor && !keep[keyOf(rt, rt.anchor)]) rt.anchor = null;
    var anyKey = Object.keys(rt.series).filter(function (k) { return k !== '__carrier'; })[0];
    if (!rt.anchor && anyKey) rt.anchor = rt.series[anyKey];
    // panes without a line still need a series for hlines, markers and drawings: an invisible carrier
    var needCarrier = !rt.overlay && (!rt.anchor || rt.anchor.__carrier);
    if (needCarrier) {
        var car = rt.series.__carrier;
        if (!car) {
            car = chart.addSeries(LW.LineSeries, Object.assign({ lineVisible: false, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, sid ? { priceScaleId: sid } : {}), pane);
            car.__carrier = true; car.__type = 'line'; rt.series.__carrier = car;
            if (sid) fitScale(car, pane);
        }
        var hv = hlines.map(function (h) { return h.value; }).filter(function (v) { return typeof v === 'number'; });
        var vals = hv.length ? hv : [0];
        var cs = CF.candles(), cd = [];
        for (var j = rt.feedStart; j < cs.length; j++) cd.push({ time: cs[j].time, value: vals[(j - rt.feedStart) % vals.length] });
        car.setData(cd);
        rt.anchor = car;
    } else if (rt.series.__carrier && rt.anchor !== rt.series.__carrier) {
        try { chart.removeSeries(rt.series.__carrier); } catch (e) { /* gone */ }
        delete rt.series.__carrier;
    }
    var target = rt.overlay ? CF.mainSeries() : rt.anchor;
    // hlines
    rt.priceLines.forEach(function (pl) { try { pl.s.removePriceLine(pl.l); } catch (e) { /* gone */ } });
    rt.priceLines = [];
    if (target) hlines.forEach(function (h) {
        if (typeof h.value !== 'number' || (st[h.title] || {}).hide) return;
        var col = (st[h.title] || {}).c || (colorOk(h.o.color) ? h.o.color : '#787B86');
        rt.priceLines.push({ s: target, l: target.createPriceLine({ price: h.value, color: col, lineWidth: 1, lineStyle: LINE_STYLES[h.o.linestyle] != null ? LINE_STYLES[h.o.linestyle] : 2, axisLabelVisible: false, title: '' }) });
    });
    // markers
    markers.sort(function (a, b) { return a.time - b.time; });
    var mTarget = rt.overlay ? CF.mainSeries() : rt.anchor;
    if (rt.markers && rt.markersOn !== mTarget) { try { rt.markers.detach(); } catch (e) { /* gone */ } rt.markers = null; }
    if (mTarget && (markers.length || rt.markers)) {
        if (!rt.markers) { rt.markers = LW.createSeriesMarkers(mTarget, []); rt.markersOn = mTarget; }
        rt.markers.setMarkers(markers);
    }
    // fills, backgrounds, drawings
    rt.fills = fills; rt.bgs = bgs; rt.drawings = drawings;
    var pTarget = rt.overlay ? CF.mainSeries() : rt.anchor;
    if (rt.prim && rt.primOn !== pTarget) { try { rt.primOn.detachPrimitive(rt.prim); } catch (e) { /* gone */ } rt.prim = null; }
    if (pTarget && !rt.prim && (rt.ahead || fills.length || bgs.length || drawings.lines.length || drawings.labels.length || drawings.boxes.length)) {
        rt.prim = makePrimitive(rt); rt.primOn = pTarget; pTarget.attachPrimitive(rt.prim);
    }
    if (rt.prim && rt.prim._req) rt.prim._req();
}
function keyOf(rt, se) { var k = null; Object.keys(rt.series).forEach(function (x) { if (rt.series[x] === se) k = x; }); return k; }
// own scale inside a shared pane (or laid over the main chart: the lower part, like volume)
function fitScale(se, pane) { try { se.priceScale().applyOptions({ scaleMargins: pane ? { top: 0.15, bottom: 0.12 } : { top: 0.62, bottom: 0.04 } }); } catch (e) { /* ignore */ } }
function detachVisuals(rt) {
    if (rt.markers) { try { rt.markers.detach(); } catch (e) { /* gone */ } }
    if (rt.prim && rt.primOn) { try { rt.primOn.detachPrimitive(rt.prim); } catch (e) { /* gone */ } }
    (rt.priceLines || []).forEach(function (pl) { try { pl.s.removePriceLine(pl.l); } catch (e) { /* gone */ } });
    removeAll(rt);
}
function memberFor(s, rt) {
    return {
        name: function () { return rt.title || titleOf(s); },
        color: function () {
            var k = Object.keys(rt.plots).filter(function (x) { return rt.series[x]; })[0], p = k && rt.plots[k];
            return hex6((s.style && s.style[k] && s.style[k].c) || (p && p.color) || '#B2B5BE');
        },
        legend: function (i) { return legendOf(s, rt, i); },
        settings: function () { openScriptSettings(s); },
        close: function () { setOn(s, false); },
        mount: function (pane, sid) { rt.pane = pane; rt.sid = sid; rt.mountedNow = true; if (rt.lastPlots) render(s, rt, rt.lastPlots); },
        unmount: function () { rt.mountedNow = false; detachVisuals(rt); }
    };
}
function hex6(c) { return typeof c === 'string' && c[0] === '#' ? c.slice(0, 7) : '#2962FF'; }
function precisionFor(values) {
    var m = 0; for (var i = values.length - 1, n = 0; i >= 0 && n < 50; i--) { var v = values[i]; if (typeof v === 'number' && isFinite(v)) { m = Math.max(m, Math.abs(v)); n++; } }
    if (m >= 1000) return Math.min(2, CF.precision()); if (m >= 10) return 2; if (m >= 1) return 3; return Math.max(4, CF.precision());
}
// one data point per candle; na leaves a gap: whitespace, and for broken styles the segment into it is cleared
function seriesData(rt, values, colors, off, base, forced, kind) {
    var out = [], brk = kind === 'linebr' || kind === 'areabr' || kind === 'circles' || kind === 'cross';
    for (var i = 0; i < values.length; i++) {
        var t = timeAt(rt, i + off); if (t == null) continue;
        var v = values[i];
        if (typeof v !== 'number' || !isFinite(v)) { out.push({ time: t }); continue; }
        var col = forced || (colorOk(colors[i]) ? colors[i] : colors[i] === null ? CLEAR : base);
        var nv = values[i + 1];
        if (brk && (typeof nv !== 'number' || !isFinite(nv))) col = kind === 'circles' || kind === 'cross' ? col : CLEAR;
        out.push({ time: t, value: v, color: col });
    }
    return out;
}
var SHAPES = { shape_triangle_up: 'arrowUp', shape_arrow_up: 'arrowUp', shape_label_up: 'arrowUp', shape_triangle_down: 'arrowDown', shape_arrow_down: 'arrowDown', shape_label_down: 'arrowDown', shape_circle: 'circle', shape_square: 'square', shape_diamond: 'square' };
var SIZES = { tiny: 0.6, small: 1, normal: 1.4, large: 1.9, huge: 2.5, auto: 1 };
function markerOf(kind, d, o, v, t) {
    var loc = String(d.location || o.location || 'AboveBar').toLowerCase(), color = colorOk(d.color) ? d.color : colorOk(o.color) ? o.color : '#2962FF';
    var m = { time: t, color: color, size: SIZES[d.size || o.size] || 1 };
    if (loc.indexOf('below') >= 0 || loc === 'bottom') m.position = 'belowBar';
    else if (loc.indexOf('absolute') >= 0 && typeof v === 'number') { m.position = 'atPriceMiddle'; m.price = v; }
    else m.position = 'aboveBar';
    if (kind === 'char') { m.shape = 'circle'; m.size = 0.01; m.text = d.char || o.char || '•'; }
    else if (kind === 'arrow') { m.shape = v >= 0 ? 'arrowUp' : 'arrowDown'; m.position = v >= 0 ? 'belowBar' : 'aboveBar'; }
    else m.shape = SHAPES[d.shape || o.shape] || (m.position === 'belowBar' ? 'arrowUp' : 'arrowDown');
    var txt = d.text || o.text; if (txt && kind !== 'char') m.text = String(txt);
    return m;
}

// ---- fills, bgcolor and drawings, painted inside the script's pane ---------------------------------------------------
function makePrimitive(rt) {
    var prim = { _req: null, attached: function (p) { prim._req = p.requestUpdate; }, detached: function () { prim._req = null; }, updateAllViews: function () {},
        paneViews: function () { return [bottom, top]; } };
    var bottom = { zOrder: function () { return 'bottom'; }, renderer: function () { return { draw: function (t) { drawBottom(rt, t); } }; } };
    var top = { zOrder: function () { return 'top'; }, renderer: function () { return { draw: function (t) { drawTop(rt, t); } }; } };
    return prim;
}
function yScale(rt) { var s = rt.overlay ? CF.mainSeries() : rt.anchor; return function (p) { return s ? s.priceToCoordinate(p) : null; }; }
function visibleIdx(rt) {
    var r = chart.timeScale().getVisibleLogicalRange(); if (!r) return null;
    return { a: Math.max(0, Math.floor(r.from) - rt.feedStart - 1), z: Math.min(rt.n - 1 + (rt.ahead || 0), Math.ceil(r.to) - rt.feedStart + 1) };
}
function xOfIdx(rt, i) { return chart.timeScale().logicalToCoordinate(rt.feedStart + i); }
function barW() { var ts = chart.timeScale(), a = ts.logicalToCoordinate(0), b = ts.logicalToCoordinate(1); return a == null || b == null ? 6 : Math.max(1, b - a); }
function drawBottom(rt, target) {
    var vis = visibleIdx(rt); if (!vis) return;
    var y = yScale(rt), bw = barW();
    target.useMediaCoordinateSpace(function (sc) {
        var ctx = sc.context, h = sc.mediaSize.height;
        (rt.bgs || []).forEach(function (data) {
            for (var i = vis.a; i <= vis.z; i++) {
                var d = data[i]; if (!d || !d.value) continue;
                var col = d.options && d.options.color; if (!colorOk(col)) continue;
                var x = xOfIdx(rt, i); if (x == null) continue;
                ctx.fillStyle = col; ctx.fillRect(x - bw / 2, 0, bw, h);
            }
        });
        (rt.fills || []).forEach(function (f) {
            var a = rt.plots[f.o.plot1], b = rt.plots[f.o.plot2]; if (!a || !b) return;
            var def = colorOk(f.o.color) ? f.o.color : 'rgba(41,98,255,.1)', col = null;
            // the color is per bar (fill(p1, p2, color = a > b ? up : down)); it moves with the plots when both are shifted
            var shift = !a.hline && !b.hline && (a.offset || 0) === (b.offset || 0) ? a.offset || 0 : 0;
            var top = [], bot = [];
            for (var i = vis.a; i <= vis.z; i++) {
                var va = a.hline ? a.values[a.values.length - 1] : a.values[i - (a.offset || 0)];
                var vb = b.hline ? b.values[b.values.length - 1] : b.values[i - (b.offset || 0)];
                var x = xOfIdx(rt, i);
                if (typeof va !== 'number' || typeof vb !== 'number' || !isFinite(va) || !isFinite(vb) || x == null) { flush(); continue; }
                var ya = y(va), yb = y(vb); if (ya == null || yb == null) { flush(); continue; }
                var fd = f.data[i - shift], fc = fd && fd.options ? fd.options.color : undefined;
                var c = colorOk(fc) ? fc : fc === null ? null : def;
                if (c !== col) {                                        // a new color starts where the last one ended
                    var lt = top.slice(-2), lb = bot.slice(-2);
                    flush(); col = c; top = lt; bot = lb;
                }
                if (c == null) { top = []; bot = []; continue; }
                top.push(x, ya); bot.push(x, yb);
            }
            flush();
            function flush() {
                if (top.length >= 4 && col) {
                    ctx.beginPath(); ctx.moveTo(top[0], top[1]);
                    for (var j = 2; j < top.length; j += 2) ctx.lineTo(top[j], top[j + 1]);
                    for (var k = bot.length - 2; k >= 0; k -= 2) ctx.lineTo(bot[k], bot[k + 1]);
                    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
                }
                top = []; bot = [];
            }
        });
    });
}
var FONT = { tiny: 9, small: 10, normal: 11, large: 13, huge: 16, auto: 11 };
function xOfDraw(rt, x, xloc) {
    if (xloc === 'bt' || xloc === 'bar_time') { var l = CF.logicalOfTime(x / 1000); return l == null ? null : chart.timeScale().logicalToCoordinate(Math.round(l)); }
    return chart.timeScale().logicalToCoordinate(rt.feedStart + x);
}
function dashFor(st) { st = String(st || ''); return st.indexOf('dash') >= 0 ? [6, 4] : st.indexOf('dot') >= 0 ? [2, 3] : []; }
// Plots shifted forward (offset > 0) run past the newest candle; the series stop there (the time scale only has
// candle times), so the part ahead of price is drawn here, continuing from the series' last point.
function drawAhead(rt, ctx) {
    if (!rt.ahead) return;
    var y = yScale(rt), vis = visibleIdx(rt); if (!vis || vis.z < rt.n - 1) return;
    Object.keys(rt.plots).forEach(function (k) {
        var p = rt.plots[k], d = p.drawn; if (!d || !(p.offset > 0) || d.type === 'hist' || !rt.series[k]) return;
        var dots = p.kind === 'circles' || p.kind === 'cross', step = p.kind.indexOf('stepline') === 0, prev = null;
        ctx.lineWidth = d.width; ctx.lineJoin = 'round';
        for (var j = Math.max(0, rt.n - 1 - p.offset); j < p.values.length; j++) {
            var v = p.values[j], x = xOfIdx(rt, j + p.offset), yy = typeof v === 'number' && isFinite(v) ? y(v) : null;
            if (x == null || yy == null) { prev = null; continue; }
            var c = d.forced || (colorOk(p.colors[j]) ? p.colors[j] : d.base);
            if (dots) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, yy, Math.max(1.5, d.width), 0, Math.PI * 2); ctx.fill(); }
            else if (prev) {
                ctx.strokeStyle = colorOk(prev.c) ? prev.c : d.base; ctx.beginPath(); ctx.moveTo(prev.x, prev.y);
                if (step) ctx.lineTo(x, prev.y); ctx.lineTo(x, yy); ctx.stroke();
            }
            prev = { x: x, y: yy, c: c };
        }
    });
}
function drawTop(rt, target) {
    var dr = rt.drawings;
    if (rt.ahead) target.useMediaCoordinateSpace(function (sc) { drawAhead(rt, sc.context); });
    if (!dr) return;
    var y = yScale(rt);
    target.useMediaCoordinateSpace(function (sc) {
        var ctx = sc.context, w = sc.mediaSize.width;
        dr.boxes.forEach(function (b) {
            var x1 = xOfDraw(rt, b.left, b.xloc), x2 = xOfDraw(rt, b.right, b.xloc), y1 = y(b.top), y2 = y(b.bottom);
            if (x1 == null || x2 == null || y1 == null || y2 == null) return;
            if (b.extend === 'r' || b.extend === 'both' || b.extend === 'b') x2 = w;
            if (b.extend === 'l' || b.extend === 'both' || b.extend === 'b') x1 = 0;
            if (colorOk(b.bgcolor)) { ctx.fillStyle = b.bgcolor; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); }
            if (colorOk(b.border_color) && b.border_width !== 0) { ctx.setLineDash(dashFor(b.border_style)); ctx.lineWidth = b.border_width || 1; ctx.strokeStyle = b.border_color; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.setLineDash([]); }
            if (b.text) { ctx.fillStyle = colorOk(b.text_color) ? b.text_color : '#fff'; ctx.font = (FONT[b.text_size] || 11) + 'px -apple-system, Roboto, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.text, (x1 + x2) / 2, (y1 + y2) / 2); ctx.textAlign = 'start'; }
        });
        dr.lines.forEach(function (l) {
            var x1 = xOfDraw(rt, l.x1, l.xloc), x2 = xOfDraw(rt, l.x2, l.xloc), y1 = y(l.y1), y2 = y(l.y2);
            if (x1 == null || x2 == null || y1 == null || y2 == null) return;
            var dx = x2 - x1, dy = y2 - y1, k;
            if ((l.extend === 'r' || l.extend === 'b' || l.extend === 'both') && dx) { k = (w - x2) / dx; if (k > 0) { x2 += dx * k; y2 += dy * k; } }
            if ((l.extend === 'l' || l.extend === 'b' || l.extend === 'both') && dx) { k = x1 / dx; if (k > 0) { x1 -= dx * k; y1 -= dy * k; } }
            ctx.setLineDash(dashFor(l.style)); ctx.lineWidth = l.width || 1; ctx.strokeStyle = colorOk(l.color) ? l.color : '#2962FF';
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        });
        dr.labels.forEach(function (lb) {
            var x = xOfDraw(rt, lb.x, lb.xloc), yy = y(lb.y); if (x == null || yy == null || !lb.text) return;
            var fs = FONT[lb.size] || 11; ctx.font = '600 ' + fs + 'px -apple-system, Roboto, sans-serif';
            var tw = ctx.measureText(lb.text).width + 10, th = fs + 7, style = String(lb.style || ''), bx = x - tw / 2, by;
            if (style.indexOf('label_up') >= 0) by = yy + 6; else if (style.indexOf('none') >= 0) by = yy - th / 2; else by = yy - th - 6;
            if (style.indexOf('label_left') >= 0) { bx = x + 6; by = yy - th / 2; } else if (style.indexOf('label_right') >= 0) { bx = x - tw - 6; by = yy - th / 2; }
            if (style.indexOf('none') < 0 && colorOk(lb.color)) { ctx.fillStyle = lb.color; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, tw, th, 4); else ctx.rect(bx, by, tw, th); ctx.fill(); }
            ctx.fillStyle = colorOk(lb.textcolor) ? lb.textcolor : '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(lb.text, bx + 5, by + th / 2);
        });
    });
}

// ---- legend: "<title> v1 v2 ..." at the crosshair candle ------------------------------------------------------------
function legendOf(s, rt, ci) {
    if (rt.err) return '<span style="color:#F6465D">' + esc(rt.title || '스크립트') + ' 오류</span>';
    var vals = [];
    Object.keys(rt.series).forEach(function (k) {
        if (k === '__carrier') return;
        var p = rt.plots[k]; if (!p) return;
        var v = p.values[ci - rt.feedStart - (p.offset || 0)];
        if (typeof v === 'number' && isFinite(v)) vals.push('<span style="color:' + hex6((s.style && s.style[k] && s.style[k].c) || p.color) + '">' + fmt(v) + '</span>');
    });
    return '<span style="color:#B2B5BE">' + esc(rt.title || titleOf(s)) + '</span>' + (vals.length ? ' ' + vals.join(' ') : '');
}
CF.legend(function (ci) {
    var parts = [];
    scripts.forEach(function (s) {
        var rt = rts[s.id]; if (!s.on || !rt || (rt.member && !rt.err)) return;
        var h = legendOf(s, rt, ci); if (rt.err || h.indexOf('</span> ') > 0) parts.push(h);
    });
    return parts.join(' &nbsp;');
});
function fmt(v) { var a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1000 ? CF.fmtPrice(v) : a >= 1 ? v.toFixed(2) : v.toFixed(4); }
function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// ---- add / remove / toggle -----------------------------------------------------------------------------------------
function teardown(id) {
    if (worker) worker.postMessage({ type: 'drop', id: id });
    var rt = rts[id]; if (!rt) return;
    delete rts[id];
    if (rt.member) { rt.member = null; rt.mountedNow = false; CF.paneMember('p' + id, null); }
    detachVisuals(rt);
    CF.barTint(id, null);
    CF.scheduleLegend(); CF.redrawNow();
}
function setOn(s, on) {
    if (on && scripts.filter(function (x) { return x.on; }).length >= MAX_ON) { CF.toast('스크립트는 동시에 ' + MAX_ON + '개까지 켤 수 있어요'); return false; }
    s.on = on; save();
    if (on) runAll(); else teardown(s.id);
    return true;
}
function addScript(src, lib) {
    var s = { id: nextId++, lib: lib || undefined, src: lib ? '' : src, on: false, inputs: {}, style: {} };
    scripts.push(s); save();
    setOn(s, true);
    return s;
}
function removeScript(s) {
    teardown(s.id);
    CF.paneForget('p' + s.id);
    scripts = scripts.filter(function (x) { return x !== s; }); save();
}
function titleOf(s) {
    var rt = rts[s.id]; if (rt && rt.fullTitle) return rt.fullTitle;
    var l = s.lib && libOf(s.lib); if (l) return l.name;
    var m = /indicator\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/.exec(s.src || ''); return m ? m[1] : '내 스크립트';
}

// ---- UI: rows in the indicator sheet ------------------------------------------------------------------------------
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
CF.indicatorRows(function () {
    var rows = [CF.sectionTitle('Pine Script 지표')];
    scripts.forEach(function (s) {
        var rt = rts[s.id], sub = rt && rt.err ? '<small style="color:#F6465D">오류: ' + esc(rt.err.slice(0, 80)) + '</small>' : '<small>' + (s.lib ? '라이브러리' : '내 스크립트') + '</small>';
        var b = el('div', 'row-opt', '<span style="flex:1">' + esc(titleOf(s)) + sub + '</span><button class="gear" aria-label="설정">⚙</button><span class="switch' + (s.on ? ' on' : '') + '"></span>');
        b.setAttribute('role', 'button');
        b.onclick = function (e) {
            if (e.target.closest('.gear')) { openScriptSettings(s); return; }
            if (setOn(s, !s.on)) b.querySelector('.switch').classList.toggle('on', s.on);
        };
        rows.push(b);
    });
    var lib = el('div', 'row-opt', '<span style="flex:1">＋ 지표 라이브러리<small>일목균형표 · 스토캐스틱 RSI · ADX · SAR · 스퀴즈 등 22개</small></span><span style="color:var(--muted)">›</span>');
    lib.onclick = openLibrary;
    var paste = el('div', 'row-opt', '<span style="flex:1">＋ Pine Script 붙여넣기<small>트레이딩뷰 오픈소스 스크립트 · 직접 작성</small></span><span style="color:var(--muted)">›</span>');
    paste.onclick = function () { openEditor(null); };
    rows.push(lib, paste);
    return rows;
});

function openLibrary() {
    ensureLib().then(function () {
        var rows = [], cats = {};
        window.PINE_LIB.forEach(function (l) { (cats[l.cat] || (cats[l.cat] = [])).push(l); });
        Object.keys(cats).forEach(function (c) {
            rows.push(CF.sectionTitle(c));
            cats[c].forEach(function (l) {
                var has = scripts.filter(function (s) { return s.lib === l.id; })[0];
                var b = el('div', 'row-opt', '<span style="flex:1">' + esc(l.name) + '<small>' + esc(l.desc) + '</small></span><span class="switch' + (has && has.on ? ' on' : '') + '"></span>');
                b.onclick = function () {
                    var cur = scripts.filter(function (s) { return s.lib === l.id; })[0];
                    if (!cur) addScript(null, l.id); else setOn(cur, !cur.on);
                    cur = scripts.filter(function (s) { return s.lib === l.id; })[0];
                    b.querySelector('.switch').classList.toggle('on', !!(cur && cur.on));
                };
                rows.push(b);
            });
        });
        rows.push(CF.noteRow('표준 공식으로 작성한 Pine Script 지표입니다. 켠 뒤 지표 목록의 ⚙ 에서 기간 · 색 · 두께를 바꿀 수 있습니다. 최근 ' + MAX_FEED.toLocaleString() + '봉 기준으로 계산합니다.'));
        CF.openSheet('지표 라이브러리', rows);
        backBtn(CF.openIndicators);
    }).catch(function () { CF.toast('라이브러리를 불러오지 못했어요'); });
}
function backBtn(fn) {
    var h = document.querySelector('#sheet h3'); if (!h || h.querySelector('.back')) return;
    var b = el('button', 'back', '‹'); b.setAttribute('aria-label', '뒤로'); b.onclick = fn; h.insertBefore(b, h.firstChild);
}

// ---- UI: script settings (inputs from the script, style per plot) ----------------------------------------------------
function openScriptSettings(s) {
    if (!window.PINE_LIB || !s.__meta || s.__metaSrc !== srcOf(s)) {
        ensureLib().then(function () { return ask({ type: 'meta', src: srcOf(s) }); }).then(function (d) {
            s.__meta = d.inputs || []; s.__metaSrc = srcOf(s); openScriptSettings(s);
        }, function () { s.__meta = []; s.__metaSrc = srcOf(s); openScriptSettings(s); });
        return;
    }
    var rt = rts[s.id];
    var rows = [];
    var meta = s.__meta;
    if (rt && rt.err) rows.push(el('div', 'note', '<b style="color:#F6465D">실행 오류</b><br>' + esc(rt.err)));
    if (meta.length) rows.push(CF.sectionTitle('입력값'));
    meta.forEach(function (m) { var r = inputRow(s, m); if (r) rows.push(r); });
    var plots = rt ? Object.keys(rt.plots).filter(function (k) { return rt.plots[k] && (rt.plots[k].kind == null || isSeriesStyle(rt.plots[k].kind)); }) : [];
    if (plots.length) rows.push(CF.sectionTitle('스타일'));
    plots.forEach(function (k) { rows.push(styleRow(s, k, rt.plots[k])); });
    var acts = el('div', 'fld', '<div class="seg"><button class="edit">코드 보기 · 수정</button><button class="del" style="color:#F6465D">삭제</button></div>');
    acts.querySelector('.edit').onclick = function () { openEditor(s); };
    acts.querySelector('.del').onclick = function () { removeScript(s); CF.toast('스크립트를 지웠어요'); CF.openIndicators(); };
    rows.push(acts);
    if (s.lib) rows.push(CF.noteRow('라이브러리 지표의 코드를 수정하면 내 스크립트로 복사돼 저장됩니다.'));
    CF.openSheet(esc(titleOf(s)), rows);
    backBtn(CF.openIndicators);
}
var rerunT = 0;
function changed(s) { save(); clearTimeout(rerunT); rerunT = setTimeout(runAll, 250); }
function inputRow(s, m) {
    var key = m.id, cur = s.inputs && s.inputs[key] !== undefined ? s.inputs[key] : m.defval, label = esc(m.title || m.name || key);
    var set = function (v) { (s.inputs || (s.inputs = {}))[key] = v; changed(s); };
    var row = el('div', 'fld');
    if (m.type === 'bool') {
        row.innerHTML = '<div class="top"><span>' + label + '</span><span class="switch' + (cur ? ' on' : '') + '"></span></div>';
        row.onclick = function () { cur = !cur; row.querySelector('.switch').classList.toggle('on', cur); set(cur); };
    } else if ((m.type === 'int' || m.type === 'float' || m.type === 'price') && !(m.options && m.options.length)) {
        row.innerHTML = '<div class="top"><span>' + label + '</span><input type="number" inputmode="decimal" step="' + (m.step || (m.type === 'int' ? 1 : 'any')) + '" value="' + esc(cur) + '"></div>';
        var inp = row.querySelector('input');
        inp.onchange = function () {
            var n = parseFloat(inp.value); if (!isFinite(n)) { inp.value = cur; return; }
            if (m.type === 'int') n = Math.round(n);
            if (m.minval != null) n = Math.max(m.minval, n); if (m.maxval != null) n = Math.min(m.maxval, n);
            inp.value = n; cur = n; set(n);
        };
    } else if (m.options && m.options.length) {
        row.innerHTML = '<div class="top"><span>' + label + '</span></div><div class="seg"></div>';
        m.options.forEach(function (o) {
            var b = el('button', String(o) === String(cur) ? 'on' : '', esc(o));
            b.onclick = function () { [].forEach.call(row.querySelectorAll('.seg button'), function (x) { x.className = ''; }); b.className = 'on'; cur = o; set(o); };
            row.querySelector('.seg').appendChild(b);
        });
    } else if (m.type === 'color') {
        var c0 = colorOk(cur) ? hex6(cur) : '#2962FF';
        row.innerHTML = '<div class="top"><span>' + label + '</span><span class="chip-dot" style="background:' + c0 + '"></span></div>';
        var strip = null;
        row.querySelector('.top').onclick = function () {
            if (strip) { strip.remove(); strip = null; return; }
            strip = CF.colorStrip(c0, function (c) { c0 = c; row.querySelector('.chip-dot').style.background = c; set(c); });
            row.appendChild(strip);
        };
    } else {
        row.innerHTML = '<div class="top"><span>' + label + '</span><input type="text" class="hex" style="width:120px" value="' + esc(cur == null ? '' : cur) + '"></div>';
        var ti = row.querySelector('input');
        ti.onchange = function () { cur = ti.value; set(ti.value); };
    }
    return row;
}
function styleRow(s, k, p) {
    var st = (s.style || (s.style = {}))[k] || {}, col = hex6(st.c || p.color), w = st.w || p.width || 1;
    var row = el('div', 'fld', '<div class="ln"><button class="chip-dot" style="background:' + col + '" aria-label="색상"></button><span style="flex:1">' + esc(k) + (p.hline ? ' <small style="color:var(--muted)">수평선</small>' : '') + '</span>' +
        (p.hline ? '' : '<button class="tag w">' + w + 'px</button>') + '<span class="switch' + (st.hide ? '' : ' on') + '"></span></div>');
    var put = function (patch) { s.style[k] = Object.assign({}, s.style[k] || {}, patch); changed(s); };
    row.querySelector('.switch').onclick = function () { var h = !(s.style[k] || {}).hide; this.classList.toggle('on', !h); put({ hide: h }); };
    if (row.querySelector('.w')) row.querySelector('.w').onclick = function () { w = w >= 4 ? 1 : w + 1; this.textContent = w + 'px'; put({ w: w }); };
    var strip = null;
    row.querySelector('.chip-dot').onclick = function () {
        if (strip) { strip.remove(); strip = null; return; }
        strip = CF.colorStrip(col, function (c) { col = c; row.querySelector('.chip-dot').style.background = c; put({ c: c }); });
        row.appendChild(strip);
    };
    return row;
}

// ---- UI: code editor (paste or write) -------------------------------------------------------------------------------
var SAMPLE = '//@version=5\nindicator("내 지표", overlay=true)\nlen = input.int(20, "기간")\nplot(ta.ema(close, len), "EMA", color=color.orange)';
function openEditor(s) {
    var rows = [];
    var box = el('div', 'fld');
    box.innerHTML = '<textarea class="code" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="' + esc(SAMPLE) + '"></textarea>' +
        '<div class="seg" style="margin-top:8px"><button class="paste">클립보드에서 붙여넣기</button><button class="clear">지우기</button><button class="run on">적용</button></div>' +
        '<div class="err note" style="padding:8px 0 0;color:#F6465D;display:none"></div>';
    var ta = box.querySelector('textarea'), err = box.querySelector('.err');
    ta.value = s ? srcOf(s) : '';
    box.querySelector('.paste').onclick = function () {
        var t = '';
        try { if (window.AndroidBridge && window.AndroidBridge.readClipboard) t = window.AndroidBridge.readClipboard('') || ''; } catch (e) { t = ''; }
        if (t) { ta.value = t; err.style.display = 'none'; return; }
        if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (x) { ta.value = x || ta.value; }, function () { CF.toast('클립보드가 비어 있어요'); });
        else CF.toast('클립보드가 비어 있어요');
    };
    box.querySelector('.clear').onclick = function () { ta.value = ''; };
    box.querySelector('.run').onclick = function () {
        var code = ta.value.trim(); if (!code) return;
        err.style.display = 'none'; err.textContent = '확인 중…'; err.style.display = 'block'; err.style.color = 'var(--muted)';
        validate(code).then(function () {
            if (s) {
                if (s.lib && code !== srcOf(s)) { s.lib = undefined; }
                s.src = code; s.__meta = null;
                save(); if (!s.on) setOn(s, true); else runAll();
            } else addScript(code);
            CF.closeSheet(); CF.toast('스크립트를 적용했어요');
        }, function (e) {
            err.style.color = '#F6465D'; err.textContent = '실행할 수 없어요: ' + String(e && e.message || e).slice(0, 300);
        });
    };
    rows.push(box);
    rows.push(CF.noteRow('트레이딩뷰에서 오픈소스 스크립트의 "소스 코드"를 복사해 붙여넣거나 직접 작성하세요. 보호 · 초대 전용 스크립트는 코드가 공개되지 않아 가져올 수 없어요. plot · hline · fill · bgcolor · plotshape · line · label · box 를 그립니다 (barcolor · table · strategy 결과는 표시하지 않음).'));
    CF.openSheet(s ? '코드 수정' : 'Pine Script 붙여넣기', rows);
    backBtn(s ? function () { openScriptSettings(s); } : CF.openIndicators);
}
function validate(code) {
    var f = feed(); if (!f.data.length) return Promise.reject(new Error('차트 데이터가 아직 없어요'));
    return ask({ type: 'run', id: -1, src: code, inputs: {}, candles: f.data.slice(-300), symbol: CF.symbol(), tf: tfOf(CF.interval()), mintick: Math.pow(10, -CF.precision()) });
}

// names of library scripts are needed for the list; scripts that were on last time start with the chart's data
if (scripts.length) ensureLib().then(function () { if (scripts.some(function (s) { return s.on; }) && CF.candles().length) runAll(); });
window.__pine = { scripts: function () { return scripts; }, rts: rts, runAll: runAll };
window.__pineBusy = function () { return running; };
window.__pineCost = function () { return lastCost; };
})();
