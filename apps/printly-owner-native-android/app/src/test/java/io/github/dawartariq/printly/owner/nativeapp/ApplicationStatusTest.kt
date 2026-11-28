package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ApplicationStatusTest {
    private fun response() = JSONObject().put("application", JSONObject()
        .put("shop_id", "11111111-1111-4111-8111-111111111111")
        .put("status", "pending").put("shop_status", "paused")
        .put("review_note", "").put("can_access_dashboard", false))

    @Test fun pendingDoesNotGrantDashboardAccess() {
        val result = parseApplicationStatus(response())!!
        assertEquals("pending", result.status)
        assertFalse(result.dashboard)
    }
    @Test fun onlyAuthoritativeApprovedValuesAreShown() {
        val result = parseApplicationStatus(response().put("application", response().getJSONObject("application")
            .put("status", "approved").put("shop_status", "active").put("can_access_dashboard", true)))!!
        assertTrue(result.dashboard)
        assertEquals("approved", result.status)
        assertNull(parseApplicationStatus(JSONObject().put("application", JSONObject.NULL)))
    }
    @Test fun malformedResponsesFailClosed() {
        val invalid = listOf(JSONObject(), response().put("application", "bad"),
            response().also { it.getJSONObject("application").put("status", "unknown") },
            response().also { it.getJSONObject("application").put("can_access_dashboard", "true") },
            response().also { it.getJSONObject("application").put("shop_id", "other") })
        invalid.forEach {
            try { parseApplicationStatus(it); fail("Expected invalid response to be rejected") }
            catch (_: AppError) { }
        }
    }
}
