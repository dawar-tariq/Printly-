package io.github.dawartariq.printly.owner.nativeapp

import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NativeUpdateFailureTest {
    @Test fun classifiesNetworkFailuresWithoutLeakingExceptionText() {
        val secret = "sensitive-signed-url"
        val cases = listOf(
            SSLException(secret) to "update_tls",
            UnknownHostException(secret) to "update_network",
            SocketTimeoutException(secret) to "update_timeout",
            IOException(secret) to "update_network",
            IllegalStateException(secret) to "update_download",
        )
        for ((error, expected) in cases) {
            val result = updateFailure(error, UpdateFailureStage.READ)
            assertEquals(expected, result.code)
            assertFalse(result.message.contains(secret))
        }
    }

    @Test fun storageAndIdentityFailuresAreNotMisreportedAsNetwork() {
        assertEquals("update_storage", updateFailure(IOException(), UpdateFailureStage.WRITE).code)
        assertEquals("update_storage", updateFailure(IOException(), UpdateFailureStage.PREPARE).code)
        val identity = updateFailure(IllegalStateException("secret"), UpdateFailureStage.VERIFY_IDENTITY)
        assertEquals("update_identity", identity.code)
        assertFalse(identity.message.contains("secret"))
    }
}
