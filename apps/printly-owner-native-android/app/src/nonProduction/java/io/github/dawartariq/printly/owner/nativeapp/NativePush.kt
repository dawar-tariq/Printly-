package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import androidx.compose.runtime.Composable

/** Demo and isolated QA have no production Firebase identity or push sender. */
internal object NativePush {
    val available = false
    fun sessionChange(context: Context, expectedSession: String? = null, change: () -> Unit): LocalPushStop {
        change()
        return LocalPushStop()
    }
    fun beginSignOut(context: Context, sessionId: String): LocalPushStop = LocalPushStop()
    suspend fun finishSignOut(sessionId: String?, stops: List<LocalPushStop>, revoke: suspend (String) -> Boolean): Boolean = stops.all { it.localConfirmed }
    suspend fun refresh(context: Context, api: OwnerApi, shopId: String?) = Unit
    @Composable fun Settings(api: OwnerApi, shopId: String?) = Unit
}
