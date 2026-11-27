package io.github.dawartariq.printly.owner.nativeapp

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val CHANNEL = "printly_orders_v1"
private const val REGISTER_WORK = "printly_native_fcm_register"
private const val SYNC_WORK = "printly_native_push_sync"
private const val UNREGISTER_WORK = "printly_native_fcm_unregister"
private const val SYNC_INTERVAL = 12 * 60 * 60 * 1000L

private data class PushState(
    val enabled: Boolean, val binding: String, val shop: String, val sessionId: String, val fid: String,
    val syncedFid: String, val syncedAt: Long, val syncedVersion: Int, val problem: String,
) {
    val connected: Boolean get() = enabled && fid.isNotBlank() && fid == syncedFid && syncedAt > 0
}

/** Consent, the account binding and display gate stay local to this phone.
 * Only the verified bearer gateway receives the FID and shop association. */
internal object NativePush {
    val available = true
    private val stateLock = Any()
    // Sign-out also retries earlier failed or still-running opt-outs. This
    // bounded bookkeeping contains no credentials and is not persisted.
    private val cleanup = PendingPushCleanup()
    // WorkManager and the activity share this process and the same API session.
    // Serialize Firebase registration, unregistration and background sync. The
    // server independently serializes DELETE with POST and tombstones bindings,
    // so local sign-out does not have to wait for a stuck network operation.
    private val registrationLock = Mutex()
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE)
    private fun read(context: Context): PushState = synchronized(stateLock) {
        val p = prefs(context)
        PushState(p.getBoolean("enabled", false), p.getString("binding", "") ?: "", p.getString("shop", "") ?: "",
            p.getString("session_id", "") ?: "", p.getString("fid", "") ?: "", p.getString("synced_fid", "") ?: "",
            p.getLong("synced_at", 0), p.getInt("synced_version", 0), p.getString("problem", "") ?: "")
    }
    private fun problem(context: Context, binding: String, value: String) {
        synchronized(stateLock) {
            val p = prefs(context)
            if (p.getBoolean("enabled", false) && p.getString("binding", "") == binding) p.edit().putString("problem", value).apply()
        }
    }
    private fun allowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }
    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL, "Printly alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Orders, announcements, maintenance and app updates"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
    private fun manager(context: Context) = WorkManager.getInstance(context.applicationContext)
    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    private fun enqueueRegister(context: Context, afterCurrent: Boolean = false) {
        val work = OneTimeWorkRequestBuilder<FcmRegisterWorker>().setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build()
        manager(context).enqueueUniqueWork(REGISTER_WORK, if (afterCurrent) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP, work)
    }
    private fun enqueueSync(context: Context) {
        val work = OneTimeWorkRequestBuilder<PushSyncWorker>().setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build()
        // A changed FID arriving while a worker runs must not be dropped.
        manager(context).enqueueUniqueWork(SYNC_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, work)
    }
    private fun enqueueUnregister(context: Context, afterCurrent: Boolean = false) {
        val work = OneTimeWorkRequestBuilder<FcmUnregisterWorker>().setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build()
        manager(context).enqueueUniqueWork(UNREGISTER_WORK, if (afterCurrent) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.REPLACE, work)
    }

    private suspend fun enable(context: Context, shop: String) = registrationLock.withLock {
        if (!validPushUuid(shop) || !allowed(context)) throw AppError("notification_permission", "Allow notifications in your phone settings first.")
        createChannel(context)
        synchronized(stateLock) {
            if (!allowed(context)) throw AppError("notification_permission", "Allow the New orders notification channel in your phone settings.")
            val currentSession = SessionStore(context).localIdOrNull()
                ?: throw AppError("session_expired", "Please sign in again.", 401)
            var previous = read(context)
            if (previous.enabled && !pushSessionMatches(true, previous.sessionId, currentSession)) {
                stopLocalLocked(context)
                previous = read(context)
            }
            if (previous.enabled && previous.shop != shop) throw AppError("notification_shop", "Turn notifications off before changing shops.")
            val binding = if (previous.enabled && validPushUuid(previous.binding)) previous.binding else UUID.randomUUID().toString()
            if (!previous.enabled || binding != previous.binding) {
                check(prefs(context).edit().clear().putBoolean("enabled", true).putString("binding", binding)
                    .putString("shop", shop).putString("session_id", currentSession).commit())
            }
            // Scheduling and the persisted opt-in transition share this lock;
            // a late stop cannot cancel work belonging to a newer opt-in.
            try {
                manager(context).cancelUniqueWork(UNREGISTER_WORK)
                FirebaseMessaging.getInstance().isAutoInitEnabled = true
                enqueueRegister(context)
            } catch (_: Exception) { problem(context, binding, "Could not start notifications. Check Google Play services and try again.") }
        }
    }

    /** State, notification cancellation and work scheduling share the display
     * lock. No code here waits for registrationLock or the API session lock. */
    private fun stopLocalLocked(context: Context, expectedSession: String? = null, expectedBinding: String? = null): LocalPushStop {
        val state = read(context)
        if (expectedSession != null && state.sessionId.isNotBlank() && state.sessionId != expectedSession) return LocalPushStop()
        if (expectedBinding != null && state.binding != expectedBinding) return LocalPushStop()
        if (!state.enabled && state.binding.isBlank() && state.fid.isBlank()) return LocalPushStop()
        cleanup.remember(state.sessionId, state.binding)
        // A preferences exception must not skip notification cancellation,
        // disabling FCM auto-init, or scheduling its unregistration.
        var confirmed = try { prefs(context).edit().clear().commit() } catch (_: Exception) { false }
        if (!validPushUuid(state.binding) || !validPushUuid(state.sessionId)) confirmed = false
        try { NotificationManagerCompat.from(context).cancelAll() } catch (_: Exception) { confirmed = false }
        try { FirebaseMessaging.getInstance().isAutoInitEnabled = false } catch (_: Exception) { confirmed = false }
        try { manager(context).cancelUniqueWork(REGISTER_WORK); manager(context).cancelUniqueWork(SYNC_WORK) } catch (_: Exception) { confirmed = false }
        try { enqueueUnregister(context) } catch (_: Exception) { confirmed = false }
        if (!confirmed) cleanup.localFailure(state.sessionId)
        return LocalPushStop(state.binding.takeIf { validPushUuid(it) }, confirmed, state.sessionId.takeIf { validPushUuid(it) })
    }
    private fun stopLocal(context: Context, expectedSession: String? = null, expectedBinding: String? = null): LocalPushStop = synchronized(stateLock) {
        try { stopLocalLocked(context, expectedSession, expectedBinding) }
        catch (_: Exception) { cleanup.localFailure(null); LocalPushStop(localConfirmed = false) }
    }

    /** The session and push gate change atomically with respect to delivery and
     * opt-in. The callback never waits for registrationLock. */
    fun sessionChange(context: Context, expectedSession: String? = null, change: () -> Unit): LocalPushStop = synchronized(stateLock) {
        val stopped = try { stopLocalLocked(context, expectedSession) }
            catch (_: Exception) { cleanup.localFailure(null); LocalPushStop(localConfirmed = false) }
        // A warning belongs to the previous session, not a later sign-in.
        if (expectedSession == null && stopped.localConfirmed) {
            try {
                val current = read(context)
                if (!current.enabled && current.binding.isBlank()) prefs(context).edit().remove("problem").apply()
            } catch (_: Exception) { /* A warning is advisory, not a display gate. */ }
        }
        change()
        stopped
    }
    fun beginSignOut(context: Context, sessionId: String): LocalPushStop = stopLocal(context, expectedSession = sessionId)

    suspend fun finishSignOut(sessionId: String?, stops: List<LocalPushStop>, revoke: suspend (String) -> Boolean): Boolean =
        cleanup.finish(sessionId, stops, revoke)

    internal suspend fun disconnect(context: Context, api: OwnerApi, expectedBinding: String? = null): Boolean = withContext(NonCancellable) {
        // Local display stops before remote I/O. Keep the attempt alive if the
        // settings screen is left, but never substitute a later account's token.
        val previous = stopLocal(context, expectedBinding = expectedBinding)
        val binding = previous.binding ?: return@withContext previous.localConfirmed
        val sessionId = previous.sessionId ?: return@withContext false
        val remoteConfirmed = try { api.unregisterPush(sessionId, binding) }
            catch (_: Exception) { false }
        if (remoteConfirmed) cleanup.acknowledge(sessionId, binding)
        if (!previous.localConfirmed || !remoteConfirmed) {
            // If the screen was left during cleanup, keep a non-sensitive
            // warning for the same signed-in user when settings are reopened.
            try {
                synchronized(stateLock) {
                    if (!read(context).enabled && SessionStore(context).localIdOrNull() == sessionId) {
                        prefs(context).edit().putString("problem", "Could not confirm server removal. Keep this phone private and block notifications in phone settings if needed.").apply()
                    }
                }
            } catch (_: Exception) { /* The immediate result still reports failure. */ }
        }
        previous.localConfirmed && remoteConfirmed
    }

    /** Revalidate permission and shop on each foreground return, and ask FCM to
     * refresh registration. A worker also retries when the network returns. */
    suspend fun refresh(context: Context, api: OwnerApi, shopId: String?) {
        val state = read(context)
        if (!state.enabled) return
        if (!pushSessionMatches(true, state.sessionId, SessionStore(context).localIdOrNull())) {
            stopLocal(context, expectedBinding = state.binding)
            return
        }
        if (!allowed(context) || (shopId != null && shopId.isNotBlank() && shopId != state.shop)) {
            disconnect(context, api, state.binding)
            return
        }
        try { enqueueRegister(context) }
        catch (_: Exception) { problem(context, state.binding, "Could not start notifications. Please try again.") }
    }

    fun registered(context: Context, fid: String) {
        if (!validPushFid(fid)) return
        synchronized(stateLock) {
            val state = read(context)
            val currentSession = if (state.enabled) SessionStore(context).localIdOrNull() else null
            when (pushCallbackAction(true, state.enabled, state.sessionId, currentSession, allowed(context))) {
                PushCallbackAction.UNREGISTER -> {
                    // A timed-out/cancelled register() can finish after opt-out.
                    try { FirebaseMessaging.getInstance().isAutoInitEnabled = false; enqueueUnregister(context, afterCurrent = true) }
                    catch (_: Exception) { /* The local display gate stays off. */ }
                }
                PushCallbackAction.STOP -> stopLocalLocked(context, expectedBinding = state.binding)
                PushCallbackAction.ACCEPT -> {
                    if (!validPushUuid(state.binding) || !validPushUuid(state.shop)) { stopLocalLocked(context); return@synchronized }
                    val changed = state.fid != fid
                    val edit = prefs(context).edit().putString("fid", fid)
                    if (changed) edit.remove("synced_fid").putLong("synced_at", 0)
                    if (!edit.commit()) { problem(context, state.binding, "Could not save notification setup. Please try again."); return@synchronized }
                    if (changed || state.syncedFid != fid || state.syncedVersion != BuildConfig.VERSION_CODE || System.currentTimeMillis() - state.syncedAt >= SYNC_INTERVAL) {
                        try { enqueueSync(context) }
                        catch (_: Exception) { problem(context, state.binding, "Could not connect notifications. Open the app to retry.") }
                    }
                }
                else -> Unit
            }
        }
    }

    fun unregistered(context: Context) = synchronized(stateLock) {
        val state = read(context)
        val currentSession = if (state.enabled) SessionStore(context).localIdOrNull() else null
        when (pushCallbackAction(false, state.enabled, state.sessionId, currentSession, allowed(context))) {
            PushCallbackAction.STOP -> { stopLocalLocked(context, expectedBinding = state.binding); Unit }
            PushCallbackAction.REREGISTER -> {
                // An earlier unregister() may finish after a new opt-in. Clear
                // the cached server sync and queue registration behind any
                // running register work so the late callback cannot be lost.
                prefs(context).edit().remove("synced_fid").putLong("synced_at", 0).commit()
                try { FirebaseMessaging.getInstance().isAutoInitEnabled = true; enqueueRegister(context, afterCurrent = true) }
                catch (_: Exception) { problem(context, state.binding, "Could not reconnect notifications. Open the app to retry.") }
            }
            else -> Unit
        }
    }

    internal suspend fun registerFcm(context: Context): Boolean = registrationLock.withLock {
        val state = synchronized(stateLock) {
            val current = read(context)
            if (!current.enabled) return@withLock true
            if (!pushSessionMatches(true, current.sessionId, SessionStore(context).localIdOrNull()) || !allowed(context)) {
                stopLocalLocked(context, expectedBinding = current.binding)
                return@withLock true
            }
            try { FirebaseMessaging.getInstance().isAutoInitEnabled = true }
            catch (_: Exception) { problem(context, current.binding, "Waiting for Google Play services or an internet connection."); return@withLock false }
            current
        }
        try {
            withContext(Dispatchers.IO) { Tasks.await(FirebaseMessaging.getInstance().register(), 20, TimeUnit.SECONDS) }
            true // onRegistered() schedules the authenticated server sync.
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { problem(context, state.binding, "Waiting for Google Play services or an internet connection."); false }
    }

    internal suspend fun sync(context: Context): Boolean = registrationLock.withLock {
        val state = read(context)
        if (!state.enabled) return@withLock true
        if (!pushSessionMatches(true, state.sessionId, SessionStore(context).localIdOrNull()) || !allowed(context)) {
            stopLocal(context, expectedBinding = state.binding)
            return@withLock true
        }
        if (!validPushUuid(state.binding) || !validPushUuid(state.shop) || !validPushFid(state.fid)) return@withLock true
        if (state.fid == state.syncedFid && state.syncedVersion == BuildConfig.VERSION_CODE && state.syncedAt > 0 && System.currentTimeMillis() - state.syncedAt < SYNC_INTERVAL) return@withLock true
        val api = OwnerApiProvider.live(context)
        try {
            if (!api.restore()) return@withLock true
            // Bind the request to the same local session, then re-verify its
            // bearer and membership for this exact shop on the server.
            api.registerPush(state.sessionId, JSONObject().put("shop_id", state.shop).put("binding_id", state.binding).put("fid", state.fid)
                .put("version_code", BuildConfig.VERSION_CODE).put("version_name", BuildConfig.VERSION_NAME))
            synchronized(stateLock) {
                val current = read(context)
                if (current.enabled && current.binding == state.binding && current.shop == state.shop &&
                    current.sessionId == state.sessionId && current.fid == state.fid) {
                    prefs(context).edit().putString("synced_fid", state.fid).putLong("synced_at", System.currentTimeMillis())
                        .putInt("synced_version", BuildConfig.VERSION_CODE).remove("problem").commit()
                }
            }
            true
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: AppError) {
            if (error.httpStatus == 401 || error.httpStatus == 403 || error.code == "session_changed" || error.code == "stale_request") {
                stopLocal(context, expectedBinding = state.binding); true
            } else { problem(context, state.binding, "Could not connect notifications. We’ll retry when the service is available."); false }
        } catch (_: Exception) { problem(context, state.binding, "Could not connect notifications. We’ll retry when the service is available."); false }
    }

    internal suspend fun unregisterFcm(context: Context): Boolean = registrationLock.withLock {
        synchronized(stateLock) {
            if (read(context).enabled) return@withLock true
            try { FirebaseMessaging.getInstance().isAutoInitEnabled = false } catch (_: Exception) { return@withLock false }
        }
        try {
            withContext(Dispatchers.IO) { Tasks.await(FirebaseMessaging.getInstance().unregister(), 20, TimeUnit.SECONDS) }
            true
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { false }
    }

    private fun notification(context: Context, notice: PushNotice, picture: Bitmap? = null): android.app.Notification {
        // Explicit immutable intents contain only a random event ID. MainActivity
        // retrieves the text and destination from this app's private storage,
        // not from potentially forged exported-activity extras.
        val intent = Intent(context, MainActivity::class.java)
            .setData(Uri.parse("printly-internal://notice/${notice.tag}"))
            .putExtra("printly_event", notice.tag)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val open = PendingIntent.getActivity(context, notice.tag.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_push_printly)
            .setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.owner_icon))
            .setColor(android.graphics.Color.rgb(233, 82, 8))
            .setContentTitle(notice.title).setContentText(notice.body).setContentIntent(open)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true).setOnlyAlertOnce(true)
        if (picture == null) builder.setStyle(NotificationCompat.BigTextStyle().bigText(notice.body))
        else builder.setStyle(NotificationCompat.BigPictureStyle().bigPicture(picture).setSummaryText(notice.body))
        return builder.build()
    }

    private fun image(value: String): Bitmap? {
        if (!validNoticeImage(value)) return null
        val client = secureHttpClient.newBuilder().connectTimeout(3, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).callTimeout(8, TimeUnit.SECONDS).build()
        return try {
            client.newCall(Request.Builder().url(value).get().build()).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body ?: return null
                if (body.contentLength() > 1_000_000) return null
                val bytes = ByteArrayOutputStream()
                body.byteStream().use { input ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        if (bytes.size() + n > 1_000_000) return null
                        bytes.write(buffer, 0, n)
                    }
                }
                val raw = bytes.toByteArray()
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
                if (bounds.outWidth !in 1..2048 || bounds.outHeight !in 1..2048 || bounds.outWidth.toLong() * bounds.outHeight > 4_000_000L) return null
                BitmapFactory.decodeByteArray(raw, 0, raw.size)
            }
        } catch (_: Exception) { null }
    }

    /** Read only a notice previously stored for the current opted-in session.
     * Random IDs from the exported activity are not authority. Caller holds the
     * state lock, including when a queued tap is revalidated before navigation. */
    private fun storedTapLocked(context: Context, event: String): PushTap? {
        if (!validPushUuid(event)) return null
        val state = read(context)
        val key = "notice_${event.lowercase()}"
        val stored = try { JSONObject(prefs(context).getString(key, null) ?: return null) } catch (_: Exception) { return null }
        val age = System.currentTimeMillis() - stored.optLong("at", 0)
        val action = stored.optString("action", "")
        val tap = PushTap(event, stored.optString("title", ""), stored.optString("body", ""), action,
            stored.optString("binding", ""), stored.optString("session", ""))
        if (age !in 0..172_800_000L || !validPushAction(action) ||
            !pushTapMatchesSession(tap, state.enabled, state.binding, state.sessionId, SessionStore(context).localIdOrNull())) return null
        return tap
    }
    fun consumeTap(context: Context, intent: Intent?): PushTap? = synchronized(stateLock) {
        intent?.getStringExtra("printly_event")?.let { storedTapLocked(context, it) }
    }
    fun currentTap(context: Context, tap: PushTap): PushTap? = synchronized(stateLock) {
        storedTapLocked(context, tap.event)?.takeIf { it == tap }
    }
    fun clearTap(context: Context, tap: PushTap) = synchronized(stateLock) {
        if (validPushUuid(tap.event)) {
            val key = "notice_${tap.event.lowercase()}"
            val stored = try { JSONObject(prefs(context).getString(key, null) ?: return@synchronized) } catch (_: Exception) { return@synchronized }
            // Do not delete a same-event notice stored after an account switch.
            if (stored.optString("binding", "") == tap.binding && stored.optString("session", "") == tap.sessionId) prefs(context).edit().remove(key).apply()
        }
    }

    @SuppressLint("MissingPermission")
    fun deliver(context: Context, data: Map<String, String>) {
        val delivered = synchronized(stateLock) {
            val state = read(context)
            val sessionMatches = pushSessionMatches(state.enabled, state.sessionId, SessionStore(context).localIdOrNull())
            val notice = nativePushNotice(data, sessionMatches, state.binding, allowed(context)) ?: return@synchronized null
            val p = prefs(context)
            if (p.contains("seen_${notice.tag}")) return@synchronized null
            createChannel(context)
            if (!allowed(context)) return@synchronized null
            val record = JSONObject().put("title", notice.title).put("body", notice.body).put("action", notice.action)
                .put("session", state.sessionId).put("binding", state.binding).put("at", System.currentTimeMillis())
            val edit = p.edit().putString("notice_${notice.tag}", record.toString())
            // Bounded, non-sensitive local history, cleared on sign-out/opt-out.
            p.all.filterKeys { it.startsWith("notice_") && it != "notice_${notice.tag}" }.keys.take((p.all.keys.count { it.startsWith("notice_") } - 49).coerceAtLeast(0)).forEach { edit.remove(it) }
            p.all.filterKeys { it.startsWith("seen_") }.entries.sortedBy { (it.value as? Long) ?: 0L }.take((p.all.keys.count { it.startsWith("seen_") } - 99).coerceAtLeast(0)).forEach { edit.remove(it.key) }
            if (!edit.commit()) return@synchronized null
            try {
                NotificationManagerCompat.from(context).notify(notice.tag, 0, notification(context, notice))
                p.edit().putLong("seen_${notice.tag}", System.currentTimeMillis()).apply()
                val work = OneTimeWorkRequestBuilder<PushDisplayWorker>().setConstraints(constraints())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                    .setInputData(workDataOf("event" to notice.tag, "binding" to state.binding, "session" to state.sessionId)).build()
                try { manager(context).enqueueUniqueWork("printly_push_display_${notice.tag}", ExistingWorkPolicy.KEEP, work) } catch (_: Exception) { /* Receipt is optional. */ }
                Triple(notice, state.binding, state.sessionId)
            } catch (_: SecurityException) { p.edit().remove("notice_${notice.tag}").apply(); null }
        } ?: return
        val picture = delivered.first.image?.let(::image) ?: return
        synchronized(stateLock) {
            val state = read(context)
            // Do not deliberately recreate an alert the person dismissed while
            // its image was downloading. The system can still race this check.
            val stillVisible = try {
                context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.tag == delivered.first.tag && it.id == 0 }
            } catch (_: Exception) { false }
            if (stillVisible && state.binding == delivered.second && state.sessionId == delivered.third && pushSessionMatches(state.enabled, state.sessionId, SessionStore(context).localIdOrNull()) &&
                allowed(context) && prefs(context).contains("notice_${delivered.first.tag}")) {
                try { NotificationManagerCompat.from(context).notify(delivered.first.tag, 0, notification(context, delivered.first, picture)) } catch (_: SecurityException) { }
            }
        }
    }

    /** OS permission does not enroll a device. Ask the signed-in shop user
     * explicitly, once per shop on this phone, without undoing later opt-outs. */
    @Composable fun FirstShopPrompt(shopId: String?) {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val promptPrefs = remember { context.getSharedPreferences("native_push_onboarding_v1", Context.MODE_PRIVATE) }
        var show by remember(shopId) { mutableStateOf(false) }
        var busy by remember(shopId) { mutableStateOf(false) }
        var error by remember(shopId) { mutableStateOf("") }
        suspend fun connect() {
            val shop = shopId ?: return
            busy = true
            try {
                enable(context, shop)
                if (!promptPrefs.edit().putBoolean(shop, true).commit()) throw IllegalStateException("Could not save choice")
                show = false
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { error = "Could not enable alerts. Check your phone settings and try again." }
            finally { busy = false }
        }
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) scope.launch { connect() }
            else error = "Notifications are blocked. You can allow them later in your phone settings."
        }
        LaunchedEffect(shopId) {
            if (shopId != null && validPushUuid(shopId)) {
                if (read(context).enabled) promptPrefs.edit().putBoolean(shopId, true).apply()
                show = !read(context).enabled && !promptPrefs.getBoolean(shopId, false)
            } else show = false
        }
        if (show) AlertDialog(
            onDismissRequest = {},
            title = { Text("Stay on top of your shop") },
            text = { Text("Turn on Printly alerts for new orders, announcements and updates on this phone. You can turn them off in Notifications. Delivery may be delayed or blocked by your phone or network." + if (error.isNotBlank()) "\n\n$error" else "") },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else scope.launch { connect() }
            }) { Text(if (busy) "Connecting…" else "Turn on alerts") } },
            dismissButton = { TextButton(enabled = !busy, onClick = {
                shopId?.let { promptPrefs.edit().putBoolean(it, true).apply() }
                show = false
            }) { Text("Not now") } },
        )
    }

    @Composable fun Settings(api: OwnerApi, shopId: String?) {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        var state by remember { mutableStateOf(read(context)) }
        var canNotify by remember { mutableStateOf(allowed(context)) }
        var busy by remember { mutableStateOf(false) }
        var notice by remember { mutableStateOf("") }
        suspend fun connect() {
            val shop = shopId ?: return
            busy = true; notice = ""
            try { enable(context, shop); state = read(context) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { notice = if (error is AppError) error.message else "Could not save notification settings. Please try again." }
            finally { busy = false }
        }
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            canNotify = allowed(context)
            if (granted) scope.launch { connect() }
            else notice = "Notifications are off. You can allow them in your phone settings."
        }
        LaunchedEffect(lifecycle) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive) { state = read(context); canNotify = allowed(context); delay(1500) }
            }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Heading("Printly notifications", "Get orders, announcements, maintenance and update alerts, even when the app is closed.")
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text(if (!state.enabled) "Off on this phone" else if (state.connected) "Enabled on this phone" else "Connecting…", fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(6.dp))
                Text("Order alerts contain no customer details. General announcements may include a message or public image. Internet and Google Play services are needed; delivery can be delayed. Signing out turns alerts off on this phone.", color = Muted)
                if (state.problem.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(state.problem, color = OrangeDark) }
            }
            if (notice.isNotBlank()) InfoBanner(notice)
            if (!canNotify) {
                InfoBanner("Your phone or notification channel is blocking alerts. Allow notifications in phone settings.")
                SecondaryButton("Open phone notification settings", {
                    try {
                        val intent = if (Build.VERSION.SDK_INT >= 26) Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(AndroidSettings.EXTRA_APP_PACKAGE, context.packageName)
                            else Intent(AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (_: Exception) { notice = "Open your phone’s app settings and allow notifications for Printly for Shops." }
                }, Modifier.fillMaxWidth())
            }
            if (state.enabled) {
                if (state.problem.isNotBlank() && canNotify) SecondaryButton("Retry connection", {
                    try {
                        enqueueRegister(context)
                        if (validPushFid(read(context).fid)) enqueueSync(context)
                        notice = "Trying to connect notifications."
                    } catch (_: Exception) { notice = "Could not start notification setup. Please try again." }
                }, Modifier.fillMaxWidth(), enabled = !busy)
                SecondaryButton(if (busy) "Turning off…" else "Turn off notifications", {
                    if (!busy) scope.launch(start = CoroutineStart.UNDISPATCHED) {
                        busy = true
                        val confirmed = try { disconnect(context, api) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { false }
                        state = read(context); busy = false
                        notice = if (confirmed) "Notifications are off on this phone." else "Notification shutdown could not be fully confirmed. Block Printly notifications in phone settings if needed."
                    }
                }, Modifier.fillMaxWidth(), enabled = !busy)
            } else {
                if (shopId.isNullOrBlank()) InfoBanner("Load your shop first to turn on notifications.")
                PrimaryButton(if (busy) "Connecting…" else "Turn on notifications", {
                    if (!busy) {
                        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else scope.launch { connect() }
                    }
                }, Modifier.fillMaxWidth(), enabled = !busy && !shopId.isNullOrBlank())
            }
        }
    }
}

class NativeMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) { NativePush.registered(applicationContext, installationId) }
    override fun onUnregistered(installationId: String) { NativePush.unregistered(applicationContext) }
    override fun onMessageReceived(message: RemoteMessage) { NativePush.deliver(applicationContext, message.data) }
}

class PushDisplayWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val event = inputData.getString("event") ?: return Result.success()
        val binding = inputData.getString("binding") ?: return Result.success()
        val session = inputData.getString("session") ?: return Result.success()
        if (!validPushUuid(event) || !validPushUuid(binding) || !validPushUuid(session)) return Result.success()
        return try {
            val api = OwnerApiProvider.live(applicationContext)
            if (!api.restore()) return Result.success()
            api.reportPushDisplay(session, binding, event)
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: AppError) {
            if (error.httpStatus == 401 || error.httpStatus == 403 || error.code == "session_changed" || runAttemptCount >= 3) Result.success() else Result.retry()
        } catch (_: Exception) { if (runAttemptCount >= 3) Result.success() else Result.retry() }
    }
}

class FcmRegisterWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (NativePush.registerFcm(applicationContext)) Result.success() else Result.retry()
}
class PushSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (NativePush.sync(applicationContext)) Result.success() else Result.retry()
}
class FcmUnregisterWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (NativePush.unregisterFcm(applicationContext) || runAttemptCount >= 10) Result.success() else Result.retry()
}
