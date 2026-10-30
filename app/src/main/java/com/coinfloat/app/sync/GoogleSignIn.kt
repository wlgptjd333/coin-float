package com.coinfloat.app.sync

import android.app.Activity
import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Google's own account sheet for the chart page's sign-in (assets/cloud.js does the rest, the same as on the web). Google
 * does not allow its sign-in page inside a WebView, so the ID token comes from here. The audience is the "CoinFloat Web"
 * OAuth client; the Android client of the same Cloud project matches this package and the signing key's SHA-1.
 */
object GoogleSignIn {
    private const val WEB_CLIENT_ID = "534312997200-8e38s404douiq73396bgisbgjf16khpg.apps.googleusercontent.com"

    /** A Google ID token. Throws with a message for the user when there is none. */
    suspend fun idToken(activity: Activity): String {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(WEB_CLIENT_ID).build())
            .build()
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, request).credential
        } catch (_: GetCredentialCancellationException) {
            error("Google 로그인이 취소됐어요")
        } catch (_: NoCredentialException) {
            error("이 기기에서 쓸 수 있는 Google 계정이 없어요")
        }
        check(credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) { "Google 로그인에 실패했어요" }
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }

    /** Forgets the account choice, so the next sign-in asks again. */
    suspend fun signOut(context: Context) {
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    }
}
