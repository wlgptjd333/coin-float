package com.coinfloat.app.alerts

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.coinfloat.app.MainActivity
import com.coinfloat.app.R
import com.coinfloat.app.ui.SettingsViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Rules, per-rule progress and the fired history, in one small SharedPreferences file. */
class AlertStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("cf_alerts", Context.MODE_PRIVATE)

    fun rules(): List<AlertRule> = AlertRule.listFromJson(prefs.getString("rules", "[]"))
    fun saveRules(list: List<AlertRule>) {
        val a = JSONArray(); list.take(AlertRule.MAX_RULES).forEach { a.put(it.toJson()) }
        prefs.edit().putString("rules", a.toString()).apply()
        // progress of rules that are gone is dropped
        val keep = list.map { it.id }.toSet()
        val st = state(); st.keys().asSequence().toList().filter { it !in keep }.forEach { st.remove(it) }
        prefs.edit().putString("state", st.toString()).apply()
    }

    /** Per rule: "last" = open time of the newest candle checked, "keys" = signals already sent (divergences repeat otherwise). */
    fun state(): JSONObject = runCatching { JSONObject(prefs.getString("state", "{}") ?: "{}") }.getOrDefault(JSONObject())
    fun saveState(o: JSONObject) { prefs.edit().putString("state", o.toString()).apply() }

    fun history(): List<AlertEvent> = runCatching {
        val a = JSONArray(prefs.getString("history", "[]"))
        (0 until a.length()).map { AlertEvent.fromJson(a.getJSONObject(it)) }
    }.getOrDefault(emptyList())
    fun addHistory(events: List<AlertEvent>) {
        val all = (events + history()).take(MAX_HISTORY)
        val a = JSONArray(); all.forEach { a.put(it.toJson()) }
        prefs.edit().putString("history", a.toString()).apply()
    }
    fun clearHistory() { prefs.edit().putString("history", "[]").apply() }

    companion object { const val MAX_HISTORY = 100 }
}

/**
 * Wakes up when a candle of any alert's interval closes (AlarmManager; no service runs in between, so it costs almost
 * nothing), fetches the closed candles of the symbols that are due, checks every rule and posts a notification per hit.
 */
object AlertScheduler {
    private const val TAG = "AlertScheduler"
    private const val SETTLE_MS = 2_500L          // Binance needs a moment after the close to serve the final candle
    const val ACTION_CHECK = "com.coinfloat.app.action.ALERT_CHECK"

    fun schedule(context: Context) {
        val rules = AlertStore(context).rules().filter { it.on }
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pending(context)
        if (rules.isEmpty()) { am.cancel(pi); return }
        val now = System.currentTimeMillis()
        val at = rules.minOf { AlertTime.nextClose(it.interval, now) } + SETTLE_MS
        try {
            if (canExact(context)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
        Log.d(TAG, "next check in ${(at - now) / 1000}s for ${rules.size} rules")
    }

    fun canExact(context: Context): Boolean {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    }

    private fun pending(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 7301, Intent(context, AlertReceiver::class.java).setAction(ACTION_CHECK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}

class AlertReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> { AlertScheduler.schedule(app); return }
        }
        val done = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try { withTimeoutOrNull(8_000L) { AlertRunner.run(app) } }
            catch (e: Exception) { Log.e("AlertReceiver", "check failed", e) }
            finally { AlertScheduler.schedule(app); done.finish() }
        }
    }
}

object AlertRunner {
    private val http = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).build()
    private const val BARS = 300

    /** Closed candles only (the forming one is dropped). */
    fun fetchBars(symbol: String, interval: String, now: Long): List<Bar> {
        val url = "https://fapi.binance.com/fapi/v1/klines?symbol=$symbol&interval=$interval&limit=${BARS + 1}"
        http.newCall(Request.Builder().url(url).get().build()).execute().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("HTTP ${r.code}")
            val a = JSONArray(r.body?.string() ?: "[]")
            val cur = AlertTime.currentOpen(interval, now)
            return (0 until a.length()).map { a.getJSONArray(it) }.filter { it.getLong(0) < cur }.map {
                Bar(it.getLong(0), it.getString(1).toDouble(), it.getString(2).toDouble(), it.getString(3).toDouble(),
                    it.getString(4).toDouble(), it.getString(5).toDouble(), it.getString(9).toDouble())
            }
        }
    }

    /** Signals of one rule on the newest closed candle. */
    fun evaluate(rule: AlertRule, bars: List<Bar>): Signal? = when (rule.kind) {
        "vol" -> AlertEngine.volumeSpike(bars, rule.mult)
        "div" -> AlertEngine.divergence(
            bars,
            when (rule.src) { "macd" -> AlertEngine.Source.MACD; "cvd" -> AlertEngine.Source.CVD; "vol" -> AlertEngine.Source.VOLUME; else -> AlertEngine.Source.RSI },
            regular = rule.reg, hidden = rule.hid, bull = rule.up, bear = rule.down, right = rule.right
        )
        "brk" -> AlertEngine.breakout(bars, rule.len, rule.up, rule.down, rule.volMult)
        "ind" -> AlertEngine.indicatorCross(bars, rule.cond, rule.up, rule.down, rule.len, rule.lvl, rule.len2, rule.ma != "sma", rule.bbm)
        "line" -> AlertEngine.lineCross(bars, rule.t1, rule.p1, rule.t2, rule.p2, AlertTime.length(rule.interval), rule.up, rule.down,
            rule.label.ifEmpty { if (rule.p1 == rule.p2) AlertEngine.fmtP(rule.p1) else "추세선" })
        else -> null
    }

    suspend fun run(context: Context) {
        val store = AlertStore(context)
        val rules = store.rules().filter { it.on }
        if (rules.isEmpty()) return
        val now = System.currentTimeMillis()
        val state = store.state()
        // rules whose interval closed a candle they have not seen yet, grouped so each chart is fetched once
        val due = rules.filter { r -> (state.optJSONObject(r.id)?.optLong("last", 0L) ?: 0L) < AlertTime.lastClosedOpen(r.interval, now) }
        if (due.isEmpty()) return
        val groups = due.groupBy { it.symbol to it.interval }
        val fetched = kotlinx.coroutines.coroutineScope {
            groups.keys.map { k -> async { k to runCatching { fetchBars(k.first, k.second, now) }.getOrNull() } }.awaitAll()
        }.toMap()
        val events = ArrayList<AlertEvent>()
        val disable = HashSet<String>()
        for (r in due) {
            val bars = fetched[r.symbol to r.interval] ?: continue        // network down: try again at the next close
            if (bars.isEmpty()) continue
            val st = state.optJSONObject(r.id) ?: JSONObject()
            val sent = st.optJSONArray("keys") ?: JSONArray()
            val sig = evaluate(r, bars)
            st.put("last", bars.last().openTime)
            if (sig != null && (0 until sent.length()).none { sent.optString(it) == sig.key }) {
                sent.put(sig.key)
                while (sent.length() > 20) sent.remove(0)
                events += AlertEvent(r.id, r.symbol, r.interval, sig.candleTime, now, sig.title, sig.detail, sig.marker)
                if (r.once) disable += r.id
            }
            st.put("keys", sent)
            state.put(r.id, st)
        }
        store.saveState(state)
        if (disable.isNotEmpty()) store.saveRules(store.rules().map { if (it.id in disable) it.copy(on = false) else it })
        if (events.isNotEmpty()) {
            store.addHistory(events)
            events.forEach { AlertNotifier.post(context, it) }
        }
    }
}

object AlertNotifier {
    const val CHANNEL_ID = "coinfloat_alerts"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "차트 알람", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "거래량 급증 · 다이버전스 · 돌파 알람"
        })
    }

    fun post(context: Context, e: AlertEvent) {
        ensureChannel(context)
        val base = e.symbol.removeSuffix("USDT")
        val tap = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_TARGET_TAB, SettingsViewModel.TAB_CHART)
            putExtra(MainActivity.EXTRA_TARGET_SYMBOL, e.symbol)
            putExtra(MainActivity.EXTRA_TARGET_INTERVAL, e.interval)
        }
        val id = (e.ruleId + e.candleTime).hashCode()
        val pi = PendingIntent.getActivity(context, id, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$base ${label(e.interval)} · ${e.title}")
            .setContentText(e.detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(e.detail))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setWhen(e.at)
            .build()
        // without the notification permission nothing shows; the alert is still in the history list on the chart
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        runCatching { NotificationManagerCompat.from(context).notify(id, n) }
    }

    fun label(interval: String) = when {
        interval.endsWith("m") -> interval.dropLast(1) + "분"
        interval.endsWith("h") -> interval.dropLast(1) + "시간"
        interval == "1d" -> "일봉"
        interval == "1w" -> "주봉"
        else -> interval
    }
}
