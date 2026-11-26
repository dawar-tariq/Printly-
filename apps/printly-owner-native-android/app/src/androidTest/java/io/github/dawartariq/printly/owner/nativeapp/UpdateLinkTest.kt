package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Update checks open the native review flow; they do not install anything. */
@RunWith(AndroidJUnit4::class)
class UpdateLinkTest {
    @get:Rule val compose = createComposeRule()

    @Test fun liveAppOpensTheNativeUpdateReview() {
        var opened = 0
        compose.setContent { PrintlyTheme { MoreScreen(restricted = false, isDemo = false, onOpen = {}, onSignOut = {}, onCheckUpdates = { opened++ }) } }
        compose.onNodeWithText("Check for app updates").performScrollTo().performClick()
        assertEquals(1, opened)
    }

    @Test fun demoDoesNotOfferLiveUpdates() {
        compose.setContent { PrintlyTheme { MoreScreen(restricted = false, isDemo = true, onOpen = {}, onSignOut = {}, onCheckUpdates = {}) } }
        compose.onNodeWithText("Check for app updates").assertDoesNotExist()
    }
}
