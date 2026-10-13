package com.coinfloat.app.ui.components

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The coins' own logos, fetched by base asset from Binance's image server (the exchange the app shows), with CoinCap
 * as a second source. Each logo is downloaded once and kept on the device for [MAX_AGE_MS]; a coin with no logo is not
 * asked for again for [MISS_RETRY_MS]. New listings need no app update.
 */
object CoinIcons {
    private const val MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000
    private const val MISS_RETRY_MS = 24L * 60 * 60 * 1000
    private const val SIZE_PX = 96                       // decoded size: crisp at 36-44 dp, small in memory

    private val memory = LruCache<String, ImageBitmap>(200)
    private val inFlight = HashMap<String, CompletableDeferred<ImageBitmap?>>()
    private val gate = Semaphore(4)                      // a long search list must not open dozens of connections
    private val http by lazy {
        OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()
    }

    /** "1000PEPE" → "PEPE", "1MBABYDOGE" → "BABYDOGE": futures multiples carry the plain coin's logo. */
    fun logoName(base: String): String {
        val b = base.uppercase()
        val stripped = b.replace(Regex("^(1000000|100000|10000|1000|100|1M)(?=[A-Z])"), "")
        return stripped.ifEmpty { b }
    }

    fun cached(base: String): ImageBitmap? = memory.get(logoName(base))

    suspend fun load(context: Context, base: String): ImageBitmap? {
        val name = logoName(base)
        memory.get(name)?.let { return it }
        val (waiter, owner) = synchronized(inFlight) {
            inFlight[name]?.let { it to false } ?: CompletableDeferred<ImageBitmap?>().also { inFlight[name] = it }.let { it to true }
        }
        if (!owner) return waiter.await()
        val result = runCatching { fetch(context.applicationContext, name) }.getOrNull()
        if (result != null) memory.put(name, result)
        synchronized(inFlight) { inFlight.remove(name) }
        waiter.complete(result)
        return result
    }

    private suspend fun fetch(context: Context, name: String): ImageBitmap? = withContext(Dispatchers.IO) {
        val dir = File(context.filesDir, "coin_icons").apply { mkdirs() }
        val file = File(dir, "$name.png")
        val miss = File(dir, "$name.miss")
        val now = System.currentTimeMillis()
        if (file.exists() && now - file.lastModified() < MAX_AGE_MS) decode(file)?.let { return@withContext it }
        if (miss.exists() && now - miss.lastModified() < MISS_RETRY_MS) return@withContext null
        val urls = listOf(
            "https://bin.bnbstatic.com/static/assets/logos/$name.png",
            "https://assets.coincap.io/assets/icons/${name.lowercase()}@2x.png"
        )
        for (url in urls) {
            val bytes = gate.withPermit {
                runCatching {
                    http.newCall(Request.Builder().url(url).build()).execute().use { r ->
                        val type = r.header("Content-Type").orEmpty()
                        if (r.isSuccessful && type.startsWith("image/")) r.body?.bytes() else null
                    }
                }.getOrNull()
            } ?: continue
            val tmp = File(dir, "$name.tmp")
            tmp.writeBytes(bytes)
            if (tmp.renameTo(file) || run { file.delete(); tmp.renameTo(file) }) {
                miss.delete()
                decode(file)?.let { return@withContext it }
            }
        }
        // keep an expired logo rather than nothing when the servers are unreachable
        if (file.exists()) decode(file)?.let { return@withContext it }
        runCatching { miss.writeText(now.toString()) }
        null
    }

    private fun decode(file: File): ImageBitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= SIZE_PX) sample *= 2
        BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
    }.getOrNull()
}
