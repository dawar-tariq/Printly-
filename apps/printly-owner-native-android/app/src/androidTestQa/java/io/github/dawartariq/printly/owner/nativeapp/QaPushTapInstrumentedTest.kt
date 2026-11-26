package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic, fresh, offline QA package only. No FCM registration or send. */
@RunWith(AndroidJUnit4::class)
class QaPushTapInstrumentedTest {
    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences
    private lateinit var store: SessionStore
    private var safeToClean = false
    private val event = "22222222-2222-4222-8222-222222222222"
    private val firstBinding = "33333333-3333-4333-8333-333333333333"
    private val secondBinding = "44444444-4444-4444-8444-444444444444"

    @Before fun prepare() {
        context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        assertEquals("io.github.dawartariq.printly.owner.native.qa", context.packageName)
        assertTrue(BuildConfig.ISOLATED_TEST_MODE)
        assertFalse(BuildConfig.DEMO_MODE)
        assertTrue("This test requires a disposable Android emulator", Build.HARDWARE in setOf("ranchu", "goldfish"))
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        assertNull("This test requires a network-disabled emulator", connectivity.activeNetwork)
        prefs = context.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE)
        val sessionPrefs = context.getSharedPreferences("native_session_v1", Context.MODE_PRIVATE)
        // Check raw storage before calling SessionStore.load(): loading an old
        // session may upgrade it, and this test must not mutate a user's data.
        assertTrue("This test requires fresh push preferences", prefs.all.isEmpty())
        assertTrue("This test requires fresh session storage", sessionPrefs.all.isEmpty())
        assertFalse("This test requires Firebase auto-init to be off", context.getSharedPreferences("com.google.firebase.messaging", Context.MODE_PRIVATE).getBoolean("auto_init", false))
        assertFalse(FirebaseMessaging.getInstance().isAutoInitEnabled)
        store = SessionStore(context)
        assertNull("This test requires a fresh session", store.load())
        safeToClean = true
    }

    @After fun cleanup() {
        if (safeToClean) {
            val pushCleared = prefs.edit().clear().commit()
            val sessionCleared = store.clear()
            assertTrue("Synthetic state could not be removed", pushCleared && sessionCleared)
        }
    }

    private fun session(): Session = Session("synthetic-access", "synthetic-refresh", System.currentTimeMillis() / 1000 + 3600)
    private fun record(session: Session, binding: String, title: String, at: Long = System.currentTimeMillis()) {
        val data = JSONObject().put("title", title).put("body", "Synthetic notice")
            .put("action", "announcement").put("binding", binding).put("session", session.localId).put("at", at)
        assertTrue(prefs.edit().putBoolean("enabled", true).putString("binding", binding)
            .putString("session_id", session.localId).putString("notice_$event", data.toString()).commit())
    }
    private fun intent(id: String = event) = Intent().putExtra("printly_event", id)

    @Test fun staleTapCannotCrossSessionOrEraseANewerBinding() {
        val first = session()
        store.save(first)
        record(first, firstBinding, "First session")
        val oldTap = NativePush.consumeTap(context, intent())
        assertNotNull(oldTap)
        assertEquals(oldTap, NativePush.currentTap(context, oldTap!!))

        // Simulate a tap captured by the activity before a new sign-in.
        val second = session()
        store.save(second)
        assertNull(NativePush.currentTap(context, oldTap))
        record(second, secondBinding, "Second session")
        NativePush.clearTap(context, oldTap)
        val newTap = NativePush.consumeTap(context, intent())
        assertNotNull("Clearing the old tap must not erase a newer session's notice", newTap)
        assertEquals("Second session", newTap!!.title)
        assertEquals(secondBinding, newTap.binding)
        assertEquals(second.localId, newTap.sessionId)
        assertNull(NativePush.currentTap(context, oldTap))
        NativePush.clearTap(context, newTap)
        assertNull(NativePush.consumeTap(context, intent()))
    }

    @Test fun storedTapsRequireFreshOptedInStateAndAnExistingEvent() {
        val current = session()
        store.save(current)
        record(current, firstBinding, "Current")
        assertNull(NativePush.consumeTap(context, intent("55555555-5555-4555-8555-555555555555")))
        assertNull(NativePush.consumeTap(context, intent("not-an-event")))
        assertNotNull(NativePush.consumeTap(context, intent()))
        assertTrue(prefs.edit().putBoolean("enabled", false).commit())
        assertNull(NativePush.consumeTap(context, intent()))
        record(current, firstBinding, "Expired", System.currentTimeMillis() - 172_801_000L)
        assertNull(NativePush.consumeTap(context, intent()))
        record(current, firstBinding, "Future", System.currentTimeMillis() + 60_000L)
        assertNull(NativePush.consumeTap(context, intent()))
    }
}
