package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONObject

/** Navigate to sign-in on an authoritative expired-session response from any screen. */
internal class ExpiryHandlingApi(private val delegate: OwnerApi, private val expired: () -> Unit) : OwnerApi by delegate {
    private suspend fun <T> checked(block: suspend () -> T): T = try { block() } catch (error: AppError) {
        if (error.httpStatus == 401) expired()
        throw error
    }
    override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject = checked { delegate.request(method, path, body) }
    override suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject =
        checked { delegate.requestWithProof(method, path, body, photo) }
    override suspend fun file(path: String): ByteArray = checked { delegate.file(path) }
}
