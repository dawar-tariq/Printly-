package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A direct-install update is an explicit browser action, never a silent install. */
@RunWith(AndroidJUnit4::class)
class UpdateLinkTest {
    @get:Rule val compose = createComposeRule()

    @Test fun liveAppOpensOnlyTheFixedSignedInWebsitePage() {
        val opened = mutableListOf<String>()
        val handler = object : UriHandler { override fun openUri(uri: String) { opened.add(uri) } }
        compose.setContent {
            PrintlyTheme {
                CompositionLocalProvider(LocalUriHandler provides handler) {
                    MoreScreen(restricted = false, isDemo = false, onOpen = {}, onSignOut = {})
                }
            }
        }
        compose.onNodeWithText("Check for app updates").performScrollTo().performClick()
        assertEquals(listOf("${BuildConfig.SITE_ORIGIN}/shop/app"), opened)
    }

    @Test fun demoDoesNotOfferLiveUpdates() {
        compose.setContent { PrintlyTheme { MoreScreen(restricted = false, isDemo = true, onOpen = {}, onSignOut = {}) } }
        compose.onNodeWithText("Check for app updates").assertDoesNotExist()
    }
}
