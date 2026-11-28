package io.github.dawartariq.printly.owner.nativeapp

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingPushCleanupTest {
    private val sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    private val bindingA = "11111111-1111-4111-8111-111111111111"
    private val bindingB = "22222222-2222-4222-8222-222222222222"

    @Test fun signOutRetriesAnEarlierOptOutAndNeverUsesAnotherSessionsBindings() = runBlocking {
        val tracker = PendingPushCleanup()
        tracker.remember(sessionA, bindingA)
        tracker.remember(sessionB, bindingB)
        val attempted = mutableListOf<String>()
        assertTrue(tracker.finish(sessionA, listOf(LocalPushStop(bindingA, true, sessionA))) { attempted.add(it); true })
        assertEquals(listOf(bindingA), attempted) // current and remembered binding are deduplicated
        attempted.clear()
        assertTrue(tracker.finish(sessionB, emptyList()) { attempted.add(it); true })
        assertEquals(listOf(bindingB), attempted)
    }

    @Test fun failureOverflowAndMissingIdentityAreNotReportedAsSuccess() = runBlocking {
        val overflow = PendingPushCleanup(limit = 1)
        overflow.remember(sessionA, bindingA)
        overflow.remember(sessionA, bindingB)
        val attempted = mutableListOf<String>()
        assertFalse(overflow.finish(sessionA, emptyList()) { attempted.add(it); true })
        assertEquals(listOf(bindingA), attempted)

        val failed = PendingPushCleanup()
        failed.remember(sessionA, bindingA)
        assertFalse(failed.finish(sessionA, emptyList()) { false })
        failed.localFailure(sessionA)
        assertFalse(failed.finish(sessionA, emptyList()) { true })
        val unknown = PendingPushCleanup()
        unknown.remember(null, bindingA)
        assertFalse(unknown.finish(sessionA, emptyList()) { true })
        assertFalse(PendingPushCleanup().finish(sessionA, listOf(LocalPushStop(localConfirmed = false))) { true })
    }

    @Test fun aNewUnconfirmedRemovalDuringSignOutCannotBeLostAsSuccess() = runBlocking {
        val tracker = PendingPushCleanup()
        tracker.remember(sessionA, bindingA)
        val started = CompletableDeferred<Unit>()
        val resume = CompletableDeferred<Unit>()
        val signingOut = async {
            tracker.finish(sessionA, emptyList()) { started.complete(Unit); resume.await(); true }
        }
        started.await()
        tracker.remember(sessionA, bindingB)
        resume.complete(Unit)
        assertFalse(signingOut.await())
    }

    @Test fun signOutHasABoundedCleanupBudget() = runBlocking {
        val tracker = PendingPushCleanup(signOutBudgetMillis = 25)
        tracker.remember(sessionA, bindingA)
        assertFalse(tracker.finish(sessionA, emptyList()) { delay(1_000); true })
    }
}
