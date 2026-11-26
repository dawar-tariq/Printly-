package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeUpdatePolicyTest {
    private fun policy() = JSONObject().put("available", true).put("versionCode", 6).put("versionName", "2.2.0")
        .put("minimumVersionCode", 4).put("packageName", "io.github.dawartariq.printly.owner")
        .put("downloadUrl", "https://github.com/dawar-tariq/Printly-/releases/download/v2.2.0/owner.apk")
        .put("sha256", "a".repeat(64)).put("notes", "Updates and fixes").put("mandatory", false).put("releasedAt", "2026-01-01T00:00:00Z")

    @Test fun optionalAndMinimumVersionsAreComparedByCodeNotName() {
        val release = (parseNativeUpdatePolicy(policy()) as NativeUpdatePolicy.Available).release
        assertEquals(UpdateRequirement.OPTIONAL, updateRequirement(release, 5))
        assertEquals(UpdateRequirement.MANDATORY, updateRequirement(release, 3))
        assertEquals(UpdateRequirement.NONE, updateRequirement(release, 6))
        assertEquals(UpdateRequirement.NONE, updateRequirement(release, 7)) // rollback never downgrades
        assertEquals(UpdateRequirement.MANDATORY, updateRequirement(release.copy(mandatory = true), 5))
    }
    @Test fun cachedMandatoryPolicySurvivesOfflineAndMalformedResponsesButNotAnExplicitUnpublish() {
        val cached = parseNativeUpdatePolicy(policy().put("mandatory", true)) as NativeUpdatePolicy.Available
        assertEquals(UpdateRequirement.MANDATORY, updateRequirement(cached.release, 5))
        val offline = resolveNativeUpdatePolicy(cached, null)
        assertFalse(offline.accepted)
        assertEquals(cached, offline.policy)
        val malformed = resolveNativeUpdatePolicy(cached, policy().put("sha256", "bad"))
        assertFalse(malformed.accepted)
        assertEquals(cached, malformed.policy)
        val unpublished = resolveNativeUpdatePolicy(cached, JSONObject().put("available", false))
        assertTrue(unpublished.accepted)
        assertEquals(NativeUpdatePolicy.Unavailable, unpublished.policy)
        val rollback = resolveNativeUpdatePolicy(cached, policy().put("versionCode", 4).put("minimumVersionCode", 3))
        assertEquals(UpdateRequirement.NONE, updateRequirement((rollback.policy as NativeUpdatePolicy.Available).release, 5))
    }
    @Test fun releasedAtAcceptsOnlyInstantsTheAndroidParserCanRead() {
        for (date in listOf("2026-01-01T00:00:00.123456789Z", "2026-01-01T00:00:00.123457+00:00", "2026-01-01T00:00:00+18:00", "2026-01-01T00:00:00-05:30")) {
            assertTrue(parseNativeUpdatePolicy(policy().put("releasedAt", date)) is NativeUpdatePolicy.Available)
        }
        for (date in listOf("2026-01-01T00:00:00.1234567890Z", "2026-01-01T00:00:00+18:01", "2026-01-01T00:00:00-23:59")) {
            assertNull(parseNativeUpdatePolicy(policy().put("releasedAt", date)))
        }
    }
    @Test fun onlyApprovedAssetRedirectsAndCorrectHashesPass() {
        assertTrue(validReleaseRedirect("https://release-assets.githubusercontent.com/opaque?signature=abc"))
        assertTrue(validReleaseRedirect("https://objects.githubusercontent.com/opaque"))
        for (url in listOf("http://release-assets.githubusercontent.com/asset", "https://release-assets.githubusercontent.com.evil.test/asset",
            "https://user@release-assets.githubusercontent.com/asset", "https://release-assets.githubusercontent.com:444/asset",
            "https://release-assets.githubusercontent.com/asset#fragment", "https://github.com/asset")) assertFalse(validReleaseRedirect(url))
        val bytes = ByteArray(32) { it.toByte() }
        val hex = bytes.joinToString("") { "%02x".format(it) }
        assertTrue(matchesVerifiedApkSha256(hex, bytes))
        assertFalse(matchesVerifiedApkSha256("f".repeat(64), bytes))
        assertFalse(matchesVerifiedApkSha256("bad", bytes))
        assertFalse(matchesVerifiedApkSha256(hex, byteArrayOf(1)))
    }
    @Test fun archiveMustMatchPackageCodeNameAndExactlyOneInstalledSigner() {
        val release = (parseNativeUpdatePolicy(policy()) as NativeUpdatePolicy.Available).release
        val signer = byteArrayOf(1, 2, 3)
        val packageName = release.packageName
        fun check(archivePackage: String? = packageName, code: Long = 6, name: String? = "2.2.0",
            archive: List<ByteArray> = listOf(signer), installed: List<ByteArray> = listOf(signer)) =
            matchesUpdateApkIdentity(release, packageName, archivePackage, code, name, archive, installed)
        assertTrue(check())
        assertFalse(check(archivePackage = "other.package"))
        assertFalse(check(code = 5))
        assertFalse(check(name = "2.1.0"))
        assertFalse(check(archive = listOf(byteArrayOf(3, 2, 1))))
        assertFalse(check(archive = listOf(signer, signer)))
        assertFalse(check(installed = emptyList()))
    }
    @Test fun malformedAndUntrustedPoliciesAreNotAnUnpublish() {
        assertEquals(NativeUpdatePolicy.Unavailable, parseNativeUpdatePolicy(JSONObject().put("available", false)))
        assertNull(parseNativeUpdatePolicy(policy().put("downloadUrl", "https://github.com/other/repo/releases/download/v1/app.apk")))
        assertNull(parseNativeUpdatePolicy(policy().put("downloadUrl", "https://github.com/dawar-tariq/Printly-/releases/download/v1/app.apk?token=secret")))
        assertNull(parseNativeUpdatePolicy(policy().put("packageName", "io.github.dawartariq.printly.owner.native.qa")))
        assertNull(parseNativeUpdatePolicy(policy().put("minimumVersionCode", 7)))
        assertNull(parseNativeUpdatePolicy(policy().put("sha256", "x".repeat(64))))
        assertNull(parseNativeUpdatePolicy(policy().put("mandatory", "true")))
        assertNull(parseNativeUpdatePolicy(policy().put("extra", "unexpected")))
    }
}
