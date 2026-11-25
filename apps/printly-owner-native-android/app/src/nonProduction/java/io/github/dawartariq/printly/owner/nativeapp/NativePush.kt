package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import androidx.compose.runtime.Composable

/** Demo and isolated QA have no production Firebase identity or push sender. */
internal object NativePush {
    val available = false
    fun sessionExpired(context: Context) = Unit
    suspend fun beforeSignOut(context: Context, api: OwnerApi): Boolean = true
    suspend fun refresh(context: Context, api: OwnerApi, shopId: String?) = Unit
    @Composable fun Settings(api: OwnerApi, shopId: String?) = Unit
}
