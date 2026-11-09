package com.coinfloat.app.alerts

import android.content.Context
import android.util.Log
import com.coinfloat.app.market.Exchange
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Real-time alerts. Rules marked `live` are checked on the candle that is still forming, the moment the condition is
 * met, instead of a few seconds after the candle closes. Volume spikes fire as soon as the running volume passes the
 * threshold, breakouts and line crosses as soon as the price is through, indicator crosses as soon as the forming value
 * crosses (TradingView's "once per bar"). Each fires at most once per candle; the close check of [AlertRunner] uses the
 * same keys, so a rule never notifies twice for one candle.
 *
 * A socket needs a running process, so this runs inside the floating window's foreground service. Without it the same
 * rules are still checked at every close by [AlertScheduler]. One Binance combined stream and one Hyperliquid socket
 * carry the candles of every (symbol, interval) a live rule uses; nothing is open while there are no live rules.
 */
object LiveAlertMonitor {
    private const val TAG = "LiveAlerts"
    private const val EVAL_MS = 700L                 // a forming candle updates every 250 ms; checking more often adds nothing
    // OkHttp's pings find dead sockets; this only catches a socket that is open but silent (a quiet coin can be silent
    // for a while, so it is generous)
    private const val SILENCE_MS = 120_000L
    private const val HISTORY_GAP_MS = 5_000L        // a missing candle refetches the history at most this often
    private const val HL_WS = "wss://api.hyperliquid.xyz/ws"
    private const val BN_WS = "wss://fstream.binance.com/market/stream?streams="
    private const val PREFS_SCREEN_OFF = "liveScreenOff"

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    /** Candles of one (symbol, interval): closed ones plus the one forming now. */
    private class Feed(val symbol: String, val interval: String) {
        @Volatile var closed: List<Bar> = emptyList()
        @Volatile var forming: Bar? = null
        @Volatile var lastEval = 0L
        @Volatile var loading = false
        @Volatile var lastLoad = 0L
        val hlCoin: String? = if (Exchange.of(symbol) == Exchange.HYPERLIQUID) LiveAlertMonitor.resolveHlCoin(symbol) else null
    }

    private var app: Context? = null
    private var scope: CoroutineScope? = null
    private val feeds = java.util.concurrent.ConcurrentHashMap<Pair<String, String>, Feed>()
    // the live rules, read once per change instead of on every check (the store parses JSON)
    @Volatile private var rules: List<AlertRule> = emptyList()
    private var bnSocket: WebSocket? = null
    private var hlSocket: WebSocket? = null
    private var bnGen = 0
    private var hlGen = 0
    private var retryMs = 3_000L
    @Volatile private var lastMsg = 0L
    private var watchdog: Job? = null
    private var screenOn = true
    private var paused = false
    @Volatile var running = false
        private set

    /** Keep watching while the screen is off (costs battery: the candle streams keep the radio awake). Default on. */
    fun screenOffAllowed(context: Context): Boolean =
        context.applicationContext.getSharedPreferences("cf_alerts", Context.MODE_PRIVATE).getBoolean(PREFS_SCREEN_OFF, true)

    fun setScreenOffAllowed(context: Context, on: Boolean) {
        context.applicationContext.getSharedPreferences("cf_alerts", Context.MODE_PRIVATE).edit().putBoolean(PREFS_SCREEN_OFF, on).apply()
        syncPause()
    }

    @Synchronized
    fun start(context: Context) {
        app = context.applicationContext
        if (scope == null) scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        running = true
        refresh(context)
    }

    @Synchronized
    fun stop() {
        running = false
        closeSockets()
        feeds.clear()
        rules = emptyList()
        watchdog?.cancel(); watchdog = null
        scope?.cancel(); scope = null
    }

    /** Screen on / off from the service: with the screen off and watching not allowed, the sockets close until it is on. */
    @Synchronized
    fun setScreenOn(on: Boolean) {
        screenOn = on
        syncPause()
    }

    @Synchronized
    private fun syncPause() {
        val ctx = app ?: return
        val pause = !screenOn && !screenOffAllowed(ctx)
        if (pause == paused) return
        paused = pause
        if (!running || feeds.isEmpty()) return
        if (pause) { Log.d(TAG, "screen off: paused"); closeSockets() }
        else { Log.d(TAG, "resumed"); retryMs = 3_000L; feeds.values.forEach { it.forming = null; loadHistory(it, force = true) }; openSockets() }
    }

    /** The default network changed (Wi-Fi <-> mobile): the old sockets would hang until a ping times out. */
    @Synchronized
    fun reconnectNow() {
        if (!running || paused || feeds.isEmpty()) return
        retryMs = 3_000L
        reconnect()
    }

    /** Rules changed (or the service started): follow the set of live rules. */
    @Synchronized
    fun refresh(context: Context) {
        if (!running) return
        val ctx = context.applicationContext
        app = ctx
        rules = liveRules(ctx)                                   // new thresholds take effect even when the feeds stay the same
        val wanted = rules.map { it.symbol to it.interval }.toSet()
        if (wanted == feeds.keys) return
        closeSockets()
        feeds.keys.retainAll(wanted)
        wanted.forEach { k -> if (!feeds.containsKey(k)) feeds[k] = Feed(k.first, k.second) }
        if (feeds.isEmpty()) { watchdog?.cancel(); watchdog = null; Log.d(TAG, "no live rules"); return }
        Log.d(TAG, "watching ${feeds.keys}")
        paused = !screenOn && !screenOffAllowed(ctx)
        if (paused) return
        feeds.values.forEach { loadHistory(it, force = true) }
        openSockets()
        if (watchdog?.isActive != true) watchdog = scope?.launch {
            var ticks = 0
            while (isActive) {
                delay(10_000L)
                if (!paused && System.currentTimeMillis() - lastMsg > SILENCE_MS) reconnect()
                // Hyperliquid closes sockets that send nothing for a minute; it wants its own ping message (its pong
                // also counts as a message for the silence check)
                if (++ticks % 2 == 0) hlSocket?.send("{\"method\":\"ping\"}")
            }
        }
    }

    /** Live rules this monitor can serve (divergences need confirmed pivots, Variational has no candles). */
    fun liveRules(context: Context): List<AlertRule> = AlertStore(context).rules().filter {
        it.on && it.live && it.kind != "div" && Exchange.of(it.symbol) != Exchange.VARIATIONAL &&
            (Exchange.of(it.symbol) != Exchange.HYPERLIQUID || it.interval in com.coinfloat.app.market.HyperliquidClient.INTERVALS)
    }

    @Synchronized
    private fun reconnect() {
        if (!running || paused || feeds.isEmpty()) return
        Log.d(TAG, "reconnecting")
        closeSockets()
        feeds.values.forEach { it.forming = null; loadHistory(it, force = true) }      // fill what closed while it was down
        openSockets()
    }

    /** After a failure: try again with a growing pause (3 s .. 1 min), so a phone without network does not spin. */
    private fun retryLater(current: () -> Boolean) {
        val wait: Long
        synchronized(this) { wait = retryMs; retryMs = (retryMs * 2).coerceAtMost(60_000L) }
        scope?.launch { delay(wait); if (current()) reconnect() }
    }

    private fun closeSockets() {
        bnGen++; hlGen++
        bnSocket?.cancel(); bnSocket = null
        hlSocket?.cancel(); hlSocket = null
    }

    private fun loadHistory(f: Feed, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (f.loading || (!force && now - f.lastLoad < HISTORY_GAP_MS)) return
        f.loading = true
        f.lastLoad = now
        scope?.launch {
            try {
                val bars = AlertRunner.fetchBars(f.symbol, f.interval, System.currentTimeMillis())
                if (bars.isNotEmpty()) f.closed = bars
            } catch (e: Exception) {
                Log.w(TAG, "history ${f.symbol} ${f.interval}: ${e.message}")
            } finally { f.loading = false }
        } ?: run { f.loading = false }
    }

    private fun openSockets() {
        lastMsg = System.currentTimeMillis()
        val bn = feeds.values.filter { it.hlCoin == null }
        if (bn.isNotEmpty()) {
            val gen = ++bnGen
            val streams = bn.joinToString("/") { it.symbol.lowercase() + "@kline_" + it.interval }
            bnSocket = http.newWebSocket(Request.Builder().url(BN_WS + streams).build(), listener({ gen == bnGen }) { text ->
                val o = JSONObject(text)
                val d = o.optJSONObject("data") ?: return@listener
                val k = d.optJSONObject("k") ?: return@listener
                val f = feeds[d.optString("s") to k.optString("i")] ?: return@listener
                val bar = Bar(k.getLong("t"), k.getString("o").toDouble(), k.getString("h").toDouble(), k.getString("l").toDouble(),
                    k.getString("c").toDouble(), k.getString("v").toDouble(), k.getString("V").toDouble())
                onCandle(f, bar, k.optBoolean("x"))
            })
        }
        val hl = feeds.values.filter { it.hlCoin != null }
        if (hl.isNotEmpty()) {
            val gen = ++hlGen
            hlSocket = http.newWebSocket(Request.Builder().url(HL_WS).build(), object : WebSocketListener() {
                val inner = listener({ gen == hlGen }) { text ->
                    val o = JSONObject(text)
                    if (o.optString("channel") != "candle") return@listener
                    val d = o.optJSONObject("data") ?: return@listener
                    val f = hl.firstOrNull { it.hlCoin == d.optString("s") && it.interval == d.optString("i") } ?: return@listener
                    val v = d.optString("v").toDoubleOrNull() ?: 0.0
                    onCandle(f, Bar(d.getLong("t"), d.getString("o").toDouble(), d.getString("h").toDouble(), d.getString("l").toDouble(),
                        d.getString("c").toDouble(), v, v / 2), false)
                }
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    hl.forEach { f ->
                        webSocket.send(JSONObject().put("method", "subscribe").put("subscription",
                            JSONObject().put("type", "candle").put("coin", f.hlCoin).put("interval", f.interval)).toString())
                    }
                    inner.onOpen(webSocket, response)
                }
                override fun onMessage(webSocket: WebSocket, text: String) = inner.onMessage(webSocket, text)
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = inner.onFailure(webSocket, t, response)
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = inner.onClosed(webSocket, code, reason)
            })
        }
    }

    private fun listener(current: () -> Boolean, handle: (String) -> Unit) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) { lastMsg = System.currentTimeMillis() }
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!current()) return
            lastMsg = System.currentTimeMillis()
            retryMs = 3_000L
            try { handle(text) } catch (e: Exception) { Log.w(TAG, "bad message: ${e.message}") }
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!current()) return
            Log.w(TAG, "socket failed: ${t.message}")
            retryLater(current)
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!current()) return
            retryLater(current)
        }
    }

    /** A candle update: roll the forming candle into the closed list when a new one starts, then check (throttled). */
    private fun onCandle(f: Feed, bar: Bar, isClosed: Boolean) {
        val prev = f.forming
        if (prev != null && bar.openTime > prev.openTime) appendClosed(f, prev)
        if (isClosed) { appendClosed(f, bar); f.forming = null; return }       // the close check of AlertRunner covers it
        f.forming = bar
        val now = System.currentTimeMillis()
        if (now - f.lastEval < EVAL_MS) return
        f.lastEval = now
        val closed = f.closed
        if (closed.isEmpty() || closed.last().openTime >= bar.openTime) return
        // a gap (missed candles while the socket was down) would compare against the wrong candles
        if (bar.openTime - closed.last().openTime != AlertTime.length(f.interval) && f.interval != "1w") { loadHistory(f); return }
        evaluate(f, closed + bar)
    }

    private fun appendClosed(f: Feed, bar: Bar) {
        val c = f.closed
        if (c.isEmpty() || bar.openTime <= c.last().openTime) return
        f.closed = (if (c.size >= 300) c.drop(c.size - 299) else c) + bar
    }

    private fun evaluate(f: Feed, bars: List<Bar>) {
        val ctx = app ?: return
        val mine = this.rules.filter { it.symbol == f.symbol && it.interval == f.interval }
        if (mine.isEmpty()) return
        val fired = ArrayList<Pair<AlertRule, Signal>>()
        for (r in mine) {
            val sig = runCatching { AlertRunner.evaluate(r, bars) }.getOrNull() ?: continue
            fired += r to sig
        }
        if (fired.isEmpty()) return
        val now = System.currentTimeMillis()
        val events = ArrayList<AlertEvent>()
        var disabled = false
        synchronized(AlertStore.LOCK) {
            val store = AlertStore(ctx)
            val state = store.state()
            val disable = HashSet<String>()
            val stillOn = store.rules().filter { it.on }.map { it.id }.toSet()     // a one-shot rule the close check used up
            for ((r, sig) in fired) {
                if (r.id !in stillOn) continue
                val st = state.optJSONObject(r.id) ?: JSONObject()
                val sent = st.optJSONArray("keys") ?: JSONArray()
                if ((0 until sent.length()).any { sent.optString(it) == sig.key }) continue
                sent.put(sig.key)
                while (sent.length() > 20) sent.remove(0)
                st.put("keys", sent)
                state.put(r.id, st)
                events += AlertEvent(r.id, r.symbol, r.interval, sig.candleTime, now, sig.title, liveDetail(sig.detail), sig.marker, sig.dir, live = true)
                if (r.once) disable += r.id
            }
            if (events.isEmpty()) return
            store.saveState(state)
            if (disable.isNotEmpty()) {
                store.saveRules(store.rules().map { if (it.id in disable) it.copy(on = false) else it })
                disabled = true
            }
            store.addHistory(events)
        }
        events.forEach { AlertNotifier.post(ctx, it) }
        Log.d(TAG, "fired ${events.map { it.title }}")
        if (disabled) scope?.launch { refresh(ctx) }
    }

    /** The engine describes a closed candle ("... 위에서 마감"); a live signal is about the price right now. */
    fun liveDetail(detail: String) = detail.replace("에서 마감", "에서 거래 중")

    private fun resolveHlCoin(symbol: String): String {
        val hl = com.coinfloat.app.market.HyperliquidClient
        return com.coinfloat.app.market.MarketDataRepository.getInstance().getSymbolInfo(symbol)?.pair ?: hl.guessCoin(symbol)
    }
}
