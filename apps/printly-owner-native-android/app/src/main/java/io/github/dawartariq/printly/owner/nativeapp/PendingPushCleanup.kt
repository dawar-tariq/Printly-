package io.github.dawartariq.printly.owner.nativeapp

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

/** In-process, bounded bookkeeping for bindings whose server removal is not
 * confirmed yet. It deliberately stores no credentials and is not durable. */
internal class PendingPushCleanup(
    private val limit: Int = 10,
    private val signOutBudgetMillis: Long = 20_000,
) {
    private val lock = Any()
    private val pending = mutableMapOf<String, MutableSet<String>>()
    private val overflow = mutableSetOf<String>()
    private val localFailures = mutableSetOf<String>()
    private var unidentifiedFailure = false

    fun remember(sessionId: String?, binding: String?) {
        synchronized(lock) {
            if (binding.isNullOrBlank()) return@synchronized
            if (!validPushUuid(binding) || sessionId == null || !validPushUuid(sessionId)) {
                unidentifiedFailure = true
                return@synchronized
            }
            val bindings = pending.getOrPut(sessionId) { linkedSetOf() }
            if (binding in bindings || bindings.size < limit) bindings.add(binding) else overflow.add(sessionId)
        }
    }

    fun localFailure(sessionId: String?) {
        synchronized(lock) {
            if (sessionId != null && validPushUuid(sessionId)) localFailures.add(sessionId) else unidentifiedFailure = true
        }
    }

    fun acknowledge(sessionId: String?, binding: String) {
        synchronized(lock) {
            if (sessionId != null) {
                pending[sessionId]?.let { bindings ->
                    bindings.remove(binding)
                    if (bindings.isEmpty()) pending.remove(sessionId)
                }
            }
        }
    }

    suspend fun finish(sessionId: String?, stops: List<LocalPushStop>, revoke: suspend (String) -> Boolean): Boolean {
        val (remembered, previousFailure) = synchronized(lock) {
            val bindings = sessionId?.let { pending[it]?.toList() } ?: emptyList()
            val failed = unidentifiedFailure || if (sessionId == null) {
                pending.isNotEmpty() || overflow.isNotEmpty() || localFailures.isNotEmpty()
            } else sessionId in overflow || sessionId in localFailures
            bindings to failed
        }
        val bindings = (stops.mapNotNull { it.binding } + remembered).distinct()
        // The HTTP client has its own deadline; this additionally bounds the
        // whole batch. A timeout/failure is reported rather than implied safe.
        val remoteConfirmed = withTimeoutOrNull(signOutBudgetMillis) {
            var all = true
            for (binding in bindings) {
                val removed = try { revoke(binding) }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { false }
                if (removed) acknowledge(sessionId, binding) else all = false
            }
            all
        } ?: false
        // The captured session is now gone, so a later sign-in must not inherit
        // its failures. An overlapping opt-out is safe: server DELETE is
        // idempotent and scoped to the original bearer and binding.
        val finalFailure = synchronized(lock) {
            val failed = unidentifiedFailure || if (sessionId == null) {
                pending.isNotEmpty() || overflow.isNotEmpty() || localFailures.isNotEmpty()
            } else !pending[sessionId].isNullOrEmpty() || sessionId in overflow || sessionId in localFailures
            if (sessionId != null) { pending.remove(sessionId); overflow.remove(sessionId); localFailures.remove(sessionId) }
            failed
        }
        return stops.all { it.localConfirmed } && !previousFailure && !finalFailure && remoteConfirmed
    }
}
