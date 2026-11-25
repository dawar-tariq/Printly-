package io.github.dawartariq.printly.owner.nativeapp

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

private val terms = listOf("monthly" to "1 month", "six_months" to "6 months", "yearly" to "1 year")
private val purchaseStatuses = setOf("initiated", "submitted", "approved", "rejected", "cancelled")
private fun termLabel(term: String) = terms.firstOrNull { it.first == term }?.second ?: "Subscription"
private fun purchaseLabel(status: String) = when (status) {
    "initiated" -> "Payment not reported"; "submitted" -> "Awaiting verification"; "approved" -> "Approved"
    "rejected" -> "Not approved"; "cancelled" -> "Cancelled"; else -> "Unknown"
}
private fun validPurchase(purchase: JSONObject): Boolean {
    val amount = purchase.opt("amount_paise")
    val amountNumber = (amount as? Number)?.toDouble() ?: return false
    return isUuid(purchase.text("id")) && purchase.text("term") in terms.map { it.first } &&
        purchase.text("status") in purchaseStatuses && amountNumber.isFinite() && amountNumber % 1.0 == 0.0 && amountNumber in 0.0..100_000_000.0
}

@Composable fun SubscriptionScreen(api: OwnerApi, initial: JSONObject?, onUpdated: (JSONObject) -> Unit, onRecheckAccess: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { PendingSubscriptionStore(context) }
    var data by remember { mutableStateOf(initial) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var stale by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<PendingSubscription?>(null) }
    var selected by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var quote by remember { mutableStateOf<JSONObject?>(null) }
    var reference by remember { mutableStateOf("") }
    var dialog by remember { mutableStateOf("") }
    var cancelChecked by remember { mutableStateOf(false) }
    val shopId = data?.optJSONObject("shop")?.text("id") ?: ""

    suspend fun load(clearError: Boolean = true): Boolean {
        loading = true
        try {
            val fresh = api.request("GET", "subscription")
            val shop = fresh.optJSONObject("shop") ?: throw AppError("subscription", "Could not verify your shop.")
            val freshShopId = shop.text("id")
            val array = fresh.optJSONArray("purchases") ?: throw AppError("subscription", "Could not load complete subscription history.")
            if (!isUuid(freshShopId) || fresh.optJSONObject("plan") == null || !fresh.has("subscription") ||
                (!fresh.isNull("subscription") && fresh.optJSONObject("subscription") == null) || fresh.opt("is_owner") !is Boolean || array.length() > 50 ||
                (0 until array.length()).any { index -> array.optJSONObject(index)?.let { validPurchase(it) } != true }) {
                throw AppError("subscription", "Could not verify subscription details. Please refresh.")
            }
            val stored = store.read(freshShopId)
            val purchases = fresh.array("purchases")
            val recovered = stored != null && purchases.any { it.text("request_key") == stored.key || it.text("id") == stored.resolvedPurchaseId }
            if (stored != null && recovered) {
                store.clearResolved(freshShopId, stored.key)
                pending = null
                notice = "An earlier request was found in your history. Review its status before taking further action."
            } else pending = stored
            data = fresh; onUpdated(fresh); stale = false
            if (clearError) error = ""
            return true
        } catch (e: Exception) {
            stale = true; error = safeError(e)
            return false
        } finally { loading = false }
    }
    LaunchedEffect(api) { load() }
    val subscription = data?.optJSONObject("subscription")
    val active = subscriptionActive(subscription)
    val permanent = subscription?.optBoolean("is_permanent", false) == true
    val owner = data?.optBoolean("is_owner", false) == true
    val plan = data?.optJSONObject("plan")
    val purchases = data?.array("purchases") ?: emptyList()
    val open = purchases.firstOrNull { it.text("status") in listOf("initiated", "submitted") }
    val canChoose = owner && !permanent && open == null && !busy && !stale && pending?.resolvedPurchaseId == null

    suspend fun requestQuote(term: String) {
        val normalized = code.trim().uppercase()
        if (normalized.isNotEmpty() && !Regex("^[A-Z0-9][A-Z0-9_-]{2,31}$").matches(normalized)) {
            error = "Promo codes must contain 3–32 letters, numbers, hyphens or underscores."; return
        }
        busy = true; error = ""; notice = ""; quote = null; selected = term
        try {
            val result = api.request("POST", "subscription", JSONObject().put("action", "quote").put("term", term).put("code", normalized.ifBlank { null } ?: JSONObject.NULL))
            val proposed = result.optJSONObject("result") ?: throw AppError("quote", "Could not verify the quote.")
            if (!validQuote(proposed, term, normalized.ifBlank { null })) throw AppError("quote", "Could not verify the quote. Please refresh and try again.")
            code = normalized; quote = proposed
        } catch (e: Exception) { error = safeError(e) }
        finally { busy = false }
    }
    suspend fun start() {
        val proposed = quote ?: return
        val normalized = code.trim().uppercase().ifBlank { null }
        if (!canChoose || !isUuid(shopId) || !validQuote(proposed, selected, normalized)) { error = "Refresh and review the quote before continuing."; return }
        busy = true; error = ""; notice = ""
        try {
            val attempt = store.ensure(shopId)
            if (attempt.resolvedPurchaseId != null) throw AppError("pending_request", "Refresh your earlier request before starting another.")
            pending = attempt
            val response = api.request("POST", "subscription", JSONObject().put("action", "start").put("term", selected)
                .put("code", normalized ?: JSONObject.NULL).put("request_key", attempt.key).put("expected_quote", proposed))
            val result = response.optJSONObject("result") ?: throw AppError("subscription", "Could not confirm the request. Refresh history before retrying.")
            val purchase = result.optJSONObject("purchase") ?: throw AppError("subscription", "Could not confirm the request. Refresh history before retrying.")
            if (!validPurchase(purchase)) throw AppError("subscription", "Could not confirm the request. Refresh history before retrying.")
            pending = store.recordResolved(shopId, attempt.key, purchase.text("id"))
            quote = null; selected = ""; reference = ""
            notice = if (result.optBoolean("existing", false)) "An existing request was returned. Review its status and amount below."
                else if (purchase.optLong("amount_paise", -1) == 0L && purchase.text("status") == "approved") "The free term was approved. Check the updated period in your history."
                else "Request created. Verify the recipient and exact amount before paying."
            load(clearError = false)
        } catch (e: Exception) {
            error = safeError(e) + " Check your subscription history before retrying; this device will reuse the same request key."
            val message = error
            load(clearError = false)
            if (error.isBlank() || !stale) error = message
            quote = null
        } finally { busy = false }
    }
    suspend fun updatePurchase(action: String, purchase: JSONObject) {
        val id = purchase.text("id")
        if (!owner || !isUuid(id) || stale) { error = "Refresh the request before continuing."; return }
        val body = JSONObject().put("action", action).put("purchase_id", id)
        if (action == "submit") body.put("utr", reference.trim())
        busy = true; error = ""; notice = ""
        try {
            api.request("POST", "subscription", body)
            reference = ""
            notice = if (action == "submit") "Payment report submitted. Printly must verify it before access is activated." else "Unpaid request cancelled."
            load(clearError = false)
        } catch (e: Exception) {
            val message = safeError(e) + " Refresh the request status before taking further action."
            load(clearError = false)
            error = if (stale) "$message Could not refresh the latest status." else message
        } finally { busy = false }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Heading("Your subscription", "Manage your Printly access.") }
            IconButton(enabled = !busy, onClick = { scope.launch { load() } }) { Icon(Icons.Default.Refresh, "Refresh subscription", tint = Orange) }
        }
        if (error.isNotBlank()) ErrorBanner(error)
        if (notice.isNotBlank()) InfoBanner(notice)
        if (loading && data == null) LoadingPanel()
        if (stale && data != null) InfoBanner("Details may be out of date. Refresh before making a payment or changing a request.")
        if (api.isDemo) InfoBanner("Sample subscription only. Do not send payment to sample details.")
        if (data != null) {
            SurfaceCard(Modifier.fillMaxWidth()) {
                SectionLabel("PRINTLY ACCESS")
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (permanent) "Permanent access" else termLabel(subscription?.text("term") ?: ""), fontWeight = FontWeight.ExtraBold)
                    StatusPill(if (permanent) "PERMANENT" else if (active) "ACTIVE" else "INACTIVE", positive = active)
                }
                Spacer(Modifier.height(6.dp))
                Text(if (permanent) "No renewal required." else if (subscription?.text("expires_at")?.isNotBlank() == true) "Access ends ${subscription?.text("expires_at")}" else "No active subscription period is recorded.", color = Muted, style = MaterialTheme.typography.bodySmall)
                if (!active) Text("Open orders remain available while access is inactive.", color = OrangeDark, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRecheckAccess, enabled = !busy) { Text("Recheck shop access") }
            }
            if (!owner) InfoBanner("Only the shop owner can start a subscription or report its payment.")
            pending?.let { attempt ->
                InfoBanner(if (attempt.resolvedPurchaseId != null) "A request was returned but its history has not been confirmed. Refresh before doing anything else."
                    else "A previous request may have had an interrupted response. Check the history below before retrying; the same request key will be reused.")
            }
            open?.let { purchase ->
                SurfaceCard(Modifier.fillMaxWidth()) {
                    Text(if (purchase.text("status") == "initiated") "Complete your payment" else "Payment report submitted", fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(6.dp))
                    Text("${termLabel(purchase.text("term"))} · ${money(purchase.optLong("amount_paise", 0))}", fontWeight = FontWeight.Bold)
                    val payee = purchase.text("payee_name"); val upi = purchase.text("upi_id")
                    if (purchase.text("status") == "initiated") {
                        if (payee.isBlank() || upi.isBlank() || purchase.optLong("amount_paise", 0) <= 0) ErrorBanner("Payment details are unavailable. Do not pay; contact Printly.")
                        else {
                            Spacer(Modifier.height(7.dp)); Text("Recipient: $payee\nUPI ID: $upi", color = Ink, style = MaterialTheme.typography.bodyMedium)
                            Spacer(Modifier.height(7.dp)); InfoBanner("Already paid? Do not pay again or cancel. Submit the transaction reference, or contact Printly for help.")
                            Spacer(Modifier.height(8.dp))
                            SecondaryButton("Open UPI app", {
                                try {
                                    val uri = subscriptionUpiUri(purchase, data?.optJSONObject("shop")?.text("short_code") ?: "")
                                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW, uri), "Choose UPI app"))
                                } catch (_: ActivityNotFoundException) { error = "No UPI app was found. Use the displayed recipient and amount only after verifying them." }
                                catch (e: Exception) { error = safeError(e) }
                            }, Modifier.fillMaxWidth(), enabled = !api.isDemo && owner && !busy && !stale)
                            Spacer(Modifier.height(6.dp))
                            OutlinedTextField(reference, { reference = it.take(40) }, label = { Text("UPI reference / UTR") }, singleLine = true, enabled = owner && !busy && !stale, modifier = Modifier.fillMaxWidth())
                            Spacer(Modifier.height(8.dp))
                            PrimaryButton("Report payment", { dialog = "submit" }, Modifier.fillMaxWidth(), enabled = owner && !busy && !stale && Regex("^[A-Za-z0-9-]{6,40}$").matches(reference.trim()))
                            TextButton(enabled = owner && !busy && !stale, onClick = { cancelChecked = false; dialog = "cancel" }) { Text("Cancel unpaid request", color = Red) }
                        }
                    } else {
                        Spacer(Modifier.height(6.dp))
                        Text("Reference: ${purchase.text("utr", "—")}", color = Muted)
                        Text("Do not pay again. Printly will verify the transfer before activating the term.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (!permanent) {
                SurfaceCard(Modifier.fillMaxWidth()) {
                    Text("Choose a term", fontWeight = FontWeight.ExtraBold)
                    Text("One-time payment. No automatic recurring billing.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(code, { code = it.take(32); quote = null }, label = { Text("Promo code (optional)") }, singleLine = true, enabled = canChoose, modifier = Modifier.fillMaxWidth())
                    terms.forEach { (term, label) ->
                        val key = when (term) { "monthly" -> "monthly_paise"; "six_months" -> "six_months_paise"; else -> "yearly_paise" }
                        val price = plan?.optLong(key, -1) ?: -1
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column { Text(label, fontWeight = FontWeight.Bold); Text(if (price > 0) "Base ${money(price)}" else "Not configured", color = Muted, style = MaterialTheme.typography.bodySmall) }
                            TextButton(enabled = canChoose && price > 0, onClick = { scope.launch { requestQuote(term) } }) { Text(if (selected == term && quote != null) "Quoted" else "Get quote") }
                        }
                    }
                    if (open != null) Text("Finish or review the existing request first.", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
            quote?.let { proposed ->
                SurfaceCard(Modifier.fillMaxWidth()) {
                    Text("Review your quote", fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(6.dp))
                    SubscriptionRow("Term", termLabel(proposed.text("term")))
                    SubscriptionRow("Base price", money(proposed.getLong("base_paise")))
                    SubscriptionRow("Discount", "−${money(proposed.getLong("discount_paise"))}")
                    SubscriptionRow("Total", money(proposed.getLong("amount_paise")))
                    if (proposed.getLong("amount_paise") == 0L) InfoBanner("This eligible discounted term activates immediately if accepted. No payment is required.")
                    else Text("A payment request is created first. Access is activated only after Printly verifies your payment.", color = Muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    PrimaryButton(if (proposed.getLong("amount_paise") == 0L) "Review free activation" else "Review request", { dialog = "start" }, Modifier.fillMaxWidth(), enabled = canChoose)
                }
            }
            val announcements = data?.array("announcements") ?: emptyList()
            announcements.forEach { announcement ->
                SurfaceCard(Modifier.fillMaxWidth()) { Text(announcement.text("title"), fontWeight = FontWeight.Bold); Text(announcement.text("message"), color = Muted, style = MaterialTheme.typography.bodySmall) }
            }
            if (data?.optBoolean("offers_unavailable", false) == true) Text("Offers are temporarily unavailable.", color = Muted, style = MaterialTheme.typography.bodySmall)
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Request history", fontWeight = FontWeight.ExtraBold)
                Text("Most recent 50 requests", color = Muted, style = MaterialTheme.typography.bodySmall)
                if (purchases.isEmpty()) { Spacer(Modifier.height(8.dp)); Text("No requests yet.", color = Muted) }
                purchases.forEach { purchase ->
                    Spacer(Modifier.height(10.dp)); HorizontalDivider(color = Border); Spacer(Modifier.height(8.dp))
                    Text("${termLabel(purchase.text("term"))} · ${money(purchase.optLong("amount_paise", 0))}", fontWeight = FontWeight.Bold)
                    Text("${purchaseLabel(purchase.text("status"))} · ${purchase.text("id").take(8).uppercase()}", color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (purchase.text("review_note").isNotBlank()) Text("Printly: ${purchase.text("review_note")}", color = OrangeDark, style = MaterialTheme.typography.bodySmall)
                    if (purchase.text("period_end").isNotBlank()) Text("Period: ${purchase.text("period_start")} to ${purchase.text("period_end")}", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Spacer(Modifier.height(18.dp))
    }
    if (dialog == "start" && quote != null) {
        val proposed = quote!!
        AlertDialog(onDismissRequest = { if (!busy) dialog = "" }, title = { Text(if (proposed.getLong("amount_paise") == 0L) "Activate this free term?" else "Create this payment request?") },
            text = { Text("${termLabel(proposed.text("term"))} · ${money(proposed.getLong("amount_paise"))}. " +
                (if (pending != null) "An earlier response was uncertain; the same request key will be used and an existing request may be returned. Check history first. " else "") +
                (if (proposed.getLong("amount_paise") == 0L) "If eligible, access will be extended immediately." else "No payment is sent by this action. Verify the payee before paying.")) },
            confirmButton = { TextButton(enabled = !busy, onClick = { dialog = ""; scope.launch { start() } }) { Text("Confirm request") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { dialog = "" }) { Text("Go back") } })
    }
    if (dialog == "submit" && open != null) AlertDialog(onDismissRequest = { if (!busy) dialog = "" },
        title = { Text("Report this transfer?") }, text = { Text("Only report an actual transfer of ${money(open.optLong("amount_paise", 0))} to ${open.text("payee_name")} (${open.text("upi_id")}). Reference: ${reference.trim()}. Printly will verify it before activating access.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { dialog = ""; scope.launch { updatePurchase("submit", open) } }) { Text("Submit reference") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { dialog = "" }) { Text("Go back") } })
    if (dialog == "cancel" && open != null) AlertDialog(onDismissRequest = { if (!busy) dialog = "" }, title = { Text("Cancel unpaid request?") },
        text = { Column { Text("Cancel only if you have NOT sent payment. If you already paid, submit the reference or contact Printly instead.")
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked = cancelChecked, onCheckedChange = { cancelChecked = it }); Text("I have not sent payment.", style = MaterialTheme.typography.bodySmall) } } },
        confirmButton = { TextButton(enabled = cancelChecked && !busy, onClick = { dialog = ""; scope.launch { updatePurchase("cancel", open) } }) { Text("Cancel request", color = Red) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { dialog = "" }) { Text("Keep request") } })
}

@Composable private fun SubscriptionRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted); Text(value, fontWeight = FontWeight.Bold)
    }
}

private fun subscriptionUpiUri(purchase: JSONObject, shopCode: String): Uri {
    val upi = purchase.text("upi_id").trim()
    val payee = purchase.text("payee_name").trim()
    val amount = purchase.optLong("amount_paise", -1)
    if (!Regex("^[A-Za-z0-9_.-]{2,}@[A-Za-z][A-Za-z0-9_.-]+$").matches(upi) || payee.isBlank() || amount !in 1..100_000_000 || !isUuid(purchase.text("id"))) {
        throw AppError("payment", "Payment details could not be verified. Do not pay; contact Printly.")
    }
    return Uri.Builder().scheme("upi").authority("pay").appendQueryParameter("pa", upi)
        .appendQueryParameter("pn", payee.take(50)).appendQueryParameter("am", paiseInput(amount)).appendQueryParameter("cu", "INR")
        .appendQueryParameter("tn", "Printly $shopCode ${purchase.text("id").take(8)}".take(60)).build()
}
