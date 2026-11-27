package io.github.dawartariq.printly.owner.nativeapp

import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Never include exception text: it may contain a signed download URL. */
internal enum class UpdateFailureStage { CONNECT, READ, WRITE, VERIFY_IDENTITY, PREPARE }

internal fun updateFailure(error: Exception, stage: UpdateFailureStage): AppError = when {
    stage == UpdateFailureStage.VERIFY_IDENTITY -> AppError("update_identity", "Could not verify the downloaded app's identity. Do not install it. Contact Printly support.")
    stage == UpdateFailureStage.WRITE || stage == UpdateFailureStage.PREPARE -> AppError("update_storage", "Could not save the update securely. Check free storage and try again.")
    error is SSLException -> AppError("update_tls", "Could not establish a secure connection to download the update. Check your Wi-Fi and try again.")
    error is UnknownHostException -> AppError("update_network", "Could not find the update download server. Check your Wi-Fi and try again.")
    error is SocketTimeoutException -> AppError("update_timeout", "The update download timed out. Check your Wi-Fi and try again.")
    error is IOException -> AppError("update_network", "The update download was interrupted. Check your Wi-Fi and try again.")
    else -> AppError("update_download", "Could not download the update securely. Please try again.")
}
