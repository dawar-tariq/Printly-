package io.github.dawartariq.printly.owner.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Public APK read-only network diagnostic. Never signs in or uses shop data. */
@RunWith(AndroidJUnit4::class)
class NativeDownloadDiagnostic {
    @Test fun downloadPublicAssetWithUpdaterNetworkPath() = runBlocking {
        val expected = "afb2a2e0eb27a0ff40033772e46a4a0764def12baafd5866947d8c687536e356"
        val client = secureHttpClient.newBuilder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build()
        var address = "https://github.com/dawar-tariq/Printly-/releases/download/native-v2.1.3/Printly-for-Shops-2.1.3.apk"
        var redirects = 0
        var complete = false
        var stage = "initial request"
        try {
            while (!complete) {
                client.newCall(Request.Builder().url(address).get().header("Accept", "application/octet-stream").build()).execute().use { response ->
                    if (response.code in setOf(301, 302, 303, 307, 308)) {
                        stage = "redirect validation"
                        val location = response.header("Location") ?: throw AssertionError("Missing redirect location")
                        assertTrue("Unexpected redirect destination", ++redirects <= 3 && validReleaseRedirect(location))
                        address = location
                        stage = "release asset request"
                    } else {
                        stage = "asset response"
                        assertEquals("Unexpected asset status", 200, response.code)
                        val digest = MessageDigest.getInstance("SHA-256")
                        var total = 0L
                        response.body!!.byteStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                digest.update(buffer, 0, count)
                            }
                        }
                        assertTrue("Invalid asset size", total > 0 && total < 150L * 1024 * 1024)
                        assertTrue("Asset digest mismatch", matchesVerifiedApkSha256(expected, digest.digest()))
                        complete = true
                    }
                }
            }
        } catch (error: Exception) {
            // Do not print the signed asset URL, response headers, or exception text.
            throw AssertionError("Network stage $stage failed with ${error.javaClass.name}", null)
        }
    }
}
