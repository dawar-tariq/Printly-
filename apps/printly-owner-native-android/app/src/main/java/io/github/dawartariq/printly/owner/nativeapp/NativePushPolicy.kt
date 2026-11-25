package io.github.dawartariq.printly.owner.nativeapp

import java.util.Locale

internal data class PushNotice(val tag: String, val title: String, val body: String)
private val pushUuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
internal fun validPushFid(value: String): Boolean = Regex("^[A-Za-z0-9_-]{22}$").matches(value)
internal fun validPushUuid(value: String): Boolean = pushUuid.matches(value)

/** The binding changes on each opt-in. Late messages from an earlier account
 * or a signed-out phone must never turn into a notification. */
internal fun nativePushNotice(data: Map<String, String>, enabled: Boolean, binding: String?, allowed: Boolean): PushNotice? {
    if (!enabled || !allowed || binding == null || !validPushUuid(binding) ||
        data.keys != setOf("version", "kind", "event", "binding") || data["version"] != "1" ||
        !data["binding"].equals(binding, ignoreCase = true)) return null
    val event = data["event"] ?: return null
    if (!validPushUuid(event)) return null
    val title = when (data["kind"]) {
        "order" -> "New Printly order"
        "payment" -> "Printly order needs attention"
        else -> return null
    }
    return PushNotice(event.lowercase(Locale.ROOT), title, "Open Printly for Shops to view your orders.")
}
