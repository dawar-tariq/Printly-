package io.github.dawartariq.printly.owner.nativeapp

import java.net.URI
import java.util.Locale

internal data class PushNotice(val tag: String, val title: String, val body: String, val action: String = "orders", val image: String? = null)
internal data class PushTap(val event: String, val title: String, val body: String, val action: String, val binding: String, val sessionId: String)
private val pushUuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
internal fun validPushFid(value: String): Boolean = Regex("^[A-Za-z0-9_-]{22}$").matches(value)
internal fun validPushUuid(value: String): Boolean = pushUuid.matches(value)

/** A random local session ID survives refresh, but changes at every sign-in. */
internal fun pushSessionMatches(enabled: Boolean, enrolledSession: String?, currentSession: String?): Boolean =
    enabled && enrolledSession != null && currentSession != null && validPushUuid(enrolledSession) && enrolledSession == currentSession

/** A tap can wait through login, maintenance or an update screen. Recheck its
 * original session and binding at navigation time, not just on activity launch. */
internal fun pushTapMatchesSession(tap: PushTap, enabled: Boolean, binding: String?, enrolledSession: String?, currentSession: String?): Boolean =
    validPushUuid(tap.event) && validPushUuid(tap.binding) && tap.binding == binding && tap.sessionId == enrolledSession &&
        pushSessionMatches(enabled, enrolledSession, currentSession)

internal enum class PushCallbackAction { ACCEPT, STOP, UNREGISTER, REREGISTER, IGNORE }
internal fun pushCallbackAction(registered: Boolean, enabled: Boolean, enrolledSession: String?, currentSession: String?, allowed: Boolean): PushCallbackAction {
    if (!enabled) return if (registered) PushCallbackAction.UNREGISTER else PushCallbackAction.IGNORE
    if (!pushSessionMatches(enabled, enrolledSession, currentSession) || !allowed) return PushCallbackAction.STOP
    return if (registered) PushCallbackAction.ACCEPT else PushCallbackAction.REREGISTER
}

/** Local storage/display shutdown can fail independently of remote deletion. */
internal data class LocalPushStop(
    val binding: String? = null,
    val localConfirmed: Boolean = true,
    val sessionId: String? = null,
)

/** Only images in the fixed public repository can be fetched on a phone. */
internal fun validNoticeImage(value: String): Boolean {
    if (value.length > 500 || !Regex("^https://raw\\.githubusercontent\\.com/dawar-tariq/Printly-/[A-Za-z0-9][A-Za-z0-9._+\\-]{0,79}(?:/[A-Za-z0-9][A-Za-z0-9._+\\-]{0,119})+\\.(?:png|jpe?g|webp)$", RegexOption.IGNORE_CASE).matches(value)) return false
    return try { val uri = URI(value); uri.scheme == "https" && uri.host == "raw.githubusercontent.com" && uri.port == -1 && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.toString() == value } catch (_: Exception) { false }
}
internal fun validPushAction(action: String): Boolean = action in setOf("home", "orders", "announcement", "maintenance", "update")
private fun safeNoticeText(value: String, max: Int, singleLine: Boolean = false): Boolean =
    value.isNotBlank() && value.length <= max && value.none { (it.code in 0..8) || it.code == 11 || it.code == 12 || (it.code in 14..31) || it.code == 127 || (singleLine && (it == '\r' || it == '\n')) }

/** The binding changes on each opt-in. Late messages from an earlier account
 * or a signed-out phone must never turn into a notification. */
internal fun nativePushNotice(data: Map<String, String>, enabled: Boolean, binding: String?, allowed: Boolean): PushNotice? {
    if (!enabled || !allowed || binding == null || !validPushUuid(binding) || !data["binding"].equals(binding, ignoreCase = true)) return null
    val event = data["event"] ?: return null
    if (!validPushUuid(event)) return null
    val tag = event.lowercase(Locale.ROOT)
    if (data["version"] == "1") {
        if (data.keys != setOf("version", "kind", "event", "binding")) return null
        val title = when (data["kind"]) {
            "order" -> "New Printly order"
            "payment" -> "Printly order needs attention"
            else -> return null
        }
        return PushNotice(tag, title, "Open Printly for Shops to view your orders.")
    }
    if (data["version"] != "2" || data.keys != setOf("version", "kind", "event", "binding", "title", "body", "action", "image")) return null
    val kind = data["kind"] ?: return null
    if (kind !in setOf("general", "important", "feature", "maintenance", "promotion", "update")) return null
    val title = data["title"] ?: return null
    val body = data["body"] ?: return null
    val action = data["action"] ?: return null
    val image = data["image"] ?: return null
    if (!safeNoticeText(title, 100, true) || !safeNoticeText(body, 500) || !validPushAction(action) || (image.isNotEmpty() && !validNoticeImage(image))) return null
    return PushNotice(tag, title, body, action, image.ifEmpty { null })
}
