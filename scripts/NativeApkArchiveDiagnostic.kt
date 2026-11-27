package io.github.dawartariq.printly.owner.nativeapp

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Offline diagnostic on a disposable emulator; contains no production sessions. */
@RunWith(AndroidJUnit4::class)
class NativeApkArchiveDiagnostic {
    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): List<ByteArray> = if (Build.VERSION.SDK_INT >= 28)
        info.signingInfo?.apkContentsSigners?.map { it.toByteArray() } ?: emptyList()
    else info.signatures?.map { it.toByteArray() } ?: emptyList()

    @Test fun verifyReviewedArchivesLikeInstalledUpdater() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        fun archive(asset: String): PackageInfo {
            val file = java.io.File(context.cacheDir, asset)
            inst.context.assets.open(asset).use { input -> file.outputStream().use { input.copyTo(it) } }
            return context.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
                ?: throw AssertionError("Cannot parse archive $asset on API ${Build.VERSION.SDK_INT}")
        }
        val new = archive("new.apk")
        val expected = "c31f2f7283f5f32904185a2efde6b97ce89745c7292a330b828b525825ff001f"
        fun check(info: PackageInfo, name: String, code: Long, version: String) {
            assertEquals("$name package", "io.github.dawartariq.printly.owner", info.packageName)
            assertEquals("$name version name", version, info.versionName)
            @Suppress("DEPRECATION") val actual = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
            assertEquals("$name version code", code, actual)
            val signers = signatures(info)
            assertEquals("$name archive signer count on API ${Build.VERSION.SDK_INT}", 1, signers.size)
            val digest = MessageDigest.getInstance("SHA-256").digest(signers.single()).joinToString("") { "%02x".format(it) }
            assertEquals("$name signer fingerprint", expected, digest)
        }
        check(new, "new", 7L, "2.1.2")
    }
}
