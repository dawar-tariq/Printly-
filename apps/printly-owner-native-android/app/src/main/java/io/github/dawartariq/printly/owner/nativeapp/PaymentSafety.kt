package io.github.dawartariq.printly.owner.nativeapp

/** Demo and isolated QA builds must not open an external payment application. */
internal fun externalPaymentAllowed(isDemo: Boolean, isIsolatedTest: Boolean): Boolean = !isDemo && !isIsolatedTest
