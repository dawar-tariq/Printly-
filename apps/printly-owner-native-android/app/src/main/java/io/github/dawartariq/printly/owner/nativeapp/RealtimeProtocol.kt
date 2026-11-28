package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONArray
import org.json.JSONObject

/** Minimal Supabase Realtime/Phoenix v2 messages; never render event payloads. */
internal object RealtimeProtocol {
    private const val JOIN_REF = "1"
    fun topic(shopId: String) = "realtime:printly-orders:${shopId.lowercase()}"

    fun join(shopId: String, accessToken: String): String {
        require(isUuid(shopId) && accessToken.isNotBlank() && accessToken.length <= 8192)
        val filter = "shop_id=eq.${shopId.lowercase()}"
        val changes = JSONArray()
        // DELETE cannot be reliably filtered/authorised by Realtime. The normal
        // authenticated polling fallback catches removals and missed events.
        for (event in listOf("INSERT", "UPDATE")) changes.put(JSONObject()
            .put("event", event).put("schema", "public").put("table", "orders").put("filter", filter))
        val config = JSONObject()
            .put("broadcast", JSONObject().put("ack", false).put("self", false))
            .put("presence", JSONObject().put("key", "").put("enabled", false))
            .put("postgres_changes", changes).put("private", false)
        return JSONArray().put(JOIN_REF).put(JOIN_REF).put(topic(shopId)).put("phx_join")
            .put(JSONObject().put("config", config).put("access_token", accessToken)).toString()
    }

    fun heartbeat(ref: String): String = JSONArray().put(JSONObject.NULL).put(ref).put("phoenix").put("heartbeat").put(JSONObject()).toString()

    sealed interface Event {
        data class Joined(val ids: Set<Long>) : Event
        data object Changed : Event
        data object Closed : Event
        data object Ignore : Event
    }

    /** Validates channel and server-confirmed filters; only emits an invalidation. */
    fun parse(text: String, shopId: String, ids: Set<Long>): Event {
        if (!isUuid(shopId) || text.length > 256 * 1024) return Event.Ignore
        return try {
            val frame = JSONArray(text)
            if (frame.length() != 5 || frame.optString(2) != topic(shopId)) return Event.Ignore
            val kind = frame.optString(3)
            val payload = frame.optJSONObject(4) ?: return Event.Ignore
            when (kind) {
                "phx_error", "phx_close" -> Event.Closed
                "system" -> if (payload.optString("status") == "error") Event.Closed else Event.Ignore
                "phx_reply" -> {
                    if (frame.optString(1) != JOIN_REF) return Event.Ignore
                    if (payload.optString("status") != "ok") return Event.Closed
                    val changes = payload.optJSONObject("response")?.optJSONArray("postgres_changes") ?: return Event.Closed
                    if (changes.length() != 2) return Event.Closed
                    val found = mutableSetOf<Long>()
                    val events = mutableSetOf<String>()
                    for (index in 0 until changes.length()) {
                        val binding = changes.optJSONObject(index) ?: return Event.Closed
                        val event = binding.optString("event")
                        val id = binding.opt("id") as? Number ?: return Event.Closed
                        if (event !in listOf("INSERT", "UPDATE") || binding.optString("schema") != "public" ||
                            binding.optString("table") != "orders" || binding.optString("filter") != "shop_id=eq.${shopId.lowercase()}") return Event.Closed
                        events.add(event); found.add(id.toLong())
                    }
                    if (found.size == 2 && events == setOf("INSERT", "UPDATE")) Event.Joined(found) else Event.Closed
                }
                "postgres_changes" -> {
                    if (ids.isEmpty()) return Event.Ignore
                    val eventIds = payload.optJSONArray("ids") ?: return Event.Ignore
                    if ((0 until eventIds.length()).none { index -> (eventIds.opt(index) as? Number)?.toLong() in ids }) return Event.Ignore
                    val data = payload.optJSONObject("data") ?: return Event.Ignore
                    val record = data.optJSONObject("record") ?: return Event.Ignore
                    if (data.optString("schema") == "public" && data.optString("table") == "orders" &&
                        data.optString("type") in listOf("INSERT", "UPDATE") && record.optString("shop_id").equals(shopId, ignoreCase = true)) Event.Changed
                    else Event.Ignore
                }
                else -> Event.Ignore
            }
        } catch (_: Exception) { Event.Ignore }
    }
}
