package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val MAX_APK_BYTES = 150L * 1024L * 1024L

@Suppress("DEPRECATION")
private fun signingCertificates(info: PackageInfo): List<ByteArray> = if (Build.VERSION.SDK_INT >= 28) {
    info.signingInfo?.apkContentsSigners?.map { it.toByteArray() } ?: emptyList()
} else info.signatures?.map { it.toByteArray() } ?: emptyList()

// Android 10 can return an archive PackageInfo with no signingInfo even for a
// correctly signed APK. Re-query the archive using the platform's legacy API;
// identity still requires exactly one signer matching the installed app.
@Suppress("DEPRECATION")
internal fun archiveSigningCertificates(context: Context, file: File, archive: PackageInfo): List<ByteArray> {
    val signers = signingCertificates(archive)
    if (signers.isNotEmpty() || Build.VERSION.SDK_INT < 28) return signers
    val legacy = context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
    return legacy?.signatures?.map { it.toByteArray() } ?: emptyList()
}

@Suppress("DEPRECATION")
private fun verifyApkIdentity(context: Context, file: File, release: NativeAppRelease): Boolean {
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: return false
    val installed = try { context.packageManager.getPackageInfo(context.packageName, flags) } catch (_: Exception) { return false }
    val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
    val apkSigners = archiveSigningCertificates(context, file, archive)
    val installedSigners = signingCertificates(installed)
    return matchesUpdateApkIdentity(release, context.packageName, archive.packageName, code, archive.versionName, apkSigners, installedSigners)
}

/** User-initiated download only. Check GitHub asset bytes, package, version and
 * the installed app's signing certificate before handing it to Android. The OS
 * still verifies and asks the user to confirm installation. No silent update. */
internal suspend fun downloadVerifiedUpdate(context: Context, release: NativeAppRelease): File = withContext(Dispatchers.IO) {
    if (context.packageName != release.packageName || !validReleaseApkUrl(release.downloadUrl) ||
        updateRequirement(release, BuildConfig.VERSION_CODE) == UpdateRequirement.NONE) throw AppError("update_identity", "This update is not suitable for this app.")
    val directory = File(context.cacheDir, "updates")
    if (!directory.exists() && !directory.mkdirs()) throw AppError("update_storage", "Could not prepare private storage for the update.")
    val temp = File(directory, "${UUID.randomUUID()}.download.apk")
    val output = File(directory, "${UUID.randomUUID()}.apk")
    val client = secureHttpClient.newBuilder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build()
    var address = release.downloadUrl
    var redirects = 0
    try {
        var downloaded = false
        while (!downloaded) {
            client.newCall(Request.Builder().url(address).get().header("Accept", "application/octet-stream").build()).execute().use { response ->
                if (response.code in setOf(301, 302, 303, 307, 308)) {
                    val location = response.header("Location") ?: throw AppError("update_download", "The download destination could not be verified.")
                    if (++redirects > 3 || !validReleaseRedirect(location)) throw AppError("update_download", "The download destination could not be verified.")
                    address = location
                } else {
                    if (!response.isSuccessful) throw AppError("update_download", "Could not download the update. Please try again.")
                    val body = response.body ?: throw AppError("update_download", "The update download was empty.")
                    if (body.contentLength() > MAX_APK_BYTES) throw AppError("update_download", "The update is too large to download safely.")
                    val digest = MessageDigest.getInstance("SHA-256")
                    var total = 0L
                    body.byteStream().use { input -> temp.outputStream().use { target ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            coroutineContext.ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > MAX_APK_BYTES) throw AppError("update_download", "The update is too large to download safely.")
                            digest.update(buffer, 0, count); target.write(buffer, 0, count)
                        }
                    } }
                    if (total == 0L || !matchesVerifiedApkSha256(release.sha256, digest.digest())) throw AppError("update_hash", "The downloaded file did not match the expected SHA-256. Do not install it.")
                    if (!verifyApkIdentity(context, temp, release)) throw AppError("update_identity", "The downloaded app’s package, version or signing certificate does not match this installation. Do not install it.")
                    if (!temp.renameTo(output)) throw AppError("update_storage", "Could not prepare the verified update.")
                    downloaded = true
                }
            }
        }
        output
    } catch (cancelled: CancellationException) { output.delete(); throw cancelled }
    catch (error: AppError) { output.delete(); throw error }
    catch (_: Exception) { output.delete(); throw AppError("update_download", "Could not download the update securely. Please try again.") }
    finally { temp.delete() }
}

internal fun canInstallUpdate(context: Context): Boolean = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
internal fun openInstallPermissionSettings(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
internal fun openVerifiedInstaller(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(intent)
}
