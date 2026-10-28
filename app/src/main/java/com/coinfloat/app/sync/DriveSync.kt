package com.coinfloat.app.sync

import android.app.Activity
import android.content.Intent
import android.content.IntentSender
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * The settings backup (assets/sync.js) in the user's Google Drive, in the app's hidden folder (appDataFolder): only
 * CoinFloat sees it, and the web version (web/cloud.js) reads and writes the same file. Sign-in is Google's own
 * account picker (Google Play services); the Android OAuth client of the "coin-float" Cloud project matches this
 * package and the release key's SHA-1.
 */
object DriveSync {
    private const val SCOPE = "https://www.googleapis.com/auth/drive.appdata"
    private const val NAME = "coinfloat-settings.json"
    private const val FILES = "https://www.googleapis.com/drive/v3/files"
    private const val UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"

    private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

    /**
     * An access token for the Drive app folder, or null when the user cancels. The first time (and when Google wants
     * the account confirmed again) [resolve] shows Google's consent screen and hands its result back.
     */
    fun authorize(activity: Activity, resolve: (IntentSender, (Intent?) -> Unit) -> Unit, onToken: (String?) -> Unit) {
        val client = Identity.getAuthorizationClient(activity)
        val request = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(SCOPE))).build()
        client.authorize(request)
            .addOnSuccessListener { result ->
                val pending = result.pendingIntent
                if (result.hasResolution() && pending != null) {
                    resolve(pending.intentSender) { data ->
                        onToken(runCatching { client.getAuthorizationResultFromIntent(data).accessToken }.getOrNull())
                    }
                } else onToken(result.accessToken)
            }
            .addOnFailureListener { onToken(null) }
    }

    /** Blocking (call off the main thread). */
    fun upload(token: String, json: String) {
        val id = findFile(token)
        val boundary = "cf" + System.currentTimeMillis()
        val meta = if (id == null) JSONObject().put("name", NAME).put("parents", org.json.JSONArray().put("appDataFolder")) else JSONObject()
        val body = "--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$meta\r\n" +
            "--$boundary\r\nContent-Type: application/json\r\n\r\n$json\r\n--$boundary--"
        val url = if (id == null) "$UPLOAD?uploadType=multipart" else "$UPLOAD/$id?uploadType=multipart"
        val req = Request.Builder().url(url).header("Authorization", "Bearer $token")
            .method(if (id == null) "POST" else "PATCH", body.toRequestBody("multipart/related; boundary=$boundary".toMediaType()))
            .build()
        http.newCall(req).execute().use { r -> check(r.isSuccessful) { "Google 드라이브 오류 (${r.code})" } }
    }

    /** The saved settings, or null when nothing was saved yet. Blocking. */
    fun download(token: String): String? {
        val id = findFile(token) ?: return null
        val req = Request.Builder().url("$FILES/$id?alt=media").header("Authorization", "Bearer $token").build()
        return http.newCall(req).execute().use { r ->
            check(r.isSuccessful) { "Google 드라이브 오류 (${r.code})" }
            r.body?.string()
        }
    }

    private fun findFile(token: String): String? {
        val q = java.net.URLEncoder.encode("name='$NAME'", "UTF-8")
        val req = Request.Builder().url("$FILES?spaces=appDataFolder&q=$q&fields=files(id)").header("Authorization", "Bearer $token").build()
        return http.newCall(req).execute().use { r ->
            check(r.isSuccessful) { "Google 드라이브 오류 (${r.code})" }
            JSONObject(r.body?.string() ?: "{}").optJSONArray("files")?.optJSONObject(0)?.optString("id")?.takeIf { it.isNotEmpty() }
        }
    }
}
