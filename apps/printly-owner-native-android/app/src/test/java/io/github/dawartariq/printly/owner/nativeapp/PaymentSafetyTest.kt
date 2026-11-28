package io.github.dawartariq.printly.owner.nativeapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentSafetyTest {
    @Test fun externalPaymentIsDisabledForDemoAndIsolatedQa() {
        assertFalse(externalPaymentAllowed(isDemo = true, isIsolatedTest = false))
        assertFalse(externalPaymentAllowed(isDemo = false, isIsolatedTest = true))
        assertFalse(externalPaymentAllowed(isDemo = true, isIsolatedTest = true))
        assertTrue(externalPaymentAllowed(isDemo = false, isIsolatedTest = false))
    }
}
