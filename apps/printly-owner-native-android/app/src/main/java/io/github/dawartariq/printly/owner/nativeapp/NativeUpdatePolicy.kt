package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.time.Instant

data class NativeAppRelease(
    val versionCode: Int, val versionName: String, val minimumVersionCode: Int,
    val packageName: String, val downloadUrl: String, val sha256: String,
    val notes: String, val mandatory: Boolean, val releasedAt: String,
)
internal sealed class NativeUpdatePolicy {
    data object Unavailable : NativeUpdatePolicy()
    data class Available(val release: NativeAppRelease) : NativeUpdatePolicy()
}
internal enum class UpdateRequirement { NONE, OPTIONAL, MANDATORY }
internal data class NativeUpdateResolution(val policy: NativeUpdatePolicy?, val accepted: Boolean)

/** Network failure or malformed data never clears a cached mandatory policy. */
internal fun resolveNativeUpdatePolicy(previous: NativeUpdatePolicy?, payload: JSONObject?): NativeUpdateResolution {
    val parsed = payload?.let(::parseNativeUpdatePolicy) ?: return NativeUpdateResolution(previous, false)
    return NativeUpdateResolution(parsed, true)
}

/** GitHub redirects to signed release-asset URLs; never follow other hosts. */
internal fun validReleaseRedirect(value: String): Boolean = try {
    val uri = URI(value)
    uri.scheme == "https" && uri.host in setOf("release-assets.githubusercontent.com", "objects.githubusercontent.com") &&
        uri.port == -1 && uri.userInfo == null && uri.fragment == null && !uri.path.isNullOrBlank()
} catch (_: Exception) { false }

internal fun matchesVerifiedApkSha256(expected: String, actualDigest: ByteArray): Boolean {
    if (!Regex("^[a-f0-9]{64}$").matches(expected) || actualDigest.size != 32) return false
    val expectedBytes = expected.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    return MessageDigest.isEqual(actualDigest, expectedBytes)
}

/** Pure comparison used after Android has extracted the archive's metadata. */
internal fun matchesUpdateApkIdentity(
    release: NativeAppRelease, installedPackage: String, archivePackage: String?, archiveCode: Long, archiveName: String?,
    archiveSigners: List<ByteArray>, installedSigners: List<ByteArray>,
): Boolean = archivePackage == installedPackage && archivePackage == release.packageName &&
    archiveCode == release.versionCode.toLong() && archiveName == release.versionName &&
    archiveSigners.size == 1 && installedSigners.size == 1 && MessageDigest.isEqual(archiveSigners[0], installedSigners[0])

internal fun validReleaseApkUrl(value: String): Boolean {
    if (value.length > 1000 || !Regex("^https://github\\.com/dawar-tariq/Printly-/releases/download/[A-Za-z0-9][A-Za-z0-9._+\\-]{0,79}/[A-Za-z0-9][A-Za-z0-9._+\\-]{0,119}\\.apk$").matches(value)) return false
    return try { val uri = URI(value); uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.toString() == value } catch (_: Exception) { false }
}

/** Parse only the narrow non-secret policy from the fixed Printly origin.
 * A malformed response is not the same thing as an explicit unpublish. */
internal fun parseNativeUpdatePolicy(json: JSONObject): NativeUpdatePolicy? {
    val available = json.opt("available") as? Boolean ?: return null
    if (!available) return if (json.keys().asSequence().toSet() == setOf("available")) NativeUpdatePolicy.Unavailable else null
    if (json.keys().asSequence().toSet() != setOf("available", "versionCode", "versionName", "minimumVersionCode", "packageName", "downloadUrl", "sha256", "notes", "mandatory", "releasedAt")) return null
    val code = (json.opt("versionCode") as? Int)?.takeIf { it in 1..999_999_999 } ?: return null
    val min = (json.opt("minimumVersionCode") as? Int)?.takeIf { it in 1..code } ?: return null
    val name = (json.opt("versionName") as? String)?.takeIf { Regex("^[A-Za-z0-9][A-Za-z0-9._+\\-]{0,39}$").matches(it) } ?: return null
    val packageName = (json.opt("packageName") as? String)?.takeIf { it == "io.github.dawartariq.printly.owner" } ?: return null
    val url = (json.opt("downloadUrl") as? String)?.takeIf(::validReleaseApkUrl) ?: return null
    val hash = (json.opt("sha256") as? String)?.takeIf { Regex("^[a-f0-9]{64}$").matches(it) } ?: return null
    val notes = (json.opt("notes") as? String)?.takeIf { it.length <= 400 && it.none { c -> c.code in 0..8 || c.code == 11 || c.code == 12 || c.code in 14..31 || c.code == 127 } } ?: return null
    val mandatory = json.opt("mandatory") as? Boolean ?: return null
    val date = json.opt("releasedAt") as? String ?: return null
    try { Instant.parse(date) } catch (_: Exception) { return null }
    return NativeUpdatePolicy.Available(NativeAppRelease(code, name, min, packageName, url, hash, notes, mandatory, date))
}

internal fun updateRequirement(release: NativeAppRelease, installedVersion: Int): UpdateRequirement = when {
    installedVersion >= release.versionCode -> UpdateRequirement.NONE // never offer an Android downgrade
    release.mandatory || installedVersion < release.minimumVersionCode -> UpdateRequirement.MANDATORY
    else -> UpdateRequirement.OPTIONAL
}
