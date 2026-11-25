package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale
import java.util.UUID

val lanes = listOf("confirm", "queued", "printing", "ready")
fun laneTitle(value: String) = when (value) {
    "confirm" -> "Payment review"
    "queued" -> "New"
    "printing" -> "Printing"
    "ready" -> "Ready"
    "collected" -> "Collected"
    "draft" -> "Payment review"
    "cancelled" -> "Cancelled"
    else -> value.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

fun allowedTransitions(status: String): List<Pair<String, String>> = when (status) {
    "queued" -> listOf("printing" to "Start printing", "cancelled" to "Cancel order")
    "printing" -> listOf("ready" to "Mark ready", "queued" to "Move back to new")
    "ready" -> listOf("collected" to "Mark collected")
    else -> emptyList()
}

fun money(paise: Long): String {
    val amount = paise.coerceAtLeast(0)
    val number = NumberFormat.getIntegerInstance(Locale("en", "IN")).format(amount / 100)
    return if (amount % 100 == 0L) "₹$number" else "₹$number.${(amount % 100).toString().padStart(2, '0')}"
}

/** Parse decimal money exactly, with no floating-point rounding. */
fun rupeesToPaise(value: String): Long? {
    val match = Regex("^(\\d{1,7})(?:\\.(\\d{1,2}))?$").matchEntire(value.trim()) ?: return null
    val whole = match.groupValues[1].toLongOrNull() ?: return null
    val cents = match.groupValues[2].padEnd(2, '0').toLongOrNull() ?: return null
    return (whole * 100 + cents).takeIf { it in 0..1_000_000 }
}

fun paiseInput(value: Long) = "${value / 100}.${(value % 100).toString().padStart(2, '0')}"
fun JSONObject.text(key: String, fallback: String = "") = if (isNull(key)) fallback else optString(key, fallback)
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.array(key: String): List<JSONObject> = optJSONArray(key)?.objects() ?: emptyList()
fun isUuid(value: String): Boolean = try { UUID.fromString(value).toString().equals(value, ignoreCase = true) } catch (_: Exception) { false }

/** Extract only the identifier; never open or send credentials to a pasted URL. */
fun orderIdFromLookup(value: String): String? {
    val candidate = value.trim().substringBefore('?').substringBefore('#').trimEnd('/').substringAfterLast('/')
    return candidate.takeIf(::isUuid)?.lowercase(Locale.ROOT)
}

fun orderStatusLabel(order: JSONObject): String {
    val status = order.text("status")
    if (status == "draft" && order.text("payment_method") == "upi") return when (order.text("payment_status")) {
        "submitted" -> "Payment to review"
        "pending" -> "Awaiting payment"
        "rejected" -> "Payment not confirmed"
        else -> "Payment review"
    }
    return laneTitle(status)
}

fun subscriptionActive(value: JSONObject?): Boolean {
    if (value == null) return false
    if (value.optBoolean("is_permanent", false)) return true
    return try { Instant.parse(value.text("expires_at")).isAfter(Instant.now()) } catch (_: Exception) { false }
}

/** Reject malformed numbers rather than truncating floating-point JSON money. */
private fun jsonInteger(value: Any?): Long? {
    if (value !is Number) return null
    val number = value.toDouble()
    if (!number.isFinite() || number < 0 || number > 9_007_199_254_740_991.0 || number % 1.0 != 0.0) return null
    return value.toLong()
}

/** Quotes must match the complete server contract before a native user can confirm them. */
fun validQuote(quote: JSONObject, term: String, code: String?): Boolean {
    val keys = setOf("term", "base_paise", "monthly_reference_paise", "discount_paise", "amount_paise", "promo_code", "promo_id", "promo_version", "plan_version", "access_expires_at")
    if (quote.keys().asSequence().toSet() != keys || term !in listOf("monthly", "six_months", "yearly") || quote.text("term") != term) return false
    val base = jsonInteger(quote.opt("base_paise")) ?: return false
    val discount = jsonInteger(quote.opt("discount_paise")) ?: return false
    val total = jsonInteger(quote.opt("amount_paise")) ?: return false
    if (base !in 1..100_000_000 || discount !in 0..base || total != base - discount || jsonInteger(quote.opt("plan_version")) == null) return false
    if (!quote.isNull("monthly_reference_paise") && (jsonInteger(quote.opt("monthly_reference_paise")) ?: return false) !in 1..1_200_000_000) return false
    if (!quote.isNull("access_expires_at")) {
        if (quote.opt("access_expires_at") !is String) return false
        try { Instant.parse(quote.getString("access_expires_at")) } catch (_: Exception) { return false }
    }
    if (!quote.isNull("promo_code") && quote.opt("promo_code") !is String) return false
    val receivedCode = quote.text("promo_code").ifBlank { null }
    if (receivedCode != code) return false
    return if (code == null) quote.isNull("promo_id") && quote.isNull("promo_version") && discount == 0L
    else isUuid(quote.text("promo_id")) && jsonInteger(quote.opt("promo_version")) != null && discount > 0
}
