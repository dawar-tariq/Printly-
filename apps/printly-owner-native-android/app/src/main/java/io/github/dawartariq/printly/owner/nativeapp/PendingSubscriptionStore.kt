package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal data class PendingSubscription(val key: String, val resolvedPurchaseId: String?)

/** Persist before sending; a lost reply must never silently get a fresh key. */
internal class PendingSubscriptionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("pending_subscription", Context.MODE_PRIVATE)
    private fun name(shopId: String): String {
        if (!isUuid(shopId)) throw AppError("subscription", "Could not verify the shop. Refresh subscription details.")
        return "shop_$shopId"
    }
    @Synchronized fun read(shopId: String): PendingSubscription? {
        val raw = prefs.getString(name(shopId), null) ?: return null
        try {
            val json = JSONObject(raw)
            val key = json.getString("request_key")
            val resolved = json.optString("resolved_purchase_id", "").ifBlank { null }
            if (!isUuid(key) || (resolved != null && !isUuid(resolved))) throw IllegalArgumentException()
            return PendingSubscription(key, resolved)
        } catch (_: Exception) {
            // Never discard a potentially used key just because local data is malformed.
            throw AppError("pending_request", "An earlier subscription request cannot be read safely. Check your history and contact Printly before starting another.")
        }
    }
    @Synchronized fun ensure(shopId: String): PendingSubscription {
        read(shopId)?.let { return it }
        val next = PendingSubscription(UUID.randomUUID().toString(), null)
        val encoded = JSONObject().put("request_key", next.key).toString()
        if (!prefs.edit().putString(name(shopId), encoded).commit()) throw AppError("storage", "Could not save a safe request key. No request was sent.")
        return next
    }
    @Synchronized fun recordResolved(shopId: String, key: String, purchaseId: String): PendingSubscription {
        val previous = read(shopId) ?: throw AppError("pending_request", "Refresh the subscription history before continuing.")
        if (previous.key != key || !isUuid(purchaseId)) throw AppError("pending_request", "Refresh the subscription history before continuing.")
        val next = PendingSubscription(key, purchaseId)
        val encoded = JSONObject().put("request_key", key).put("resolved_purchase_id", purchaseId).toString()
        if (!prefs.edit().putString(name(shopId), encoded).commit()) throw AppError("storage", "Request returned, but its status could not be saved. Refresh history before continuing.")
        return next
    }
    @Synchronized fun clearResolved(shopId: String, key: String) {
        if (read(shopId)?.key != key) throw AppError("pending_request", "Refresh subscription history before continuing.")
        if (!prefs.edit().remove(name(shopId)).commit()) throw AppError("storage", "Could not finish saving the request status. Refresh before continuing.")
    }
}
