package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONObject

internal data class ApplicationStatus(val shopId: String, val status: String, val shopStatus: String, val note: String, val dashboard: Boolean)

/** Only server responses can decide status and access; local preferences merely
 * remember whether a congratulations message has already been shown. */
internal fun parseApplicationStatus(response: JSONObject): ApplicationStatus? {
    if (!response.has("application")) throw AppError("application_status", "Could not check application status.")
    if (response.isNull("application")) return null
    val value = response.optJSONObject("application") ?: throw AppError("application_status", "Could not check application status.")
    val id = value.optString("shop_id", "")
    val status = value.optString("status", "")
    val shopStatus = value.optString("shop_status", "")
    if (!isUuid(id) || status !in setOf("pending", "approved", "rejected", "changes_requested") ||
        shopStatus !in setOf("active", "paused", "suspended") || value.opt("can_access_dashboard") !is Boolean || value.opt("review_note") !is String) {
        throw AppError("application_status", "Could not check application status.")
    }
    return ApplicationStatus(id, status, shopStatus, value.optString("review_note", ""), value.getBoolean("can_access_dashboard"))
}

@Composable internal fun ApplicationStatusDialog(application: ApplicationStatus, error: String, checking: Boolean, onRefresh: () -> Unit, onContinue: () -> Unit, onSignOut: () -> Unit) {
    val approved = application.status == "approved"
    val title = when (application.status) {
        "pending" -> "Your application is under review"
        "approved" -> "Congratulations, your shop is verified!"
        "changes_requested" -> "More information is needed"
        else -> "Application not approved"
    }
    AlertDialog(onDismissRequest = {}, title = { Text(title, fontWeight = FontWeight.ExtraBold) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("✓  Application received", color = Green)
            Text(if (approved) "✓  Under review" else "●  Under review", color = OrangeDark)
            Text(if (approved) "✓  Verified" else "○  Verified", color = if (approved) Green else Muted)
            Text(when (application.status) {
                "pending" -> "Our team is reviewing your shop details. We'll check for updates while this screen is open."
                "approved" -> if (application.shopStatus != "active") "Verification is complete, but your shop is not active. Contact support before taking orders."
                    else if (!application.dashboard) "Verification is complete. An active subscription is still required before taking orders."
                    else "Your shop is verified. Continue to your dashboard to manage your shop."
                "changes_requested" -> application.note.ifBlank { "Please contact support for the details needed to continue your review." }
                else -> application.note.ifBlank { "Please contact support if you have questions about the decision." }
            })
            if (error.isNotBlank()) Text(error, color = Red)
        }
    }, confirmButton = {
        if (approved) TextButton(onClick = onContinue) { Text(if (application.dashboard) "Continue to dashboard" else "Continue") }
        else TextButton(enabled = !checking, onClick = onRefresh) { Text(if (checking) "Checking…" else "Check status") }
    }, dismissButton = {
        Row {
            if (!approved) TextButton(onClick = onContinue) { Text("Continue to shop") }
            TextButton(onClick = onSignOut) { Text("Sign out") }
        }
    })
}
