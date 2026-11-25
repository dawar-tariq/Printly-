package io.github.dawartariq.printly.owner.nativeapp

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Local TLS-only server: these tests never use a real shop or external service. */
class HttpTransportTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient

    @Before fun startServer() {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").addSubjectAlternativeName("127.0.0.1").build()
        val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientCertificates = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        server = MockWebServer().apply { useHttps(serverCertificates.sslSocketFactory(), false); start() }
        client = secureHttpClient.newBuilder()
            .sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager)
            .build()
    }

    @After fun stopServer() { server.shutdown() }

    @Test fun patchAndDeleteSendJsonAndNeverRepeatServerRequestedRetry() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).addHeader("Retry-After", "0"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        val response = http(server.url("/inventory/id").toString(), "PATCH", JSONObject().put("set_qty", 3), token = "example-token", client = client)
        assertEquals(503, response.status)
        assertEquals(1, server.requestCount)
        val patch = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", patch.method)
        assertEquals("Bearer example-token", patch.getHeader("Authorization"))
        assertTrue(patch.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals(3, JSONObject(patch.body.readUtf8()).getInt("set_qty"))
        val deletion = http(server.url("/inventory/id").toString(), "DELETE", JSONObject().put("expected", 3), client = client)
        assertEquals(200, deletion.status)
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals(3, JSONObject(request.body.readUtf8()).getInt("expected"))
        assertEquals(2, server.requestCount)
    }

    @Test fun noAutomaticRetryAfterAnUncertainWrite() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        try {
            http(server.url("/payment").toString(), "POST", JSONObject().put("action", "confirm"), client = client)
            fail("A lost response must be reported as uncertain")
        } catch (error: AppError) { assertEquals("network", error.code) }
        assertEquals(1, server.requestCount)
    }

    @Test fun redirectsAreReturnedWithoutFollowingAndGetHasNoBody() = runBlocking {
        val location = "https://outside.example/private-file"
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", location))
        val response = http(server.url("/file").toString(), "GET", token = "example-token", client = client)
        assertEquals(302, response.status)
        assertEquals(location, response.location)
        assertEquals(1, server.requestCount)
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("GET", request.method)
        assertEquals(0L, request.bodySize)
        assertFalse(secureHttpClient.followRedirects)
        assertFalse(secureHttpClient.retryOnConnectionFailure)
    }

    @Test fun emptyPostAndMultipartProofHaveExpectedShapes() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        assertEquals(200, http(server.url("/gate").toString(), "POST", client = client).status)
        val gate = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", gate.method)
        assertEquals(0L, gate.bodySize)
        val image = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte())
        assertEquals(200, http(server.url("/proof").toString(), "PUT", JSONObject().put("name", "Example"),
            photo = ProofPhoto(image, "image/jpeg"), client = client).status)
        val proof = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertTrue(proof.getHeader("Content-Type")!!.startsWith("multipart/form-data; boundary="))
        val bytes = proof.body.readByteArray()
        val text = bytes.toString(Charsets.ISO_8859_1)
        assertTrue(text.contains("name=\"payload\""))
        assertTrue(text.contains("name=\"proof\"; filename=\"shop-photo\""))
        assertTrue(text.contains("Content-Type: image/jpeg"))
        assertTrue(text.contains("\"name\":\"Example\""))
    }

    @Test fun rejectsPlaintextAndBoundsResponses() = runBlocking {
        try { http("http://localhost/", "GET", client = client); fail("Plaintext must be rejected") }
        catch (error: AppError) { assertEquals("connection", error.code) }
        assertEquals(0, server.requestCount)
        server.enqueue(MockResponse().setResponseCode(200).setBody("x".repeat(2048)))
        try { http(server.url("/large").toString(), "GET", maxBytes = 1024, client = client); fail("Oversized response must be rejected") }
        catch (error: AppError) { assertEquals("response_too_large", error.code) }
    }
}
