package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** No business mutation is retried automatically: a lost response can hide a successful write. */
class AppError(val code: String, override val message: String, val httpStatus: Int = 0) : Exception(message)

data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long)
data class ProofPhoto(val bytes: ByteArray, val mime: String)

interface OwnerApi {
    val isDemo: Boolean
    suspend fun restore(): Boolean
    suspend fun signIn(email: String, password: String)
    /** True means the remote revocation was confirmed. Local credentials are removed either way. */
    suspend fun signOut(): Boolean
    suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject
    suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject
    suspend fun file(path: String): ByteArray
}

private data class PublicConfig(val authOrigin: String, val anonKey: String)
private data class HttpResult(val status: Int, val bytes: ByteArray, val location: String?) {
    fun json(): JSONObject = try { JSONObject(bytes.toString(Charsets.UTF_8)) }
        catch (_: Exception) { throw AppError("invalid_response", "Could not read the server response. Please try again.") }
}

/** Native HTTPS client. The service-role key is never present in this app. */
class LiveOwnerApi(context: Context) : OwnerApi {
    override val isDemo = false
    private val store = SessionStore(context.applicationContext)
    private val lock = Mutex()
    private var session: Session? = null
    private var config: PublicConfig? = null

    override suspend fun restore(): Boolean = lock.withLock {
        session = try { store.load() } catch (_: Exception) { store.clear(); null }
        session != null
    }

    private suspend fun publicConfig(): PublicConfig {
        config?.let { return it }
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/config", "GET", maxBytes = 32_768)
        if (response.status != 200) throw AppError("config", "The app service is not available yet. Please try again later.", response.status)
        val data = response.json()
        val origin = data.optString("supabase_url", "")
        val key = data.optString("supabase_anon_key", "")
        if (data.optInt("api_version", 0) != 1 || !validAuthOrigin(origin, BuildConfig.SUPABASE_HOST) || key.isBlank() || key.length > 8192) {
            throw AppError("config", "The sign-in service could not be verified.")
        }
        return PublicConfig(origin, key).also { config = it }
    }

    override suspend fun signIn(email: String, password: String) = lock.withLock {
        if (email.isBlank() || password.isBlank()) throw AppError("validation", "Enter your email and password.")
        val gate = http("${BuildConfig.SITE_ORIGIN}/api/auth/login-attempt", "POST", maxBytes = 32_768)
        if (gate.status == 429) throw AppError("rate_limit", "Too many sign-in attempts. Please wait before trying again.", 429)
        if (gate.status !in 200..299) throw AppError("gate", "Sign-in protection is temporarily unavailable.", gate.status)
        val cfg = publicConfig()
        val payload = JSONObject().put("email", email.trim()).put("password", password)
        val response = http("${cfg.authOrigin}/auth/v1/token?grant_type=password", "POST", payload, apiKey = cfg.anonKey)
        if (response.status !in 200..299) {
            val message = when (response.status) {
                400, 401 -> "Incorrect email or password."
                429 -> "Too many sign-in attempts. Please wait before trying again."
                else -> "Could not sign in. Please try again."
            }
            throw AppError("sign_in", message, response.status)
        }
        val next = parseSession(response.json())
        try { store.save(next) } catch (_: Exception) { throw AppError("secure_storage", "Could not store your session securely on this device.") }
        session = next
    }

    private suspend fun usableSession(): Session = lock.withLock {
        val current = session ?: throw AppError("session_expired", "Please sign in again.", 401)
        if (current.expiresAt > System.currentTimeMillis() / 1000 + 120) return@withLock current
        val cfg = publicConfig()
        val response = http("${cfg.authOrigin}/auth/v1/token?grant_type=refresh_token", "POST",
            JSONObject().put("refresh_token", current.refreshToken), apiKey = cfg.anonKey)
        if (response.status == 400 || response.status == 401) {
            store.clear(); session = null
            throw AppError("session_expired", "Your session expired. Please sign in again.", 401)
        }
        if (response.status !in 200..299) throw AppError("refresh", "Could not refresh your session. Check your connection.", response.status)
        val next = parseSession(response.json())
        try { store.save(next) } catch (_: Exception) {
            // A rotated refresh token that could not be persisted must not be
            // silently replaced with an older token on the next app launch.
            store.clear(); session = null
            throw AppError("secure_storage", "Could not save your refreshed session securely. Please sign in again.")
        }
        session = next
        next
    }

    override suspend fun signOut(): Boolean = lock.withLock {
        val current = session
        var confirmed = current == null
        if (current != null) {
            confirmed = try {
                val cfg = publicConfig()
                val response = http("${cfg.authOrigin}/auth/v1/logout?scope=local", "POST", token = current.accessToken, apiKey = cfg.anonKey)
                response.status in 200..299
            } catch (_: Exception) { false }
        }
        store.clear(); session = null
        confirmed
    }

    private suspend fun rejectIfUnauthorized(response: HttpResult, access: String) {
        if (response.status == 401) lock.withLock {
            // Don't erase a newer session if a concurrent request finished late.
            if (session?.accessToken == access) { store.clear(); session = null }
        }
    }

    override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
        if (!validApiPath(path)) throw AppError("path", "Invalid app request.")
        val access = usableSession().accessToken
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/$path", method, body, token = access)
        rejectIfUnauthorized(response, access)
        if (response.status !in 200..299) throw serverError(response)
        return response.json()
    }

    override suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject {
        if (!((method == "PUT" && path == "settings") || (method == "POST" && path == "name-proof"))) {
            throw AppError("path", "Invalid proof request.")
        }
        if (photo == null) return request(method, path, body)
        if (photo.bytes.size !in 1..3 * 1024 * 1024 || detectImageMime(photo.bytes) != photo.mime) {
            throw AppError("photo", "Choose a valid JPEG, PNG or WebP shop photo up to 3 MB.")
        }
        val access = usableSession().accessToken
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/$path", method, body, token = access, photo = photo)
        rejectIfUnauthorized(response, access)
        if (response.status !in 200..299) throw serverError(response)
        return response.json()
    }

    override suspend fun file(path: String): ByteArray {
        if (!validApiPath(path)) throw AppError("path", "Invalid file request.")
        val access = usableSession().accessToken
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/$path", "GET", token = access, maxBytes = 26 * 1024 * 1024)
        rejectIfUnauthorized(response, access)
        if (response.status in 200..299) return response.bytes // shop QR or standee
        if (response.status !in listOf(301, 302, 303, 307, 308)) throw serverError(response)
        val destination = response.location ?: throw AppError("file", "Could not prepare this file.")
        // Never forward a bearer token to a redirect destination. Only accept
        // short-lived signed objects from this project's private order bucket.
        if (!validSignedFileUrl(destination, BuildConfig.SUPABASE_HOST)) throw AppError("file", "The file destination could not be verified.")
        val download = http(destination, "GET", maxBytes = 26 * 1024 * 1024)
        if (download.status !in 200..299) throw AppError("file", "Could not download this file. Please try again.", download.status)
        return download.bytes
    }

    private fun parseSession(data: JSONObject): Session {
        val access = data.optString("access_token", "")
        val refresh = data.optString("refresh_token", "")
        val expiry = data.optLong("expires_at", 0).takeIf { it > 0 }
            ?: (System.currentTimeMillis() / 1000 + data.optLong("expires_in", 0))
        if (access.isBlank() || refresh.isBlank() || access.length > 8192 || refresh.length > 8192 || expiry <= System.currentTimeMillis() / 1000) {
            throw AppError("session", "Could not verify the sign-in session. Please try again.")
        }
        return Session(access, refresh, expiry)
    }
}

internal fun validAuthOrigin(value: String, expectedHost: String): Boolean = try {
    val uri = URI(value)
    uri.scheme == "https" && uri.host == expectedHost && uri.port == -1 && uri.userInfo == null &&
        (uri.path == "" || uri.path == "/") && uri.query == null && uri.fragment == null
} catch (_: Exception) { false }

internal fun validSignedFileUrl(value: String, expectedHost: String): Boolean = try {
    val uri = URI(value)
    uri.scheme == "https" && uri.host == expectedHost && uri.port == -1 && uri.userInfo == null &&
        uri.path.startsWith("/storage/v1/object/sign/order-files/") && uri.fragment == null
} catch (_: Exception) { false }

internal fun validApiPath(path: String): Boolean =
    path.isNotBlank() && !path.startsWith('/') && !path.contains("..") && !path.contains('\\') &&
        !path.contains('#') && !path.contains("://") && path.length <= 2048

internal fun detectImageMime(bytes: ByteArray): String? = when {
    bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> "image/jpeg"
    bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) -> "image/png"
    bytes.size >= 12 && bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray()) && bytes.copyOfRange(8, 12).contentEquals("WEBP".toByteArray()) -> "image/webp"
    else -> null
}

private fun serverError(response: HttpResult): AppError {
    val json = try { response.json() } catch (_: Exception) { JSONObject() }
    val error = json.optJSONObject("error")
    val code = error?.optString("code", "server") ?: "server"
    val text = error?.optString("message", "")?.take(300)?.takeIf { it.isNotBlank() }
        ?: if (response.status == 401) "Your session expired. Please sign in again." else "Could not complete the request. Refresh before retrying."
    return AppError(code, text, response.status)
}

private suspend fun http(
    address: String, method: String, body: JSONObject? = null, token: String? = null,
    apiKey: String? = null, maxBytes: Int = 2 * 1024 * 1024, photo: ProofPhoto? = null,
): HttpResult = withContext(Dispatchers.IO) {
    var connection: HttpsURLConnection? = null
    try {
        val url = URL(address)
        if (url.protocol != "https") throw AppError("connection", "A secure connection is required.")
        val conn = url.openConnection() as HttpsURLConnection
        connection = conn
        conn.requestMethod = method
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15_000
        conn.readTimeout = 25_000
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Cache-Control", "no-store")
        token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
        apiKey?.let { conn.setRequestProperty("apikey", it) }
        if (body != null) {
            val bytes = body.toString().toByteArray(Charsets.UTF_8)
            if (bytes.size > 128 * 1024) throw AppError("validation", "The request is too large.")
            conn.doOutput = true
            if (photo == null) {
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            } else {
                // Fixed, locally generated headers; do not interpolate a provider's filename.
                val boundary = "Printly${UUID.randomUUID().toString().replace("-", "")}"
                val prefix = "--$boundary\r\nContent-Disposition: form-data; name=\"payload\"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n".toByteArray()
                val middle = "\r\n--$boundary\r\nContent-Disposition: form-data; name=\"proof\"; filename=\"shop-photo\"\r\nContent-Type: ${photo.mime}\r\n\r\n".toByteArray()
                val suffix = "\r\n--$boundary--\r\n".toByteArray()
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                conn.setFixedLengthStreamingMode(prefix.size + bytes.size + middle.size + photo.bytes.size + suffix.size)
                conn.outputStream.use { output -> output.write(prefix); output.write(bytes); output.write(middle); output.write(photo.bytes); output.write(suffix) }
            }
        }
        val status = conn.responseCode
        val stream = if (status >= 400) conn.errorStream else conn.inputStream
        val result = ByteArrayOutputStream()
        stream?.use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (result.size() + count > maxBytes) throw AppError("response_too_large", "The response was too large to open safely.")
                result.write(buffer, 0, count)
            }
        }
        HttpResult(status, result.toByteArray(), conn.getHeaderField("Location"))
    } catch (error: AppError) { throw error }
    catch (_: IOException) { throw AppError("network", "Connection interrupted. Refresh before retrying any change.") }
    catch (_: Exception) { throw AppError("network", "Could not reach Printly securely. Please try again.") }
    finally { connection?.disconnect() }
}
