package io.github.dawartariq.printly.owner.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Offline regression for the actual JSON shape of the published 2.1.2 policy. */
@RunWith(AndroidJUnit4::class)
class NativeLiveUpdatePayloadInstrumentedTest {
    @Test fun productionPayloadParsesAndRequiresUpdateOnCodeSix() {
        val raw = """{"available":true,"versionCode":7,"versionName":"2.1.2","minimumVersionCode":1,"packageName":"io.github.dawartariq.printly.owner","downloadUrl":"https://github.com/dawar-tariq/Printly-/releases/download/native-v2.1.2/Printly-for-Shops-2.1.2.apk","sha256":"49df97a8e3d5e0263ad73c899e7e0f38ff9c29d5b45ffaea92bedf2662ad7181","notes":"Printly notifications now display the Printly logo.","mandatory":true,"releasedAt":"2026-11-27T11:08:00.000Z"}"""
        val json = JSONObject(raw)
        assertTrue("versionCode type: ${json.opt("versionCode")?.javaClass}", json.opt("versionCode") is Int)
        assertTrue("minimumVersionCode type: ${json.opt("minimumVersionCode")?.javaClass}", json.opt("minimumVersionCode") is Int)
        assertTrue("APK URL rejected", validReleaseApkUrl(json.getString("downloadUrl")))
        try { java.time.Instant.parse(json.getString("releasedAt")) } catch (error: Exception) { throw AssertionError("Timestamp rejected", error) }
        val policy = parseNativeUpdatePolicy(json)
        assertTrue("Production JSON must be accepted by Android", policy is NativeUpdatePolicy.Available)
        val release = (policy as NativeUpdatePolicy.Available).release
        assertEquals(UpdateRequirement.MANDATORY, updateRequirement(release, 6))
        assertEquals(UpdateRequirement.NONE, updateRequirement(release, 7))
    }
}
