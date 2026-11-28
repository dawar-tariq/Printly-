package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Fresh, offline QA install only. This does not test delivery from FCM. */
@RunWith(AndroidJUnit4::class)
class QaFirebaseInstrumentedTest {
    @Test fun isolatedClientStartsWithTheTestProjectAndNoNotificationOptIn() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        assertEquals("io.github.dawartariq.printly.owner.native.qa", context.packageName)
        assertTrue(BuildConfig.ISOLATED_TEST_MODE)
        assertFalse(BuildConfig.DEMO_MODE)
        assertTrue("This test requires a disposable Android emulator", Build.HARDWARE in setOf("ranchu", "goldfish"))
        assertEquals("https://printly-native-test.vercel.app", BuildConfig.SITE_ORIGIN)
        assertEquals("rahfmpsdbwbktlobntkm.supabase.co", BuildConfig.SUPABASE_HOST)
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        assertNull("This test requires a network-disabled emulator", connectivity.activeNetwork)
        assertTrue("This test requires fresh push preferences", context.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE).all.isEmpty())
        assertTrue("This test requires fresh session storage", context.getSharedPreferences("native_session_v1", Context.MODE_PRIVATE).all.isEmpty())
        assertFalse("This test requires Firebase auto-init to be off", context.getSharedPreferences("com.google.firebase.messaging", Context.MODE_PRIVATE).getBoolean("auto_init", false))

        val options = FirebaseApp.getInstance().options
        assertEquals("printly-notifications-qa", options.projectId)
        assertEquals("170293293872", options.gcmSenderId)
        assertEquals("1:170293293872:android:face589a3744a9aa5acef5", options.applicationId)
        assertTrue(NativePush.available)
        assertFalse(FirebaseMessaging.getInstance().isAutoInitEnabled)
        assertFalse(context.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE).getBoolean("enabled", false))
    }
}
