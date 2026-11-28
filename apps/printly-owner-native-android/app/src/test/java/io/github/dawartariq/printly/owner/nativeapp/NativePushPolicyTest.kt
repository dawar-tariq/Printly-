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

    @Test fun tokenNoticeContainsNoCustomerNameAndRequiresValidBindingAndToken() {
        val tokenNotice = payload + mapOf("version" to "3", "token" to "A-012")
        val notice = nativePushNotice(tokenNotice, true, binding, true)!!
        assertEquals("New Printly order", notice.title)
        assertEquals("Token A-012. Open Printly for Shops to view the order.", notice.body)
        assertNull(nativePushNotice(tokenNotice + ("customer" to "Private Name"), true, binding, true))
        assertNull(nativePushNotice(tokenNotice + ("token" to "A-1\nPrivate Name"), true, binding, true))
        assertNull(nativePushNotice(tokenNotice + ("kind" to "payment"), true, binding, true))
        assertNull(nativePushNotice(tokenNotice, false, binding, true))
        assertNull(nativePushNotice(tokenNotice, true, "33333333-3333-4333-8333-333333333333", true))
    }

    @Test fun signedOutOrReboundDevicesIgnoreLateMessages() {
        assertNull(nativePushNotice(payload, false, binding, true))
        assertNull(nativePushNotice(payload, true, binding, false))
        assertNull(nativePushNotice(payload, true, "33333333-3333-4333-8333-333333333333", true))
        assertNull(nativePushNotice(payload, true, null, true))
    }

    @Test fun enrolledSessionMustStillBeTheCurrentSession() {
        val first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        val second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        assertTrue(pushSessionMatches(true, first, first))
        assertFalse(pushSessionMatches(false, first, first))
        assertFalse(pushSessionMatches(true, first, second))
        assertFalse(pushSessionMatches(true, first, null))
        assertFalse(pushSessionMatches(true, "broken", "broken"))
        // Even an otherwise valid old message cannot display after another
        // account signs in on the same phone or in the same shop.
        assertNull(nativePushNotice(payload, pushSessionMatches(true, first, second), binding, true))
    }

    @Test fun pendingTapCannotCrossSessionOrBindingChanges() {
        val first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        val second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        val replacementBinding = "33333333-3333-4333-8333-333333333333"
        val tap = PushTap(event, "Notice", "Private to the original session", "announcement", binding, first)
        assertTrue(pushTapMatchesSession(tap, true, binding, first, first))
        assertFalse(pushTapMatchesSession(tap, false, binding, first, first))
        assertFalse(pushTapMatchesSession(tap, true, binding, first, second))
        assertFalse(pushTapMatchesSession(tap, true, binding, second, second))
        assertFalse(pushTapMatchesSession(tap, true, replacementBinding, first, first))
        assertFalse(pushTapMatchesSession(tap.copy(event = "bad"), true, binding, first, first))
    }

    @Test fun lateFirebaseCallbacksReconcileWithCurrentConsent() {
        val first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        val second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        assertEquals(PushCallbackAction.UNREGISTER, pushCallbackAction(true, false, first, first, true))
        assertEquals(PushCallbackAction.IGNORE, pushCallbackAction(false, false, first, first, true))
        assertEquals(PushCallbackAction.ACCEPT, pushCallbackAction(true, true, first, first, true))
        assertEquals(PushCallbackAction.REREGISTER, pushCallbackAction(false, true, first, first, true))
        assertEquals(PushCallbackAction.STOP, pushCallbackAction(true, true, first, second, true))
        assertEquals(PushCallbackAction.STOP, pushCallbackAction(false, true, first, first, false))
    }

    @Test fun managedNoticesRequireTheCurrentBindingAndOnlyAllowFixedActionsAndImages() {
        val managed = mapOf("version" to "2", "kind" to "maintenance", "event" to event, "binding" to binding,
            "title" to "Maintenance", "body" to "Back shortly", "action" to "maintenance", "image" to "")
        val notice = nativePushNotice(managed, true, binding, true)!!
        assertEquals("Maintenance", notice.title)
        assertEquals("maintenance", notice.action)
        assertNull(nativePushNotice(managed, false, binding, true))
        assertNull(nativePushNotice(managed + ("action" to "https://evil.test"), true, binding, true))
        assertNull(nativePushNotice(managed + ("title" to "Bad\nheadline"), true, binding, true))
        assertNull(nativePushNotice(managed + ("image" to "https://127.0.0.1/a.png"), true, binding, true))
        val goodImage = "https://raw.githubusercontent.com/dawar-tariq/Printly-/main/public/notice.png"
        assertEquals(goodImage, nativePushNotice(managed + ("image" to goodImage), true, binding, true)!!.image)
        assertFalse(validNoticeImage("$goodImage?private=1"))
        assertFalse(validNoticeImage("https://raw.githubusercontent.com/other/repo/main/image.png"))
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
