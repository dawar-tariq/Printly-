package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DomainTest {
    private fun quote() = JSONObject("""{"term":"monthly","base_paise":49900,"monthly_reference_paise":null,"discount_paise":0,"amount_paise":49900,"promo_code":null,"promo_id":null,"promo_version":null,"plan_version":1,"access_expires_at":null}""")

    @Test fun exactRupeesAndTransitions() {
        assertEquals(125L, rupeesToPaise("1.25"))
        assertEquals(100L, rupeesToPaise("1"))
        assertEquals(1_000_000L, rupeesToPaise("10000.00"))
        assertNull(rupeesToPaise("10000.01"))
        assertNull(rupeesToPaise("1.999"))
        assertNull(rupeesToPaise("-5"))
        assertNull(rupeesToPaise("NaN"))
        assertEquals("1.05", paiseInput(105))
        assertEquals(listOf("printing", "cancelled"), allowedTransitions("queued").map { it.first })
        assertEquals(listOf("collected"), allowedTransitions("ready").map { it.first })
        assertTrue(allowedTransitions("collected").isEmpty())
        assertTrue(allowedTransitions("draft").isEmpty())
    }

    @Test fun subscriptionFailsClosedWithoutValidExpiryOrPermanentGrant() {
        assertFalse(subscriptionActive(null))
        assertFalse(subscriptionActive(JSONObject("""{"expires_at":null}""")))
        assertFalse(subscriptionActive(JSONObject("""{"expires_at":"nonsense"}""")))
        assertFalse(subscriptionActive(JSONObject("""{"expires_at":"2000-01-01T00:00:00Z"}""")))
        assertTrue(subscriptionActive(JSONObject("""{"is_permanent":true,"expires_at":null}""")))
        assertTrue(subscriptionActive(JSONObject("""{"is_permanent":false,"expires_at":"2999-01-01T00:00:00Z"}""")))
    }

    @Test fun rejectsIncompleteOrInconsistentFinancialQuotes() {
        assertTrue(validQuote(quote(), "monthly", null))
        assertFalse(validQuote(quote().put("amount_paise", 49899), "monthly", null))
        assertFalse(validQuote(quote().put("base_paise", 49900.5), "monthly", null))
        assertFalse(validQuote(quote().removeAndReturn("plan_version"), "monthly", null))
        assertFalse(validQuote(quote().put("unexpected", 1), "monthly", null))
        assertFalse(validQuote(quote().put("promo_code", "SAVE"), "monthly", "SAVE"))
        val free = quote().put("promo_code", "FREE").put("promo_id", "12345678-1234-4234-8234-123456789abc")
            .put("promo_version", 3).put("discount_paise", 49900).put("amount_paise", 0)
        assertTrue(validQuote(free, "monthly", "FREE"))
        assertFalse(validQuote(free, "yearly", "FREE"))
    }

    @Test fun credentialDestinationsAndPrivateFilesAreConfined() {
        val host = "project.supabase.co"
        assertTrue(validAuthOrigin("https://project.supabase.co", host))
        assertFalse(validAuthOrigin("https://project.supabase.co.evil.test", host))
        assertFalse(validAuthOrigin("http://project.supabase.co", host))
        assertFalse(validAuthOrigin("https://user@project.supabase.co", host))
        assertFalse(validAuthOrigin("https://project.supabase.co:444", host))
        assertTrue(validSignedFileUrl("https://project.supabase.co/storage/v1/object/sign/order-files/a.pdf?token=abc", host))
        assertFalse(validSignedFileUrl("https://evil.test/storage/v1/object/sign/order-files/a.pdf", host))
        assertFalse(validSignedFileUrl("https://project.supabase.co/storage/v1/object/sign/other/a.pdf", host))
        assertFalse(validApiPath("../admin"))
        assertFalse(validApiPath("https://evil.test"))
        assertTrue(validApiPath("orders/123/files/456/download"))
    }

    @Test fun remotePresentationIsBoundedAndNeverChangesAccessRules() {
        val data = JSONObject("""{"schema":1,"notice":"Shop update","home_subtitle":"Hello again","board_refresh_seconds":20,"access_granted":true}""")
        assertEquals(OwnerExperience("Shop update", "Hello again", 20), parseOwnerExperience(data))
        assertNull(parseOwnerExperience(JSONObject("""{"schema":2}""")))
        assertNull(parseOwnerExperience(JSONObject("""{"schema":"1"}""")))
        val invalid = JSONObject().put("schema", 1).put("notice", "x".repeat(181))
            .put("home_subtitle", "A\nB").put("board_refresh_seconds", 1)
        assertEquals(OwnerExperience(), parseOwnerExperience(invalid))
        assertEquals(15, parseOwnerExperience(JSONObject().put("schema", 1).put("board_refresh_seconds", "10"))!!.boardRefreshSeconds)
    }

    @Test fun orderLookupUsesTheFullIdAndNeverNeedsToOpenThePastedUrl() {
        val id = "11111111-1111-4111-8111-111111111111"
        assertEquals(id, orderIdFromLookup(id.uppercase()))
        assertEquals(id, orderIdFromLookup("https://printly.example/track/$id/?ref=1"))
        assertEquals(id, orderIdFromLookup("$id#section"))
        assertNull(orderIdFromLookup("11111111"))
        assertNull(orderIdFromLookup("not an order"))
        assertEquals("Payment to review", orderStatusLabel(JSONObject("""{"status":"draft","payment_method":"upi","payment_status":"submitted"}""")))
        assertEquals("Awaiting payment", orderStatusLabel(JSONObject("""{"status":"draft","payment_method":"upi","payment_status":"pending"}""")))
        assertEquals("New", orderStatusLabel(JSONObject("""{"status":"queued"}""")))
    }

    @Test fun imageDetectionUsesSignatures() {
        assertEquals("image/jpeg", detectImageMime(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte())))
        assertEquals("image/png", detectImageMime(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
        assertNull(detectImageMime("not an image".toByteArray()))
    }
}
private fun JSONObject.removeAndReturn(key: String): JSONObject = apply { remove(key) }
