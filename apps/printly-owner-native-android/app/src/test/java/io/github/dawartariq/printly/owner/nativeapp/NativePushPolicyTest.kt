package io.github.dawartariq.printly.owner.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NativePushPolicyTest {
    private val binding = "11111111-1111-4111-8111-111111111111"
    private val event = "22222222-2222-4222-8222-222222222222"
    private val payload = mapOf("version" to "1", "kind" to "order", "event" to event, "binding" to binding)

    @Test fun alertsAreGenericAndDuplicateEventsUseTheSameTag() {
        val first = nativePushNotice(payload, true, binding, true)!!
        assertEquals("New Printly order", first.title)
        assertEquals("Open Printly for Shops to view your orders.", first.body)
        assertEquals(event, first.tag)
        assertEquals(first, nativePushNotice(payload, true, binding, true))
        assertEquals("Printly order needs attention", nativePushNotice(payload + ("kind" to "payment"), true, binding, true)!!.title)
    }

    @Test fun signedOutOrReboundDevicesIgnoreLateMessages() {
        assertNull(nativePushNotice(payload, false, binding, true))
        assertNull(nativePushNotice(payload, true, binding, false))
        assertNull(nativePushNotice(payload, true, "33333333-3333-4333-8333-333333333333", true))
        assertNull(nativePushNotice(payload, true, null, true))
    }

    @Test fun unexpectedOrMalformedDataIsRejected() {
        assertNull(nativePushNotice(payload + ("customer" to "private"), true, binding, true))
        assertNull(nativePushNotice(payload + ("kind" to "unknown"), true, binding, true))
        assertNull(nativePushNotice(payload + ("event" to "bad"), true, binding, true))
        assertNull(nativePushNotice(payload + ("version" to "2"), true, binding, true))
        assertTrue(validPushFid("A".repeat(22)))
        assertFalse(validPushFid("A".repeat(21)))
    }
}
