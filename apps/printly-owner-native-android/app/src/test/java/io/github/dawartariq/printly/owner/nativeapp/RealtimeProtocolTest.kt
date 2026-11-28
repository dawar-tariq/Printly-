package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal const val TEST_SHOP = "a1111111-1111-4111-8111-111111111111"
internal const val OTHER_SHOP = "b2222222-2222-4222-8222-222222222222"
internal const val TEST_TOKEN = "synthetic-access-token"

internal fun joinAck(shop: String = TEST_SHOP, filterShop: String = shop): String {
    val bindings = JSONArray()
    for ((index, event) in listOf("INSERT", "UPDATE").withIndex()) bindings.put(JSONObject()
        .put("event", event).put("schema", "public").put("table", "orders")
        .put("filter", "shop_id=eq.$filterShop").put("id", 10 + index))
    return JSONArray().put("1").put("1").put(RealtimeProtocol.topic(shop)).put("phx_reply")
        .put(JSONObject().put("status", "ok").put("response", JSONObject().put("postgres_changes", bindings))).toString()
}

internal fun changeFrame(shop: String = TEST_SHOP, recordShop: String = shop, eventId: Int = 10, event: String = "INSERT"): String =
    JSONArray().put("1").put(JSONObject.NULL).put(RealtimeProtocol.topic(shop)).put("postgres_changes")
        .put(JSONObject().put("ids", JSONArray().put(eventId)).put("data", JSONObject().put("schema", "public")
            .put("table", "orders").put("type", event).put("record", JSONObject().put("shop_id", recordShop).put("customer_name", "Never rendered"))))
        .toString()

class RealtimeProtocolTest {
    @Test fun sendsOnlyFilteredInsertAndUpdateSubscriptions() {
        val join = JSONArray(RealtimeProtocol.join(TEST_SHOP, TEST_TOKEN))
        assertEquals("phx_join", join.getString(3))
        assertEquals(TEST_TOKEN, join.getJSONObject(4).getString("access_token"))
        val changes = join.getJSONObject(4).getJSONObject("config").getJSONArray("postgres_changes")
        assertEquals(2, changes.length())
        assertEquals(listOf("INSERT", "UPDATE"), (0 until changes.length()).map { changes.getJSONObject(it).getString("event") })
        assertTrue((0 until changes.length()).all { changes.getJSONObject(it).getString("filter") == "shop_id=eq.$TEST_SHOP" })
        assertEquals("heartbeat", JSONArray(RealtimeProtocol.heartbeat("2")).getString(3))
    }

    @Test fun checksAcknowledgementAndUsesOnlyMatchingEventsAsInvalidations() {
        val joined = RealtimeProtocol.parse(joinAck(), TEST_SHOP, emptySet())
        assertEquals(RealtimeProtocol.Event.Joined(setOf(10L, 11L)), joined)
        assertEquals(RealtimeProtocol.Event.Closed, RealtimeProtocol.parse(joinAck(filterShop = OTHER_SHOP), TEST_SHOP, emptySet()))
        val ids = (joined as RealtimeProtocol.Event.Joined).ids
        assertEquals(RealtimeProtocol.Event.Changed, RealtimeProtocol.parse(changeFrame(), TEST_SHOP, ids))
        assertEquals(RealtimeProtocol.Event.Ignore, RealtimeProtocol.parse(changeFrame(recordShop = OTHER_SHOP), TEST_SHOP, ids))
        assertEquals(RealtimeProtocol.Event.Ignore, RealtimeProtocol.parse(changeFrame(eventId = 999), TEST_SHOP, ids))
        assertEquals(RealtimeProtocol.Event.Ignore, RealtimeProtocol.parse(changeFrame(event = "DELETE"), TEST_SHOP, ids))
        assertEquals(RealtimeProtocol.Event.Ignore, RealtimeProtocol.parse(changeFrame(shop = OTHER_SHOP), TEST_SHOP, ids))
        assertEquals(RealtimeProtocol.Event.Ignore, RealtimeProtocol.parse(changeFrame(), TEST_SHOP, emptySet()))
        assertEquals(RealtimeProtocol.Event.Ignore, RealtimeProtocol.parse("not json", TEST_SHOP, ids))
    }

    @Test fun realtimeCredentialsCannotBeSentToAnUntrustedOrigin() {
        val valid = RealtimeCredentials("https://project.supabase.co", "public-anon-key", TEST_TOKEN)
        val request = realtimeRequest(valid, "project.supabase.co")!!
        assertEquals("project.supabase.co", request.url.host)
        assertTrue(request.url.toString().contains("apikey=public-anon-key"))
        assertFalse(request.url.toString().contains(TEST_TOKEN))
        assertNull(request.header("Authorization"))
        assertNull(realtimeRequest(valid.copy(origin = "https://project.supabase.co.evil.test"), "project.supabase.co"))
        assertNull(realtimeRequest(valid.copy(origin = "http://project.supabase.co"), "project.supabase.co"))
        assertNull(realtimeRequest(valid.copy(origin = "https://project.supabase.co:444"), "project.supabase.co"))
    }
}
