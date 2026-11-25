package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Offline synthetic debug package only; exercises the real Android Keystore. */
@RunWith(AndroidJUnit4::class)
class SessionStoreInstrumentedTest {
    private lateinit var context: Context

    @Before fun prepare() {
        context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        assertTrue(SessionStore(context).clear())
    }

    @After fun cleanUp() {
        if (::context.isInitialized) SessionStore(context).clear()
    }

    @Test fun concurrentLegacyRestoresShareOneIdentityAndCanBeCleared() {
        val original = Session("synthetic-access", "synthetic-refresh", System.currentTimeMillis() / 1000 + 3600)
        SessionStore(context).save(original)
        val prefs = context.getSharedPreferences("native_session_v1", Context.MODE_PRIVATE)
        val encrypted = Base64.decode(prefs.getString("session", null)!!, Base64.NO_WRAP)
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = keyStore.getKey("printly_owner_native_session_v1", null) as SecretKey
        val decrypt = Cipher.getInstance("AES/GCM/NoPadding")
        decrypt.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
        val legacy = JSONObject(decrypt.doFinal(encrypted.copyOfRange(12, encrypted.size)).toString(Charsets.UTF_8))
        legacy.remove("local_id")
        val encrypt = Cipher.getInstance("AES/GCM/NoPadding")
        encrypt.init(Cipher.ENCRYPT_MODE, key)
        val encoded = Base64.encodeToString(encrypt.iv + encrypt.doFinal(legacy.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        assertTrue(prefs.edit().putString("session", encoded).commit())

        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(8)
        val restored = try {
            val futures = (1..8).map {
                pool.submit<Session?> {
                    check(start.await(10, TimeUnit.SECONDS))
                    SessionStore(context).load()
                }
            }
            start.countDown()
            futures.map { it.get(30, TimeUnit.SECONDS) }
        } finally { pool.shutdownNow() }
        assertTrue(restored.all { it != null })
        val first = restored.first()!!
        assertTrue(validPushUuid(first.localId))
        assertNotEquals(original.localId, first.localId)
        assertEquals(1, restored.map { it!!.localId }.toSet().size)
        assertEquals("synthetic-access", first.accessToken)
        assertEquals(first, SessionStore(context).load())
        assertTrue(SessionStore(context).clear())
        assertNull(SessionStore(context).load())
    }
}
