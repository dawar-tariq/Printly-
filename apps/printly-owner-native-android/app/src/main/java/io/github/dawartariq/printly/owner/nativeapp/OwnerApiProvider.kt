package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context

/** Activity and background registration share one session/refresh lock. */
internal object OwnerApiProvider {
    @Volatile private var instance: LiveOwnerApi? = null
    fun live(context: Context): LiveOwnerApi = instance ?: synchronized(this) {
        instance ?: LiveOwnerApi(context.applicationContext).also { instance = it }
    }
}
