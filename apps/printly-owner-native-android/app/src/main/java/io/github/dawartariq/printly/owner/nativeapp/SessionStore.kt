package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Access and refresh tokens are encrypted with a non-exportable Android Keystore key. */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("native_session_v1", Context.MODE_PRIVATE)
    private val alias = "printly_owner_native_session_v1"

    private fun key(create: Boolean): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) return null
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    @Synchronized fun save(session: Session) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, requireNotNull(key(true)))
        val plain = JSONObject().put("access_token", session.accessToken).put("refresh_token", session.refreshToken)
            .put("expires_at", session.expiresAt).toString().toByteArray(Charsets.UTF_8)
        val ciphertext = cipher.doFinal(plain)
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        check(prefs.edit().putString("session", encoded).commit()) { "Could not persist encrypted session" }
    }

    @Synchronized fun load(): Session? {
        val encoded = prefs.getString("session", null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size > 12 + 16)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, requireNotNull(key(false)), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        val data = JSONObject(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
        val access = data.getString("access_token")
        val refresh = data.getString("refresh_token")
        val expiry = data.getLong("expires_at")
        require(access.isNotBlank() && refresh.isNotBlank() && access.length <= 8192 && refresh.length <= 8192 && expiry > 0)
        return Session(access, refresh, expiry)
    }

    /** Used only as an additional local gate before displaying a generic alert. */
    fun hasSession(): Boolean = prefs.contains("session")

    @Synchronized fun clear() {
        prefs.edit().remove("session").commit()
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) } } catch (_: Exception) { /* local ciphertext was removed */ }
    }
}
