package io.github.dawartariq.printly.owner.nativeapp

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

internal data class RealtimeCredentials(val origin: String, val anonKey: String, val accessToken: String)

/** Only the pinned HTTPS Supabase project may receive the public key or token. */
internal fun realtimeRequest(credentials: RealtimeCredentials, expectedHost: String): Request? {
    if (!validAuthOrigin(credentials.origin, expectedHost) || credentials.anonKey.isBlank() || credentials.anonKey.length > 8192 ||
        credentials.accessToken.isBlank() || credentials.accessToken.length > 8192) return null
    val key = URLEncoder.encode(credentials.anonKey, "UTF-8")
    // The anon key is intentionally public. The user's access token is sent
    // only in the encrypted join frame, never in the URL or a log.
    return Request.Builder().url("wss://$expectedHost/realtime/v1/websocket?apikey=$key&vsn=2.0.0").build()
}

private val realtimeHttpClient = secureHttpClient.newBuilder().pingInterval(30, TimeUnit.SECONDS).build()

/**
 * Realtime is advisory. Every notification triggers an ordinary authenticated
 * board fetch; polling continues even if this connection or publication fails.
 */
internal fun observeOrderChanges(
    shopId: String,
    expectedHost: String,
    credentials: suspend () -> RealtimeCredentials,
    client: OkHttpClient = realtimeHttpClient,
): Flow<Unit> = flow {
    if (!isUuid(shopId)) return@flow
    var backoff = 1_000L
    while (currentCoroutineContext().isActive) {
        val started = System.currentTimeMillis()
        try {
            val initial = credentials()
            val request = realtimeRequest(initial, expectedHost) ?: return@flow
            socketEvents(client, request, shopId, initial, credentials).collect { emit(Unit) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* Polling remains available; never log credentials or rows. */ }
        if (System.currentTimeMillis() - started >= 60_000) backoff = 1_000L
        delay(backoff)
        backoff = (backoff * 2).coerceAtMost(30_000L)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
internal fun socketEvents(
    client: OkHttpClient,
    request: Request,
    shopId: String,
    initial: RealtimeCredentials,
    credentials: suspend () -> RealtimeCredentials,
): Flow<Unit> = callbackFlow {
    val ids = AtomicReference<Set<Long>>(emptySet())
    val joined = AtomicBoolean(false)
    val nextRef = AtomicLong(2)
    val socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!webSocket.send(RealtimeProtocol.join(shopId, initial.accessToken))) close()
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
            when (val event = RealtimeProtocol.parse(text, shopId, ids.get())) {
                is RealtimeProtocol.Event.Joined -> {
                    ids.set(event.ids)
                    if (joined.compareAndSet(false, true)) trySend(Unit) // catch up after reconnecting
                }
                RealtimeProtocol.Event.Changed -> trySend(Unit)
                RealtimeProtocol.Event.Closed -> close()
                RealtimeProtocol.Event.Ignore -> Unit
            }
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { close() }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { close() }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { close() }
    })
    val joinTimeout = launch { delay(10_000); if (!joined.get()) close() }
    val heartbeat = launch {
        while (isActive) {
            delay(25_000)
            if (!socket.send(RealtimeProtocol.heartbeat(nextRef.getAndIncrement().toString()))) { close(); break }
        }
    }
    val tokenWatch = launch {
        while (isActive) {
            delay(45_000)
            try {
                // A rotated token requires a fresh authenticated subscription.
                // If a refresh fails, close and let the outer loop retry.
                if (credentials() != initial) { close(); break }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { close(); break }
        }
    }
    awaitClose { joinTimeout.cancel(); heartbeat.cancel(); tokenWatch.cancel(); socket.cancel() }
}
