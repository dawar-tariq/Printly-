package io.github.dawartariq.printly.owner.nativeapp

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

@Composable fun OrderDetailScreen(api: OwnerApi, id: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var copiedId by remember(id) { mutableStateOf(false) }
    var detail by remember(id) { mutableStateOf<JSONObject?>(null) }
    var loading by remember(id) { mutableStateOf(true) }
    var fresh by remember(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var action by remember { mutableStateOf("") }
    var utr by remember { mutableStateOf("") }
    var transferChecked by remember { mutableStateOf(false) }
    var duplicate by remember { mutableStateOf(false) }
    suspend fun load(clearError: Boolean = true) {
        loading = true; fresh = false
        try {
            if (!isUuid(id)) throw AppError("validation", "Invalid order ID.")
            val response = api.request("GET", "orders/$id")
            if (response.optJSONObject("order") == null || response.optJSONArray("items") == null || response.optJSONArray("files") == null) {
                throw AppError("invalid_response", "Could not load the complete order. Refresh before making changes.")
            }
            detail = response; fresh = true
            if (clearError) error = ""
        } catch (e: Exception) { error = safeError(e) }
        finally { loading = false }
    }
    LaunchedEffect(api, id) { load() }
    val order = detail?.optJSONObject("order")
    val status = order?.text("status") ?: ""
    val paymentStatus = order?.text("payment_status") ?: ""
    val upiDraft = status == "draft" && order?.text("payment_method") == "upi"
    val canReportPayment = upiDraft && paymentStatus in listOf("pending", "rejected")
    val canConfirmPayment = upiDraft && paymentStatus == "submitted"
    val canRejectPayment = upiDraft && paymentStatus in listOf("pending", "submitted")
    suspend fun mutation(path: String, payload: JSONObject) {
        busy = true; error = ""; notice = ""
        try {
            api.request("POST", path, payload)
            action = ""; duplicate = false; transferChecked = false
            notice = "Updated. The order has been refreshed."
            load(clearError = false)
        } catch (e: Exception) {
            if (e is AppError && e.code == "possible_duplicate") { action = ""; duplicate = true }
            else { action = ""; error = safeError(e); load(clearError = false) }
        } finally { busy = false }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) { Heading(order?.text("token")?.ifBlank { "Order details" } ?: "Order details", "Review the details before updating this order.") }
            IconButton(enabled = !busy && !loading, onClick = { scope.launch { load() } }) { Icon(Icons.Default.Refresh, "Refresh order", tint = Orange) }
        }
        if (error.isNotBlank()) ErrorBanner(error)
        if (notice.isNotBlank()) InfoBanner(notice)
        if (loading && detail == null) LoadingPanel()
        if (order != null) {
            SurfaceCard(Modifier.fillMaxWidth()) {
                SectionLabel("ORDER ID")
                Spacer(Modifier.height(5.dp))
                Text(id, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Share only with the customer or shop.", Modifier.weight(1f), color = Muted, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { clipboard.setText(AnnotatedString(id)); copiedId = true }) { Text(if (copiedId) "Copied" else "Copy ID") }
                }
            }
            SurfaceCard(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column { SectionLabel("CUSTOMER"); Spacer(Modifier.height(6.dp)); Text(order.text("customer_name", "Customer").ifBlank { "Customer" }, fontWeight = FontWeight.ExtraBold); if (order.text("customer_phone").isNotBlank()) Text(order.text("customer_phone"), color = Muted) }
                    StatusPill(laneTitle(status), positive = status != "draft")
                }
                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = Border)
                Spacer(Modifier.height(12.dp))
                DetailRow("Amount", money(order.optLong("total_paise", 0)))
                DetailRow("Payment", "${order.text("payment_method", "—").uppercase()} · ${order.text("payment_status", "—").replace('_', ' ')}")
                if (order.text("utr").isNotBlank()) DetailRow("Reference", order.text("utr"))
                if (order.text("notes").isNotBlank()) DetailRow("Notes", order.text("notes"))
            }
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Print details", fontWeight = FontWeight.ExtraBold)
                val items = detail?.array("items") ?: emptyList()
                if (items.isEmpty()) Text("No print details available.", color = Muted, style = MaterialTheme.typography.bodySmall)
                items.forEach { item ->
                    Spacer(Modifier.height(10.dp))
                    Text(item.text("service", "Service").replaceFirstChar { it.uppercase() }, fontWeight = FontWeight.Bold)
                    Text(listOfNotNull(item.text("paper_size").takeIf { it.isNotBlank() }, item.text("color").takeIf { it.isNotBlank() }, item.text("sides").takeIf { it.isNotBlank() },
                        item.optInt("copies", 0).takeIf { it > 0 }?.let { "$it copies" }, item.optInt("pages", 0).takeIf { it > 0 }?.let { "$it pages" }).joinToString(" · "), color = Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
            val files = detail?.array("files") ?: emptyList()
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Customer files", fontWeight = FontWeight.ExtraBold)
                if (files.isEmpty()) Text("No files attached.", color = Muted, style = MaterialTheme.typography.bodySmall)
                files.forEach { file ->
                    val fileId = file.text("id")
                    Row(Modifier.fillMaxWidth().clickable(enabled = !busy && isUuid(fileId)) {
                        scope.launch {
                            busy = true; error = ""
                            try { openOrderFile(context, api, id, fileId, file.text("mime")) }
                            catch (e: Exception) { error = safeError(e) }
                            finally { busy = false }
                        }
                    }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Description, null, tint = Orange)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) { Text(file.text("original_name", "File"), fontWeight = FontWeight.SemiBold); Text("Open in a compatible app", style = MaterialTheme.typography.bodySmall, color = Muted) }
                        Text("Open", color = OrangeDark, fontWeight = FontWeight.Bold)
                    }
                }
                if (files.isNotEmpty()) Text("Files are private. Only share or print them on trusted devices.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            if (canReportPayment || canConfirmPayment) {
                InfoBanner("A reported UPI payment is not proof of payment. Check your receiving account, amount and reference independently.")
            }
            if (canReportPayment) PrimaryButton("Record customer payment report", { utr = order.text("utr"); action = "report_payment" }, Modifier.fillMaxWidth(), enabled = !busy && fresh)
            if (canConfirmPayment) PrimaryButton("Review UPI transfer", { utr = order.text("utr"); transferChecked = false; action = "confirm_payment" }, Modifier.fillMaxWidth(), enabled = !busy && fresh)
            if (canRejectPayment) SecondaryButton("Reject payment report", { action = "reject_payment" }, Modifier.fillMaxWidth(), enabled = !busy && fresh)
            allowedTransitions(status).forEach { (target, label) ->
                if (target == "cancelled") SecondaryButton(label, { action = "status:$target" }, Modifier.fillMaxWidth(), enabled = !busy && fresh)
                else PrimaryButton(label, { action = "status:$target" }, Modifier.fillMaxWidth(), enabled = !busy && fresh)
            }
            Spacer(Modifier.height(18.dp))
        }
    }
    if (action == "report_payment") AlertDialog(
        onDismissRequest = { if (!busy) action = "" },
        title = { Text("Record the customer's report") },
        text = { Column {
            Text("This records the customer's claim only. It does not confirm that money was received. Verify the transfer separately afterward.")
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(utr, { utr = it.take(40) }, label = { Text("UPI reference (optional)") }, singleLine = true)
        } },
        confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
            mutation("orders/$id/confirm-payment", JSONObject().put("action", "report").put("utr", utr.trim()))
        } }) { Text("Record report") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { action = "" }) { Text("Cancel") } },
    )
    if (action == "confirm_payment") AlertDialog(
        onDismissRequest = { if (!busy) action = "" },
        title = { Text("Check the transfer") },
        text = {
            Column {
                Text("Confirm only after checking your own receiving account and matching the amount and reference.")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(utr, { utr = it.take(40) }, label = { Text("UPI reference (optional)") }, singleLine = true)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = transferChecked, onCheckedChange = { transferChecked = it })
                    Text("I independently checked the transfer.", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = { TextButton(enabled = transferChecked && !busy, onClick = { scope.launch {
            mutation("orders/$id/confirm-payment", JSONObject().put("action", "confirm").put("utr", utr.trim()).put("verification_confirmed", true))
        } }) { Text("Confirm payment") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { action = "" }) { Text("Cancel") } },
    )
    if (duplicate) AlertDialog(
        onDismissRequest = { if (!busy) duplicate = false },
        title = { Text("Possible duplicate reference") },
        text = { Text("This reference appears on another order in your shop. Check both actual transfers in your receiving account before confirming. Do not assume they are separate payments.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
            mutation("orders/$id/confirm-payment", JSONObject().put("action", "confirm").put("utr", utr.trim()).put("verification_confirmed", true).put("duplicate_acknowledged", true))
        } }) { Text("I checked both transfers") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { duplicate = false }) { Text("Go back") } },
    )
    if (action == "reject_payment") AlertDialog(
        onDismissRequest = { if (!busy) action = "" }, title = { Text("Reject this payment report?") },
        text = { Text("This does not automatically refund a transfer. Verify any payment with the customer separately.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch { mutation("orders/$id/confirm-payment", JSONObject().put("action", "reject")) } }) { Text("Reject report") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { action = "" }) { Text("Keep") } },
    )
    if (action.startsWith("status:")) {
        val target = action.substringAfter(':')
        AlertDialog(onDismissRequest = { if (!busy) action = "" }, title = { Text("Update this order?") },
            text = { Text(if (target == "cancelled") "Cancelling does not automatically refund a payment. Handle any refund separately." else if (target == "collected" && paymentStatus == "cod_pending") "Confirm the customer collected the order and you received the cash." else "Move this order to ${laneTitle(target)}?") },
            confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch { mutation("orders/$id/status", JSONObject().put("to", target)) } }) { Text("Confirm") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { action = "" }) { Text("Cancel") } })
    }
}

@Composable private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted, style = MaterialTheme.typography.bodySmall)
        Text(value, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
    }
}

private suspend fun openOrderFile(context: Context, api: OwnerApi, orderId: String, fileId: String, mime: String) {
    val extension = when (mime) {
        "application/pdf" -> "pdf"; "image/png" -> "png"; "image/jpeg" -> "jpg"; "image/webp" -> "webp"
        "application/msword" -> "doc"; "application/vnd.openxmlformats-officedocument.wordprocessingml.document" -> "docx"
        else -> throw AppError("file_type", "This file type cannot be opened safely on this device.")
    }
    val bytes = api.file("orders/$orderId/files/$fileId/download")
    val target = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        dir.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
        File(dir, "printly-${UUID.randomUUID()}.$extension").apply { writeBytes(bytes) }
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", target)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try { context.startActivity(Intent.createChooser(intent, "Open customer file")) }
    catch (_: ActivityNotFoundException) { throw AppError("no_viewer", "No compatible app was found to open this file.") }
}
