package io.github.dawartariq.printly.owner.nativeapp

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/** TLS mock protocol: no production credentials, network, or customer data. */
class RealtimeSocketTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient

    @Before fun startServer() {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientCertificates = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        server = MockWebServer().apply { useHttps(serverCertificates.sslSocketFactory(), false); start() }
        client = secureHttpClient.newBuilder().sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager).build()
    }

    @After fun stopServer() { server.shutdown() }

    @Test fun authenticatedSubscriptionEmitsOnlyMatchingInvalidationsAndStops() = runBlocking {
        val receivedJoin = CompletableDeferred<String>()
        val serverSocket = CompletableDeferred<WebSocket>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { serverSocket.complete(webSocket) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!receivedJoin.isCompleted) { receivedJoin.complete(text); webSocket.send(joinAck()) }
            }
        }))
        val credentials = RealtimeCredentials("https://localhost", "synthetic-public-key", TEST_TOKEN)
        val request = Request.Builder().url(server.url("/realtime/v1/websocket?apikey=synthetic-public-key&vsn=2.0.0")).build()
        val events = Channel<Unit>(Channel.UNLIMITED)
        val job = launch { socketEvents(client, request, TEST_SHOP, credentials) { credentials }.collect { events.send(it) } }
        try {
            withTimeout(5_000) { events.receive() } // authenticated join catches up
            val join = JSONArray(withTimeout(5_000) { receivedJoin.await() })
            assertEquals(TEST_TOKEN, join.getJSONObject(4).getString("access_token"))
            val handshake = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertFalse(handshake.path!!.contains(TEST_TOKEN))
            assertNull(handshake.getHeader("Authorization"))
            val remote = withTimeout(5_000) { serverSocket.await() }
            remote.send(changeFrame(recordShop = OTHER_SHOP))
            assertNull(withTimeoutOrNull(300) { events.receive() })
            remote.send(changeFrame(event = "UPDATE", eventId = 11))
            withTimeout(5_000) { events.receive() }
        } finally { job.cancelAndJoin(); events.close() }
    }
}
