package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

/** Offline synthetic demo package only; the fake API never contacts a server. */
@RunWith(AndroidJUnit4::class)
class NativeUpdateInstrumentedTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences
    private var hadPolicy = false
    private var previousPolicy: String? = null
    private var safeToRestore = false

    private fun policy() = JSONObject().put("available", true)
        .put("versionCode", BuildConfig.VERSION_CODE + 1).put("versionName", "9.9.9")
        .put("minimumVersionCode", 1).put("packageName", "io.github.dawartariq.printly.owner")
        .put("downloadUrl", "https://github.com/dawar-tariq/Printly-/releases/download/v9.9.9/owner.apk")
        .put("sha256", "a".repeat(64)).put("notes", "Synthetic release")
        .put("mandatory", true).put("releasedAt", "2026-01-01T00:00:00Z")

    @Before fun prepare() {
        context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        assertEquals("io.github.dawartariq.printly.owner.native.debug", context.packageName)
        assertTrue(BuildConfig.DEBUG)
        assertTrue(BuildConfig.DEMO_MODE)
        prefs = context.getSharedPreferences("native_update_policy_v1", Context.MODE_PRIVATE)
        hadPolicy = prefs.contains("policy")
        previousPolicy = prefs.getString("policy", null)
        safeToRestore = true
    }

    @After fun restorePreferences() {
        if (safeToRestore) {
            compose.waitForIdle()
            val edit = prefs.edit()
            if (hadPolicy) edit.putString("policy", previousPolicy) else edit.remove("policy")
            assertTrue("Could not restore synthetic test preferences", edit.commit())
        }
    }

    private enum class Reply { OFFLINE, MALFORMED, UNPUBLISHED }
    private inner class FakeApi : OwnerApi {
        override val isDemo = false // Exercise the live policy path, with no live HTTP client.
        @Volatile var reply = Reply.OFFLINE
        val checks = AtomicInteger()
        override suspend fun restore() = false
        override suspend fun signIn(email: String, password: String) { throw AssertionError("Unexpected sign-in") }
        override suspend fun signOut() = true
        override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject = throw AssertionError("Unexpected request")
        override suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject = throw AssertionError("Unexpected upload")
        override suspend fun file(path: String): ByteArray = throw AssertionError("Unexpected file access")
        override suspend fun updatePolicy(): JSONObject {
            checks.incrementAndGet()
            return when (reply) {
                Reply.OFFLINE -> throw AppError("offline", "Synthetic offline")
                Reply.MALFORMED -> policy().put("sha256", "invalid")
                Reply.UNPUBLISHED -> JSONObject().put("available", false)
            }
        }
    }

    @Test fun cachedMandatoryPolicySurvivesOfflineAndMalformedUntilExplicitUnpublish() {
        assertTrue(prefs.edit().putString("policy", policy().toString()).commit())
        val api = FakeApi()
        compose.setContent { PrintlyTheme { PrintlyApp(api) } }
        compose.waitUntil(10_000) { api.checks.get() >= 1 }
        compose.waitForIdle()
        compose.onNodeWithText("Update required").assertIsDisplayed()
        compose.onNodeWithText("Could not check app updates", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Welcome back.").assertDoesNotExist()

        api.reply = Reply.MALFORMED
        compose.onNodeWithText("Check again").performScrollTo().performClick()
        compose.waitUntil(10_000) { api.checks.get() >= 2 }
        compose.waitForIdle()
        compose.onNodeWithText("Update required").performScrollTo().assertIsDisplayed()
        assertTrue(JSONObject(prefs.getString("policy", null)!!).getBoolean("mandatory"))

        api.reply = Reply.UNPUBLISHED
        compose.onNodeWithText("Check again").performScrollTo().performClick()
        compose.waitUntil(10_000) { api.checks.get() >= 3 }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Update required").fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
        assertFalse(JSONObject(prefs.getString("policy", null)!!).getBoolean("available"))
    }

    @Test fun optionalUpdateDoesNotBlockOrShowAnAutomaticDialog() {
        assertTrue(prefs.edit().putString("policy", policy().put("mandatory", false).toString()).commit())
        val api = FakeApi()
        compose.setContent { PrintlyTheme { PrintlyApp(api) } }
        compose.waitUntil(10_000) { api.checks.get() >= 1 }
        compose.waitForIdle()
        compose.onNodeWithText("Update required").assertDoesNotExist()
        compose.onNodeWithText("An app update is available").assertDoesNotExist()
        compose.onNodeWithText("Download verified update").assertDoesNotExist()
    }

    @Test fun mandatoryScreenRequiresDownloadConfirmationAndInterceptsBack() {
        val release = (parseNativeUpdatePolicy(policy()) as NativeUpdatePolicy.Available).release
        compose.setContent { PrintlyTheme { NativeUpdateScreen(release, false, "", true, refresh = {}, close = {}) } }
        compose.onNodeWithText("Update required").assertIsDisplayed()
        compose.onNodeWithText("Back").assertDoesNotExist()
        compose.onNodeWithText("Download verified update").performScrollTo().performClick()
        compose.onNodeWithText("Download update?").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick() // Never starts network or installation.
        compose.onNodeWithText("Download update?").assertDoesNotExist()
        compose.onNodeWithText("Download verified update").performScrollTo().assertIsEnabled()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.waitForIdle()
        compose.onNodeWithText("Update required").performScrollTo().assertIsDisplayed()
    }
}
