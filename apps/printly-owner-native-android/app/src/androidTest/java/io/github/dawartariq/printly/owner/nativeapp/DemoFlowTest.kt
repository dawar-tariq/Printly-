package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic-only UI smoke: the debug package never contacts the real shop. */
@RunWith(AndroidJUnit4::class)
class DemoFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun waitFor(text: String) = compose.waitUntil(15_000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    @Test fun nativeShopNavigationAndExplicitPaymentReview() {
        waitFor("Skip")
        compose.onNodeWithText("Skip").performClick()
        waitFor("Open sample shop")
        compose.onNodeWithText("Open sample shop").performClick()
        waitFor("Hello, Bright Paper Studio.")
        compose.onNodeWithText("DEMO · SAMPLE DATA ONLY").assertIsDisplayed()
        compose.onNodeWithText("Orders").performClick()
        waitFor("Payment review (1)")
        compose.onNodeWithText("Payment review (1)").performClick()
        waitFor("Neha R.")
        compose.onNodeWithText("Neha R.").performClick()
        waitFor("Review UPI transfer")
        compose.onNodeWithText("Review UPI transfer").performClick()
        compose.onNodeWithText("Confirm payment").assertIsNotEnabled()
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ToggleableState))[0].performClick()
        compose.onNodeWithText("Confirm payment").performClick()
        waitFor("Start printing")
        compose.onNodeWithText("Stock").performClick()
        waitFor("A4 paper")
        compose.onAllNodesWithText("Edit")[0].performClick()
        compose.onNodeWithText("Quantity").performTextClearance()
        compose.onNodeWithText("Quantity").performTextInput("421")
        compose.onNodeWithText("Save").performClick()
        waitFor("421 sheets")
        compose.onNodeWithText("Reports").performClick()
        waitFor("Your reports")
        compose.onNodeWithText("Paid orders").assertIsDisplayed()
        compose.onNodeWithText("More").performClick()
        waitFor("Subscription")
        compose.onNodeWithText("Subscription").performClick()
        waitFor("Permanent access")
    }
}
