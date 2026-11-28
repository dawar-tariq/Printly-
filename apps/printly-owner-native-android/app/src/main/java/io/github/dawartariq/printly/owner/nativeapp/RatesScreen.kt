package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

private val rateFields = listOf("service", "paper_size", "color", "sides", "paper_gsm", "option", "unit", "price_paise")

@Composable fun RatesScreen(api: OwnerApi) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var canEdit by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    suspend fun load(clearError: Boolean = true) {
        loading = true; canEdit = false
        try {
            val result = api.request("GET", "rate-card")
            if (result.optJSONArray("rows") == null) throw AppError("invalid_response", "Could not load the complete rate card.")
            data = result; canEdit = clearError
            if (clearError) error = ""
        } catch (e: Exception) { canEdit = false; error = safeError(e) }
        finally { loading = false }
    }
    LaunchedEffect(api) { load() }
    val rows = data?.array("rows") ?: emptyList()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Heading("Rate card", "Update the price of an existing service.") }
                IconButton(enabled = !busy && !loading, onClick = { scope.launch { load() } }) { Icon(Icons.Default.Refresh, "Refresh rate card", tint = Orange) }
            }
        }
        item { InfoBanner("Changes affect future quotes. Adding or removing rates and editing their options is not available in this native build yet. Coordinate with anyone editing rates on another device.") }
        if (error.isNotBlank()) item { ErrorBanner(if (!canEdit && data != null) "$error Refresh before changing a price." else error) }
        if (notice.isNotBlank()) item { InfoBanner(notice) }
        if (loading && data == null) item { LoadingPanel() }
        if (!loading && data != null && rows.isEmpty()) item { SurfaceCard(Modifier.fillMaxWidth()) { Text("No rates found. Adding rates is not yet available in this app.", color = Muted) } }
        items(rows, key = { it.text("id") }) { row ->
            SurfaceCard(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(row.text("service", "Service").replaceFirstChar { it.uppercase() }, fontWeight = FontWeight.ExtraBold)
                        Spacer(Modifier.height(4.dp))
                        Text(rateDescription(row), color = Muted, style = MaterialTheme.typography.bodySmall)
                        Text(rateUnitDescription(row), color = OrangeDark, style = MaterialTheme.typography.labelSmall)
                    }
                    Spacer(Modifier.width(8.dp))
                    val price = row.optLong("price_paise", -1)
                    Text(if (price >= 0) money(price) else "—", fontWeight = FontWeight.ExtraBold)
                }
                TextButton(enabled = !busy && canEdit && isUuid(row.text("id")) && row.optLong("price_paise", -1) in 0..1_000_000, onClick = {
                    selected = row; input = paiseInput(row.getLong("price_paise"))
                }, modifier = Modifier.align(Alignment.End)) { Text("Edit price") }
            }
        }
        item { Spacer(Modifier.height(14.dp)) }
    }
    selected?.let { row ->
        var validation by remember(row) { mutableStateOf("") }
        AlertDialog(onDismissRequest = { if (!busy) selected = null }, title = { Text("Edit price") },
            text = {
                Column {
                    Text("${row.text("service").replaceFirstChar { it.uppercase() }} · ${rateDescription(row)}", style = MaterialTheme.typography.bodySmall)
                    Text(rateUnitDescription(row), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = OrangeDark)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(input, { input = it.take(12) }, label = { Text("Price in ₹") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    if (validation.isNotBlank()) { Spacer(Modifier.height(8.dp)); ErrorBanner(validation) }
                    Spacer(Modifier.height(8.dp))
                    Text("This changes the price for this exact rate. If the rate changed elsewhere, refresh first.", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
            },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                val price = rupeesToPaise(input)
                if (price == null) { validation = "Enter an amount from ₹0 to ₹10,000 with at most two decimal places."; return@TextButton }
                if (rateFields.any { !row.has(it) }) { validation = "Could not verify this rate. Refresh before editing."; return@TextButton }
                val expected = JSONObject()
                rateFields.forEach { key -> expected.put(key, row.opt(key) ?: JSONObject.NULL) }
                scope.launch {
                    busy = true; error = ""; notice = ""
                    try {
                        api.request("PATCH", "rate-card/${row.text("id")}", JSONObject().put("expected", expected).put("price_paise", price))
                        selected = null; notice = "Price updated."; load()
                    } catch (e: Exception) { selected = null; error = safeError(e); load(clearError = false) }
                    finally { busy = false }
                }
            }) { Text("Save price") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { selected = null }) { Text("Cancel") } },
        )
    }
}

private fun rateDescription(row: JSONObject): String = listOfNotNull(
    row.text("paper_size").takeIf { it.isNotBlank() },
    row.text("color").takeIf { it.isNotBlank() }?.let { if (it == "bw") "Black & white" else it.replaceFirstChar { c -> c.uppercase() } },
    row.text("sides").takeIf { it.isNotBlank() }?.let { if (it == "duplex") "Double-sided" else "Single-sided" },
    row.optInt("paper_gsm", 0).takeIf { it > 0 }?.let { "$it GSM" },
    row.text("option").takeIf { it.isNotBlank() },
).joinToString(" · ").ifBlank { "Default options" }

private fun rateUnitDescription(row: JSONObject): String = when (row.text("unit")) {
    "page" -> "Per printed page"
    "job" -> "Per copy / set"
    "duplex_sheet" -> "Per physical duplex sheet"
    "sheet" -> if (row.text("service") == "laminate") "Per sheet" else "Legacy sheet rate: charged per page"
    else -> "Unit: ${row.text("unit", "unknown")}"
}
