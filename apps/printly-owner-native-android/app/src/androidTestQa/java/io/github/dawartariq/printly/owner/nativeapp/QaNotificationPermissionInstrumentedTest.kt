package io.github.dawartariq.printly.owner.nativeapp

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.google.firebase.messaging.FirebaseMessaging
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

/** Fresh QA install on a network-disabled Android 13+ emulator. */
@RunWith(AndroidJUnit4::class)
@SdkSuppress(minSdkVersion = 33)
class QaNotificationPermissionInstrumentedTest {
    @Test fun firstOpenAsksOnceAndPermissionAloneDoesNotEnablePush() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext.applicationContext
        val device = UiDevice.getInstance(instrumentation)
        val prefs = context.getSharedPreferences(FIRST_OPEN_PERMISSION_PREFERENCES, Context.MODE_PRIVATE)
        val allow = By.res(Pattern.compile(".*:id/permission_allow_button"))
        val deny = By.res(Pattern.compile(".*:id/permission_deny_button"))

        assertEquals("io.github.dawartariq.printly.owner.native.qa", context.packageName)
        assertTrue(BuildConfig.ISOLATED_TEST_MODE)
        assertFalse(BuildConfig.DEMO_MODE)
        assertTrue("This test requires a disposable Android emulator", Build.HARDWARE in setOf("ranchu", "goldfish"))
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        assertNull("This test requires a network-disabled emulator", connectivity.activeNetwork)
        // The activity and shell permission reset below are destructive to a
        // real install. Refuse to start unless the app's private state is fresh.
        assertTrue("This test requires fresh permission preferences", prefs.all.isEmpty())
        assertTrue("This test requires fresh push preferences", context.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE).all.isEmpty())
        assertTrue("This test requires fresh session storage", context.getSharedPreferences("native_session_v1", Context.MODE_PRIVATE).all.isEmpty())
        assertFalse("This test requires Firebase auto-init to be off", context.getSharedPreferences("com.google.firebase.messaging", Context.MODE_PRIVATE).getBoolean("auto_init", false))
        assertTrue("This test requires fresh app preferences", context.getSharedPreferences("native_preferences", Context.MODE_PRIVATE).all.isEmpty())
        assertEquals(PackageManager.PERMISSION_DENIED, ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS))
        assertFalse(prefs.getBoolean(FIRST_OPEN_PERMISSION_HANDLED, false))
        fun assertPushStillOff() {
            assertFalse(context.getSharedPreferences("native_push_v1", Context.MODE_PRIVATE).getBoolean("enabled", false))
            assertFalse(FirebaseMessaging.getInstance().isAutoInitEnabled)
        }
        fun openFreshActivity() {
            val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            instrumentation.runOnMainSync { context.startActivity(intent) }
        }
        assertPushStillOff()
        openFreshActivity()
        val denyButton = device.wait(Until.findObject(deny), 12_000) ?: throw AssertionError("First-open notification permission dialog was not shown")
        denyButton.click()
        assertTrue(device.wait(Until.gone(deny), 5_000))
        assertTrue(prefs.getBoolean(FIRST_OPEN_PERMISSION_HANDLED, false))
        assertEquals(PackageManager.PERMISSION_DENIED, ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS))
        assertPushStillOff()

        // A denial must not cause another automatic dialog on a later open.
        device.pressHome()
        openFreshActivity()
        assertTrue(device.wait(Until.hasObject(By.pkg(context.packageName)), 10_000))
        assertFalse(device.wait(Until.hasObject(deny), 3_000))
        assertPushStillOff()

        // Reset only synthetic emulator permission state to simulate a fresh
        // install, then accept. OS permission must not silently enroll in FCM.
        device.pressHome()
        assertTrue(prefs.edit().remove(FIRST_OPEN_PERMISSION_HANDLED).commit())
        val command = "pm clear-permission-flags ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS} user-set user-fixed"
        val output = ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command))
            .bufferedReader().use { it.readText() }
        assertFalse(output.contains("error", ignoreCase = true))
        openFreshActivity()
        val allowButton = device.wait(Until.findObject(allow), 12_000) ?: throw AssertionError("Fresh notification permission dialog was not shown")
        allowButton.click()
        assertTrue(device.wait(Until.gone(allow), 5_000))
        assertEquals(PackageManager.PERMISSION_GRANTED, ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS))
        assertTrue(prefs.getBoolean(FIRST_OPEN_PERMISSION_HANDLED, false))
        assertPushStillOff()
    }
}
