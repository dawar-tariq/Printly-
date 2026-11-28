package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

@Composable fun ReportsScreen(api: OwnerApi) {
    var range by remember { mutableStateOf("week") }
    var refresh by remember { mutableIntStateOf(0) }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(api, range, refresh) {
        loading = true; data = null; error = ""
        try {
            val result = api.request("GET", "reports?range=$range")
            val values = listOf("orders_count", "paid_orders_count", "revenue_paise", "avg_order_paise")
            if (values.any { !result.has(it) || result.isNull(it) || result.optLong(it, -1) < 0 } || result.optJSONObject("service_counts") == null || result.optJSONArray("series") == null) {
                throw AppError("invalid_response", "Could not verify this report. Please refresh.")
            }
            data = result
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = safeError(e) }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Heading("Your reports", "A clearer view of your shop.") }
            IconButton(onClick = { refresh++ }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh reports", tint = Orange) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("day" to "Today", "week" to "7 days", "month" to "30 days").forEach { (value, label) ->
                FilterChip(selected = range == value, onClick = { range = value }, label = { Text(label) }, modifier = Modifier.weight(1f))
            }
        }
        if (error.isNotBlank()) {
            ErrorBanner(error)
            SecondaryButton("Try again", { refresh++ }, Modifier.fillMaxWidth())
        }
        if (loading) LoadingPanel("Loading your report…")
        data?.let { report ->
            SurfaceCard(Modifier.fillMaxWidth()) {
                SectionLabel("PAID ORDERS")
                Spacer(Modifier.height(7.dp))
                Text(money(report.getLong("revenue_paise")), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black, color = Ink)
                Text("Revenue for orders created in this period", color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(14.dp)); HorizontalDivider(color = Border); Spacer(Modifier.height(10.dp))
                ReportRow("Orders created", report.getLong("orders_count").toString())
                ReportRow("Paid orders", report.getLong("paid_orders_count").toString())
                ReportRow("Average paid order", money(report.getLong("avg_order_paise")))
            }
            InfoBanner("Revenue includes orders marked confirmed or cash collected. It is grouped by order creation date (India time), not payment date; refunds are not deducted. This is not an accounting ledger.")
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Daily breakdown", fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(8.dp))
                report.array("series").forEach { day ->
                    ReportRow(day.text("day", "—"), "${day.optInt("orders", 0)} orders · ${money(day.optLong("revenue_paise", 0))}")
                }
            }
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Services", fontWeight = FontWeight.ExtraBold)
                Text("Number of order items by service", color = Muted, style = MaterialTheme.typography.bodySmall)
                val services = report.optJSONObject("service_counts") ?: JSONObject()
                val keys = services.keys().asSequence().toList().sortedByDescending { services.optInt(it, 0) }
                if (keys.isEmpty()) { Spacer(Modifier.height(8.dp)); Text("No items in this period.", color = Muted) }
                keys.forEach { service -> ReportRow(service.replaceFirstChar { it.uppercase() }, services.optInt(service, 0).toString()) }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable private fun ReportRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.width(12.dp))
        Text(value, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
    }
}
