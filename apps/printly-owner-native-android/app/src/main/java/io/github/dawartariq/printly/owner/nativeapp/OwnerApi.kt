package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.util.Collections
import java.util.UUID
import java.util.concurrent.TimeUnit

/** No business mutation is retried automatically: a lost response can hide a successful write. */
class AppError(val code: String, override val message: String, val httpStatus: Int = 0) : Exception(message)

data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long, val localId: String = UUID.randomUUID().toString())
data class ProofPhoto(val bytes: ByteArray, val mime: String)

interface OwnerApi {
    val isDemo: Boolean
    suspend fun restore(): Boolean
    suspend fun signIn(email: String, password: String)
    /** True means remote session and notification revocation were confirmed. Local access is removed either way. */
    suspend fun signOut(): Boolean
    suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject
    /** Best-effort deletion using only the session that originally opted in. */
    suspend fun unregisterPush(expectedSessionId: String, binding: String): Boolean = false
    suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject
    suspend fun file(path: String): ByteArray
    /** Safe presentation settings; null means retain the current defaults. */
    suspend fun experience(): OwnerExperience? = null
    /** Advisory invalidations only; the board API remains authoritative. */
    fun orderUpdates(shopId: String): Flow<Unit> = emptyFlow()
}

private data class PublicConfig(val authOrigin: String, val anonKey: String)
internal data class HttpResult(val status: Int, val bytes: ByteArray, val location: String?) {
    fun json(): JSONObject = try { JSONObject(bytes.toString(Charsets.UTF_8)) }
        catch (_: Exception) { throw AppError("invalid_response", "Could not read the server response. Please try again.") }
}

/** Native HTTPS client. The service-role key is never present in this app. */
class LiveOwnerApi(context: Context) : OwnerApi {
    override val isDemo = false
    private val appContext = context.applicationContext
    private val store = SessionStore(appContext)
    private val lock = Mutex()
    @Volatile private var session: Session? = null
    // The local identity stays stable through refresh. Mark sign-out before
    // waiting for the API lock so a recreated activity cannot restore it.
    private val endingSessions = Collections.synchronizedSet(mutableSetOf<String>())
    private var config: PublicConfig? = null

    override suspend fun restore(): Boolean = lock.withLock {
        val restored = try { store.load() } catch (_: Exception) { null }
        if (restored != null && endingSessions.contains(restored.localId)) return@withLock false
        if (restored == null) {
            NativePush.sessionChange(appContext) { store.clear(); session = null }
        } else if (session != null && session?.localId != restored.localId) {
            NativePush.sessionChange(appContext) { session = restored }
        } else session = restored
        restored != null
    }

    override suspend fun experience(): OwnerExperience? {
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/experience", "GET", maxBytes = 8_192)
        return if (response.status == 200) parseOwnerExperience(response.json()) else null
    }

    override fun orderUpdates(shopId: String): Flow<Unit> = observeOrderChanges(shopId, BuildConfig.SUPABASE_HOST, {
        val cfg = publicConfig()
        RealtimeCredentials(cfg.authOrigin, cfg.anonKey, usableSession().accessToken)
    })

    private suspend fun publicConfig(client: OkHttpClient = sessionHttpClient): PublicConfig {
        config?.let { return it }
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/config", "GET", maxBytes = 32_768, client = client)
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
        if (session != null) throw AppError("session_busy", "Please finish signing out before signing in again.")
        val gate = http("${BuildConfig.SITE_ORIGIN}/api/auth/login-attempt", "POST", maxBytes = 32_768, client = sessionHttpClient)
        if (gate.status == 429) throw AppError("rate_limit", "Too many sign-in attempts. Please wait before trying again.", 429)
        if (gate.status !in 200..299) throw AppError("gate", "Sign-in protection is temporarily unavailable.", gate.status)
        val cfg = publicConfig()
        val payload = JSONObject().put("email", email.trim()).put("password", password)
        val response = http("${cfg.authOrigin}/auth/v1/token?grant_type=password", "POST", payload, apiKey = cfg.anonKey, client = sessionHttpClient)
        if (response.status !in 200..299) {
            val message = when (response.status) {
                400, 401 -> "Incorrect email or password."
                429 -> "Too many sign-in attempts. Please wait before trying again."
                else -> "Could not sign in. Please try again."
            }
            throw AppError("sign_in", message, response.status)
        }
        val next = parseSession(response.json())
        try {
            NativePush.sessionChange(appContext) { store.save(next); session = next }
        } catch (_: Exception) { throw AppError("secure_storage", "Could not store your session securely on this device.") }
        Unit
    }

    private suspend fun usableSession(expectedLocalId: String? = null): Session = lock.withLock {
        val current = session ?: throw AppError("session_expired", "Please sign in again.", 401)
        if (expectedLocalId != null && current.localId != expectedLocalId) throw AppError("session_changed", "This request belongs to an earlier session.")
        if (endingSessions.contains(current.localId)) throw AppError("session_expired", "Please sign in again.", 401)
        if (current.expiresAt > System.currentTimeMillis() / 1000 + 120) return@withLock current
        val cfg = publicConfig()
        val response = http("${cfg.authOrigin}/auth/v1/token?grant_type=refresh_token", "POST",
            JSONObject().put("refresh_token", current.refreshToken), apiKey = cfg.anonKey, client = sessionHttpClient)
        if (response.status == 400 || response.status == 401) {
            NativePush.sessionChange(appContext) { store.clear(); session = null }
            throw AppError("session_expired", "Your session expired. Please sign in again.", 401)
        }
        if (response.status !in 200..299) throw AppError("refresh", "Could not refresh your session. Check your connection.", response.status)
        val next = parseSession(response.json()).copy(localId = current.localId)
        try { store.save(next) } catch (_: Exception) {
            // A rotated refresh token that could not be persisted must not be
            // silently replaced with an older token on the next app launch.
            NativePush.sessionChange(appContext) { store.clear(); session = null }
            throw AppError("secure_storage", "Could not save your refreshed session securely. Please sign in again.")
        }
        session = next
        if (endingSessions.contains(next.localId)) throw AppError("session_expired", "Please sign in again.", 401)
        next
    }

    override suspend fun signOut(): Boolean = withContext(NonCancellable) {
        // Stop display immediately and invalidate local access before waiting
        // for network cleanup. A recreated activity cannot restore this session.
        val target = session
        target?.let { endingSessions.add(it.localId) }
        var localCleared = true
        try {
            val first = try { target?.let { NativePush.beginSignOut(appContext, it.localId) } ?: LocalPushStop() }
                catch (_: Exception) { LocalPushStop(localConfirmed = false) }
            val (captured, second) = lock.withLock {
                val current = session
                if (target != null && current?.localId == target.localId) {
                    val stopped = NativePush.sessionChange(appContext, target.localId) {
                        localCleared = try { store.clear() } catch (_: Exception) { false }
                        session = null
                    }
                    current to stopped
                } else target to LocalPushStop()
            }
            // POST and DELETE are serialized and tombstoned by the server, so
            // cleanup need not wait indefinitely for an in-flight sync. Never
            // use a newer account's bearer for this old binding.
            val pushConfirmed = NativePush.finishSignOut(target?.localId, listOf(first, second)) { binding ->
                if (captured == null) false else try {
                    val result = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/push-device", "DELETE",
                        JSONObject().put("binding_id", binding), token = captured.accessToken, client = cleanupHttpClient)
                    result.status in 200..299
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { false }
            }
            val authConfirmed = if (captured == null) true else try {
                val cfg = publicConfig(cleanupHttpClient)
                val result = http("${cfg.authOrigin}/auth/v1/logout?scope=local", "POST", token = captured.accessToken,
                    apiKey = cfg.anonKey, client = cleanupHttpClient)
                result.status in 200..299
            } catch (_: Exception) { false }
            localCleared && pushConfirmed && authConfirmed
        } finally {
            // If persistent local cleanup failed, do not restore that old
            // session again in this process; the user is warned to clear data.
            if (localCleared) target?.let { endingSessions.remove(it.localId) }
        }
    }

    private suspend fun rejectIfUnauthorized(response: HttpResult, requestedSession: Session) {
        if (response.status != 401) return
        val current = lock.withLock {
            // Compare both identity and token: even if a token string were
            // reused, a later sign-in must not be erased by an old response.
            if (session?.localId == requestedSession.localId && session?.accessToken == requestedSession.accessToken) {
                NativePush.sessionChange(appContext) { store.clear(); session = null }
                true
            } else false
        }
        if (!current) throw AppError("stale_request", "An earlier request was superseded. Please refresh.")
    }

    private suspend fun requestForSession(method: String, path: String, body: JSONObject?, expectedLocalId: String? = null): JSONObject {
        if (!validApiPath(path)) throw AppError("path", "Invalid app request.")
        val requestedSession = usableSession(expectedLocalId)
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/$path", method, body, token = requestedSession.accessToken)
        rejectIfUnauthorized(response, requestedSession)
        if (response.status !in 200..299) throw serverError(response)
        return response.json()
    }

    override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject = requestForSession(method, path, body)

    override suspend fun unregisterPush(expectedSessionId: String, binding: String): Boolean {
        if (!validPushUuid(expectedSessionId) || !validPushUuid(binding)) return false
        // Snapshot this session, without waiting for an unrelated token refresh
        // or ever substituting a newer account's bearer. An expired bearer is
        // reported as an unconfirmed cleanup rather than silently refreshed.
        val captured = session?.takeIf { it.localId == expectedSessionId } ?: return false
        return try {
            val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/push-device", "DELETE",
                JSONObject().put("binding_id", binding), token = captured.accessToken, client = cleanupHttpClient)
            response.status in 200..299
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { false }
    }

    /** Bind background registration to the session that opted in, never a
     * newer account that happened to sign in while work was queued. */
    internal suspend fun registerPush(expectedLocalId: String, body: JSONObject): JSONObject =
        requestForSession("POST", "push-device", body, expectedLocalId)

    override suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject {
        if (!((method == "PUT" && path == "settings") || (method == "POST" && path == "name-proof"))) {
            throw AppError("path", "Invalid proof request.")
        }
        if (photo == null) return request(method, path, body)
        if (photo.bytes.size !in 1..3 * 1024 * 1024 || detectImageMime(photo.bytes) != photo.mime) {
            throw AppError("photo", "Choose a valid JPEG, PNG or WebP shop photo up to 3 MB.")
        }
        val requestedSession = usableSession()
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/$path", method, body, token = requestedSession.accessToken, photo = photo)
        rejectIfUnauthorized(response, requestedSession)
        if (response.status !in 200..299) throw serverError(response)
        return response.json()
    }

    override suspend fun file(path: String): ByteArray {
        if (!validApiPath(path)) throw AppError("path", "Invalid file request.")
        val requestedSession = usableSession()
        val response = http("${BuildConfig.SITE_ORIGIN}/api/native/v1/shop/$path", "GET", token = requestedSession.accessToken, maxBytes = 26 * 1024 * 1024)
        rejectIfUnauthorized(response, requestedSession)
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

// Android's HttpURLConnection does not reliably support PATCH. OkHttp supports
// it directly; redirect following and connection retries stay explicitly off.
internal val secureHttpClient: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(25, TimeUnit.SECONDS)
    .writeTimeout(25, TimeUnit.SECONDS)
    .build()

// Session operations hold the API mutex during sign-in/refresh; bound those
// calls so a trickle response cannot hold up sign-out indefinitely. Cleanup
// has a shorter deadline; neither client automatically retries a write.
internal val sessionHttpClient = secureHttpClient.newBuilder().callTimeout(30, TimeUnit.SECONDS).build()
internal val cleanupHttpClient = secureHttpClient.newBuilder().callTimeout(15, TimeUnit.SECONDS).build()

/** Also prevents OkHttp's HTTP 503 Retry-After: 0 / 421 follow-up for writes. */
private class OneShotBody(private val body: RequestBody) : RequestBody() {
    override fun contentType() = body.contentType()
    override fun contentLength() = body.contentLength()
    override fun writeTo(sink: BufferedSink) = body.writeTo(sink)
    override fun isOneShot() = true
}

internal suspend fun http(
    address: String, method: String, body: JSONObject? = null, token: String? = null,
    apiKey: String? = null, maxBytes: Int = 2 * 1024 * 1024, photo: ProofPhoto? = null,
    client: OkHttpClient = secureHttpClient,
): HttpResult = withContext(Dispatchers.IO) {
    try {
        val uri = URI(address)
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null) {
            throw AppError("connection", "A secure connection is required.")
        }
        if (method !in listOf("GET", "POST", "PUT", "PATCH", "DELETE") || (method == "GET" && body != null) || (photo != null && body == null)) {
            throw AppError("validation", "Invalid app request.")
        }
        val payload = body?.toString()?.toByteArray(Charsets.UTF_8)
        if (payload != null && payload.size > 128 * 1024) throw AppError("validation", "The request is too large.")
        val requestBody = if (method == "GET") null else {
            val content = if (photo == null) {
                (payload ?: ByteArray(0)).toRequestBody(if (payload == null) null else "application/json; charset=utf-8".toMediaType())
            } else {
                // Filename and media type are constrained locally, never supplied as headers by a file provider.
                MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("payload", null, requireNotNull(payload).toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .addFormDataPart("proof", "shop-photo", photo.bytes.toRequestBody(photo.mime.toMediaType()))
                    .build()
            }
            OneShotBody(content)
        }
        val request = Request.Builder().url(address).method(method, requestBody)
            .header("Accept", "application/json").header("Cache-Control", "no-store")
            .apply { token?.let { header("Authorization", "Bearer $it") }; apiKey?.let { header("apikey", it) } }
            .build()
        client.newCall(request).execute().use { response ->
            val result = ByteArrayOutputStream()
            response.body?.byteStream()?.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (result.size() + count > maxBytes) throw AppError("response_too_large", "The response was too large to open safely.")
                    result.write(buffer, 0, count)
                }
            }
            HttpResult(response.code, result.toByteArray(), response.header("Location"))
        }
    } catch (error: AppError) { throw error }
    catch (error: CancellationException) { throw error }
    catch (_: IOException) { throw AppError("network", "Connection interrupted. Refresh before retrying any change.") }
    catch (_: Exception) { throw AppError("network", "Could not reach Printly securely. Please try again.") }
}
