package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Live invalidations plus foreground-only polling and an immediate resume refresh. */
@OptIn(FlowPreview::class)
@Composable
fun BoardRefreshEffect(api: OwnerApi, shopId: String, intervalSeconds: Int, queryKey: Any = Unit, refresh: suspend () -> Unit) {
    val owner = LocalLifecycleOwner.current
    val currentRefresh by rememberUpdatedState(refresh)
    LaunchedEffect(api, owner, shopId, intervalSeconds, queryKey) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            coroutineScope {
                if (isUuid(shopId)) launch {
                    try { api.orderUpdates(shopId).debounce(350).collect { currentRefresh() } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Polling is independent of Realtime. */ }
                }
                currentRefresh()
                while (isActive) { delay(intervalSeconds.coerceIn(10, 60) * 1_000L); currentRefresh() }
            }
        }
    }
}
