package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        assertEquals("https://printly-native-test.vercel.app", BuildConfig.SITE_ORIGIN)
        assertEquals("rahfmpsdbwbktlobntkm.supabase.co", BuildConfig.SUPABASE_HOST)

        val options = FirebaseApp.getInstance().options
        assertEquals("printly-notifications-qa", options.projectId)
        assertEquals("170293293872", options.gcmSenderId)
        assertEquals("1:170293293872:android:face589a3744a9aa5acef5", options.applicationId)
        assertTrue(NativePush.available)
        assertFalse(FirebaseMessaging.getInstance().isAutoInitEnabled)
        assertFalse(context.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE).getBoolean("enabled", false))
    }
}
