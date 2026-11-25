package io.github.dawartariq.printly.owner.nativeapp

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
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
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val CHANNEL = "printly_orders_v1"
private const val REGISTER_WORK = "printly_native_fcm_register"
private const val SYNC_WORK = "printly_native_push_sync"
private const val UNREGISTER_WORK = "printly_native_fcm_unregister"
private const val SYNC_INTERVAL = 12 * 60 * 60 * 1000L

private data class PushState(
    val enabled: Boolean, val binding: String, val shop: String, val sessionId: String, val fid: String,
    val syncedFid: String, val syncedAt: Long, val problem: String,
) {
    val connected: Boolean get() = enabled && fid.isNotBlank() && fid == syncedFid && syncedAt > 0
}

/** Consent, the account binding and display gate stay local to this phone.
 * Only the verified bearer gateway receives the FID and shop association. */
internal object NativePush {
    val available = true
    private val stateLock = Any()
    // WorkManager and the activity share this process and the same API session.
    // Serialize registration with revocation so a late request cannot reattach
    // a signed-out device after the delete has completed.
    private val registrationLock = Mutex()
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE)
    private fun read(context: Context): PushState = synchronized(stateLock) {
        val p = prefs(context)
        PushState(p.getBoolean("enabled", false), p.getString("binding", "") ?: "", p.getString("shop", "") ?: "",
            p.getString("session_id", "") ?: "", p.getString("fid", "") ?: "", p.getString("synced_fid", "") ?: "",
            p.getLong("synced_at", 0), p.getString("problem", "") ?: "")
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
            val channel = NotificationChannel(CHANNEL, "New orders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New order and payment-review alerts"
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
        var confirmed = prefs(context).edit().clear().commit()
        try { NotificationManagerCompat.from(context).cancelAll() } catch (_: Exception) { confirmed = false }
        try { FirebaseMessaging.getInstance().isAutoInitEnabled = false } catch (_: Exception) { confirmed = false }
        try { manager(context).cancelUniqueWork(REGISTER_WORK); manager(context).cancelUniqueWork(SYNC_WORK) } catch (_: Exception) { confirmed = false }
        try { enqueueUnregister(context) } catch (_: Exception) { confirmed = false }
        return LocalPushStop(state.binding.takeIf { validPushUuid(it) }, confirmed)
    }
    private fun stopLocal(context: Context, expectedSession: String? = null, expectedBinding: String? = null): LocalPushStop = synchronized(stateLock) {
        try { stopLocalLocked(context, expectedSession, expectedBinding) } catch (_: Exception) { LocalPushStop(localConfirmed = false) }
    }

    /** The session and push gate change atomically with respect to delivery and
     * opt-in. The callback never waits for registrationLock. */
    fun sessionChange(context: Context, expectedSession: String? = null, change: () -> Unit): LocalPushStop = synchronized(stateLock) {
        val stopped = try { stopLocalLocked(context, expectedSession) } catch (_: Exception) { LocalPushStop(localConfirmed = false) }
        change()
        stopped
    }
    fun beginSignOut(context: Context, sessionId: String): LocalPushStop = stopLocal(context, expectedSession = sessionId)

    suspend fun finishSignOut(context: Context, stops: List<LocalPushStop>, revoke: suspend (String) -> Boolean): Boolean {
        val bindings = stops.mapNotNull { it.binding }.distinct()
        if (bindings.isEmpty()) return stops.all { it.localConfirmed }
        return registrationLock.withLock {
            var confirmed = stops.all { it.localConfirmed }
            for (binding in bindings) {
                if (!revoke(binding)) confirmed = false
            }
            confirmed
        }
    }

    private suspend fun disconnect(context: Context, api: OwnerApi, expectedBinding: String? = null): Boolean {
        val previous = stopLocal(context, expectedBinding = expectedBinding)
        val binding = previous.binding ?: return previous.localConfirmed
        return registrationLock.withLock {
            try { api.request("DELETE", "push-device", JSONObject().put("binding_id", binding)); previous.localConfirmed }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { false }
        }
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
                    if (changed || state.syncedFid != fid || System.currentTimeMillis() - state.syncedAt >= SYNC_INTERVAL) {
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
        if (state.fid == state.syncedFid && state.syncedAt > 0 && System.currentTimeMillis() - state.syncedAt < SYNC_INTERVAL) return@withLock true
        val api = OwnerApiProvider.live(context)
        try {
            if (!api.restore()) return@withLock true
            // Bind the request to the same local session, then re-verify its
            // bearer and membership for this exact shop on the server.
            api.registerPush(state.sessionId, JSONObject().put("shop_id", state.shop).put("binding_id", state.binding).put("fid", state.fid))
            synchronized(stateLock) {
                val current = read(context)
                if (current.enabled && current.binding == state.binding && current.shop == state.shop &&
                    current.sessionId == state.sessionId && current.fid == state.fid) {
                    prefs(context).edit().putString("synced_fid", state.fid).putLong("synced_at", System.currentTimeMillis()).remove("problem").commit()
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

    @SuppressLint("MissingPermission")
    fun deliver(context: Context, data: Map<String, String>) = synchronized(stateLock) {
        val state = read(context)
        val sessionMatches = pushSessionMatches(state.enabled, state.sessionId, SessionStore(context).localIdOrNull())
        val notice = nativePushNotice(data, sessionMatches, state.binding, allowed(context)) ?: return@synchronized
        createChannel(context)
        if (!allowed(context)) return@synchronized
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_push_printer)
            .setContentTitle(notice.title).setContentText(notice.body).setContentIntent(open)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true).setOnlyAlertOnce(true).build()
        try { NotificationManagerCompat.from(context).notify(notice.tag, 0, notification) }
        catch (_: SecurityException) { /* Permission was revoked between the check and display. */ }
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
            Heading("Order notifications", "Get an alert when a new order or payment needs your attention, even when the app is closed.")
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text(if (!state.enabled) "Off on this phone" else if (state.connected) "Enabled on this phone" else "Connecting…", fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(6.dp))
                Text("Alerts contain no customer or order details. Internet and Google Play services are needed; delivery can be delayed. Signing out turns them off on this phone.", color = Muted)
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
                    if (!busy) scope.launch {
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

class FcmRegisterWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (NativePush.registerFcm(applicationContext)) Result.success() else Result.retry()
}
class PushSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (NativePush.sync(applicationContext)) Result.success() else Result.retry()
}
class FcmUnregisterWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (NativePush.unregisterFcm(applicationContext) || runAttemptCount >= 10) Result.success() else Result.retry()
}
