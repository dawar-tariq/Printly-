package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Always try both ways to make stored session data unreadable. */
internal fun clearSessionStorage(removeCiphertext: () -> Boolean, removeKey: () -> Boolean): Boolean {
    val ciphertextRemoved = try { removeCiphertext() } catch (_: Exception) { false }
    val keyRemoved = try { removeKey() } catch (_: Exception) { false }
    return ciphertextRemoved || keyRemoved
}

/** Access and refresh tokens are encrypted with a non-exportable Android Keystore key. */
class SessionStore(context: Context) {
    // Activities, workers and messaging callbacks create separate SessionStore
    // instances. Serialize them all, especially a one-time legacy ID upgrade
    // and a concurrent clear/save, rather than locking each instance alone.
    private companion object { val sessionLock = Any() }
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

    fun save(session: Session) = synchronized(sessionLock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, requireNotNull(key(true)))
        require(validPushUuid(session.localId))
        val plain = JSONObject().put("access_token", session.accessToken).put("refresh_token", session.refreshToken)
            .put("expires_at", session.expiresAt).put("local_id", session.localId).toString().toByteArray(Charsets.UTF_8)
        val ciphertext = cipher.doFinal(plain)
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        check(prefs.edit().putString("session", encoded).commit()) { "Could not persist encrypted session" }
    }

    fun load(): Session? = synchronized(sessionLock) {
        val encoded = prefs.getString("session", null) ?: return@synchronized null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size > 12 + 16)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, requireNotNull(key(false)), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        val data = JSONObject(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
        val access = data.getString("access_token")
        val refresh = data.getString("refresh_token")
        val expiry = data.getLong("expires_at")
        require(access.isNotBlank() && refresh.isNotBlank() && access.length <= 8192 && refresh.length <= 8192 && expiry > 0)
        // Older signed builds did not store a local identity. Upgrade their
        // encrypted session once, before it can be associated with push.
        val needsUpgrade = !data.has("local_id")
        val localId = if (needsUpgrade) UUID.randomUUID().toString() else data.getString("local_id")
        require(validPushUuid(localId))
        val restored = Session(access, refresh, expiry, localId)
        if (needsUpgrade) save(restored)
        restored
    }

    /** Fail closed if ciphertext or the Keystore cannot be read. */
    fun localIdOrNull(): String? = try { load()?.localId } catch (_: Exception) { null }

    /** Either removing ciphertext or deleting its key prevents restoration. */
    fun clear(): Boolean = synchronized(sessionLock) {
        clearSessionStorage(
            removeCiphertext = { prefs.edit().remove("session").commit() },
            removeKey = {
                val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                store.deleteEntry(alias)
                !store.containsAlias(alias)
            },
        )
    }
}
