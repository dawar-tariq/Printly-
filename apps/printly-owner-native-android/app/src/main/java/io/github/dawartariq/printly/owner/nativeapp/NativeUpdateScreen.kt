package io.github.dawartariq.printly.owner.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.File

/** All installation steps require explicit user interaction and Android's own
 * package installer confirmation. No package is installed in the background. */
@Composable internal fun NativeUpdateScreen(
    release: NativeAppRelease?, checking: Boolean, error: String, required: Boolean,
    refresh: () -> Unit, close: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var file by remember(release?.versionCode, release?.sha256) { mutableStateOf<File?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmDownload by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    BackHandler(enabled = required) { /* A confirmed mandatory policy stays visible. */ }
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BrandWordmark()
        Spacer(Modifier.height(4.dp))
        Heading(if (required) "Update required" else "App updates", if (required) "This version needs an update before the shop workspace can open." else "Check for a verified Printly for Shops update.")
        if (checking) LoadingPanel("Checking update information…")
        if (error.isNotBlank()) ErrorBanner(if (required) "$error The last verified update requirement is still in effect." else error)
        if (localError.isNotBlank()) ErrorBanner(localError)
        if (notice.isNotBlank()) InfoBanner(notice)
        if (release == null && !checking) SurfaceCard(Modifier.fillMaxWidth()) { Text("No published update is available right now.", color = Muted) }
        release?.let { item ->
            val requirement = updateRequirement(item, BuildConfig.VERSION_CODE)
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text(if (requirement == UpdateRequirement.NONE) "You are up to date" else "Version ${item.versionName} is available", fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(6.dp))
                Text("Installed code ${BuildConfig.VERSION_CODE} · release code ${item.versionCode}", color = Muted, style = MaterialTheme.typography.bodySmall)
                if (item.notes.isNotBlank()) { Spacer(Modifier.height(12.dp)); Text("What’s new", fontWeight = FontWeight.Bold); Spacer(Modifier.height(4.dp)); Text(item.notes, color = Muted) }
                Spacer(Modifier.height(12.dp))
                Text("The APK is downloaded from Printly’s GitHub Releases. The app checks its SHA-256, package, version and signing certificate against this installation before opening Android’s installer.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            if (requirement != UpdateRequirement.NONE) {
                val ready = file?.takeIf { it.exists() }
                if (ready == null) PrimaryButton(if (busy) "Downloading and verifying…" else "Download verified update", { if (!busy) confirmDownload = true }, Modifier.fillMaxWidth(), enabled = !busy)
                else PrimaryButton("Continue to Android installer", {
                    localError = ""; notice = ""
                    try {
                        if (!canInstallUpdate(context)) {
                            openInstallPermissionSettings(context)
                            notice = "Allow installs from Printly in Android settings, return here, then tap Continue again. Android will still ask you to confirm."
                        } else openVerifiedInstaller(context, ready)
                    } catch (_: Exception) { localError = "Could not open Android’s installer. Check your phone’s installation settings and try again." }
                }, Modifier.fillMaxWidth())
                Text("Installation is never silent. You choose whether to allow this app as an installation source and confirm the update in Android.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        SecondaryButton(if (checking) "Checking…" else "Check again", refresh, Modifier.fillMaxWidth(), enabled = !checking && !busy)
        if (!required) SecondaryButton("Back", close, Modifier.fillMaxWidth(), enabled = !busy)
        Spacer(Modifier.height(16.dp))
    }
    if (confirmDownload && release != null) AlertDialog(
        onDismissRequest = { confirmDownload = false },
        title = { Text("Download update?") },
        text = { Text("Printly will download version ${release.versionName} from GitHub and verify it. You will review and confirm installation separately in Android.") },
        confirmButton = { TextButton(onClick = {
            confirmDownload = false
            scope.launch {
                busy = true; localError = ""; notice = ""
                try { file = downloadVerifiedUpdate(context, release); notice = "Download verified. Continue to Android’s installer when you are ready." }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { localError = if (error is AppError) error.message else "Could not verify the update. Please try again." }
                finally { busy = false }
            }
        }) { Text("Download") } },
        dismissButton = { TextButton(onClick = { confirmDownload = false }) { Text("Cancel") } },
    )
}
