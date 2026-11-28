package io.github.dawartariq.printly.owner.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStoreSafetyTest {
    @Test fun clearingTriesTheKeyEvenIfPreferencesThrow() {
        var keyAttempts = 0
        val cleared = clearSessionStorage(
            removeCiphertext = { throw IllegalStateException("simulated storage error") },
            removeKey = { keyAttempts++; true },
        )
        assertTrue(cleared)
        assertEquals(1, keyAttempts)
    }

    @Test fun clearingSucceedsIfEitherProtectionWasRemoved() {
        var keyAttempts = 0
        assertTrue(clearSessionStorage({ true }, { keyAttempts++; throw IllegalStateException("simulated keystore error") }))
        assertEquals(1, keyAttempts)
        assertTrue(clearSessionStorage({ false }, { true }))
        assertFalse(clearSessionStorage({ false }, { false }))
        assertFalse(clearSessionStorage({ throw IllegalStateException() }, { throw IllegalStateException() }))
    }
}
