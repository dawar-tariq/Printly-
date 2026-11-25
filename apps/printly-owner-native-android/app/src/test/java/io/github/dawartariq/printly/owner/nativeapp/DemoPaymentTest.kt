package io.github.dawartariq.printly.owner.nativeapp

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class DemoPaymentTest {
    @Test fun reportIsSeparateFromVerifyingAndConfirming() = runBlocking {
        val api = DemoOwnerApi()
        api.signIn("", "")
        val orderPath = "orders/55555555-5555-4555-8555-555555555555"
        val paymentPath = "$orderPath/confirm-payment"
        suspend fun order() = api.request("GET", orderPath).getJSONObject("order")
        suspend fun attempt(payload: JSONObject, expectedCode: String) {
            try { api.request("POST", paymentPath, payload); fail("Expected $expectedCode") }
            catch (error: AppError) { assertEquals(expectedCode, error.code) }
        }
        api.request("POST", paymentPath, JSONObject().put("action", "reject"))
        assertEquals("rejected", order().getString("payment_status"))
        attempt(JSONObject().put("action", "confirm").put("verification_confirmed", true), "bad_state")
        api.request("POST", paymentPath, JSONObject().put("action", "report").put("utr", "DEMO123"))
        assertEquals("draft", order().getString("status"))
        assertEquals("submitted", order().getString("payment_status"))
        assertEquals("DEMO123", order().getString("utr"))
        attempt(JSONObject().put("action", "confirm"), "verification_required")
        api.request("POST", paymentPath, JSONObject().put("action", "confirm").put("verification_confirmed", true))
        assertEquals("queued", order().getString("status"))
        assertEquals("confirmed", order().getString("payment_status"))
        attempt(JSONObject().put("action", "report"), "bad_state")
    }
}
