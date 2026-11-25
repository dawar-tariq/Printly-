package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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

@Composable fun InventoryScreen(api: OwnerApi) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    suspend fun load(clearError: Boolean = true) {
        loading = true
        try {
            val response = api.request("GET", "inventory")
            if (response.optJSONArray("items") == null) throw AppError("invalid_response", "Could not load the complete inventory.")
            data = response; if (clearError) error = ""
        } catch (e: Exception) { error = safeError(e) }
        finally { loading = false }
    }
    LaunchedEffect(api) { load() }
    val stock = data?.array("items") ?: emptyList()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Heading("Inventory", "Keep an eye on the supplies you use.") }
                IconButton(onClick = { scope.launch { load() } }) { Icon(Icons.Default.Refresh, "Refresh inventory", tint = Orange) }
            }
        }
        if (error.isNotBlank()) item { ErrorBanner(if (data != null) "$error Refresh before changing stock." else error) }
        if (notice.isNotBlank()) item { InfoBanner(notice) }
        item { PrimaryButton("Add item", { creating = true }, Modifier.fillMaxWidth(), enabled = !busy && data != null) }
        if (loading && data == null) item { LoadingPanel() }
        if (!loading && data != null && stock.isEmpty()) item { SurfaceCard(Modifier.fillMaxWidth()) { Text("No inventory items yet.", color = Muted) } }
        items(stock, key = { it.text("id") }) { item ->
            val qty = item.optDouble("qty", Double.NaN)
            val threshold = item.optDouble("low_stock_threshold", Double.NaN)
            SurfaceCard(Modifier.fillMaxWidth().clickable(enabled = !busy) { editing = item }) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text(item.text("name", "Item"), fontWeight = FontWeight.ExtraBold)
                        Text(item.text("category").replaceFirstChar { it.uppercase() }, color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("${displayNumber(qty)} ${item.text("unit")}", fontWeight = FontWeight.ExtraBold)
                        if (qty.isFinite() && threshold.isFinite() && qty <= threshold) StatusPill("LOW STOCK", positive = false)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(enabled = !busy, onClick = { editing = item }) { Text("Edit") }
                    TextButton(enabled = !busy, onClick = { deleting = item }) { Text("Remove", color = Red) }
                }
            }
        }
        item { Spacer(Modifier.height(14.dp)) }
    }
    if (creating || editing != null) InventoryDialog(item = editing, busy = busy, onDismiss = { creating = false; editing = null }, onSave = { payload ->
        scope.launch {
            busy = true; error = ""; notice = ""
            try {
                val item = editing
                if (item == null) api.request("POST", "inventory", payload)
                else api.request("PATCH", "inventory/${item.text("id")}", payload)
                creating = false; editing = null; notice = "Inventory updated."
                load()
            } catch (e: Exception) { error = safeError(e); creating = false; editing = null; load(clearError = false) }
            finally { busy = false }
        }
    })
    deleting?.let { item ->
        AlertDialog(onDismissRequest = { if (!busy) deleting = null }, title = { Text("Remove ${item.text("name")}?" ) },
            text = { Text("This removes the item from your inventory. If it changed on another device, refresh and review it first.") },
            confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
                busy = true; error = ""; notice = ""
                try {
                    val expected = expectedInventory(item) ?: throw AppError("invalid_response", "Refresh this item before removing it.")
                    api.request("DELETE", "inventory/${item.text("id")}", JSONObject().put("expected", expected))
                    notice = "Item removed."; deleting = null; load()
                } catch (e: Exception) { error = safeError(e); deleting = null; load(clearError = false) }
                finally { busy = false }
            } }) { Text("Remove", color = Red) } },
            dismissButton = { TextButton(enabled = !busy, onClick = { deleting = null }) { Text("Cancel") } })
    }
}

@Composable private fun InventoryDialog(item: JSONObject?, busy: Boolean, onDismiss: () -> Unit, onSave: (JSONObject) -> Unit) {
    val originalQty = item?.optDouble("qty", Double.NaN) ?: 0.0
    val originalThreshold = item?.optDouble("low_stock_threshold", Double.NaN) ?: 0.0
    var name by remember(item) { mutableStateOf(item?.text("name") ?: "") }
    var category by remember(item) { mutableStateOf(item?.text("category", "paper") ?: "paper") }
    var qty by remember(item) { mutableStateOf(if (item == null) "0" else displayNumber(originalQty)) }
    var unit by remember(item) { mutableStateOf(item?.text("unit") ?: "") }
    var threshold by remember(item) { mutableStateOf(if (item == null) "0" else displayNumber(originalThreshold)) }
    var menu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(if (item == null) "Add inventory" else "Edit inventory") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (error.isNotBlank()) ErrorBanner(error)
                OutlinedTextField(name, { name = it.take(80) }, label = { Text("Item name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (item == null) {
                    Box {
                        TextButton(onClick = { menu = true }) { Text("Category: ${category.replaceFirstChar { it.uppercase() }} ▾") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            listOf("paper", "ink", "binding", "laminate", "other").forEach { option ->
                                DropdownMenuItem(text = { Text(option.replaceFirstChar { it.uppercase() }) }, onClick = { category = option; menu = false })
                            }
                        }
                    }
                }
                OutlinedTextField(qty, { qty = it.take(16) }, label = { Text("Quantity") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(unit, { unit = it.take(20) }, label = { Text("Unit, e.g. sheets") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(threshold, { threshold = it.take(16) }, label = { Text("Low-stock threshold") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                if (item != null) Text("If the item changed on another device, you’ll be asked to refresh.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            val quantity = qty.toDoubleOrNull()
            val low = threshold.toDoubleOrNull()
            if (name.trim().isEmpty() || unit.trim().isEmpty() || quantity == null || low == null || !quantity.isFinite() || !low.isFinite() || quantity !in 0.0..1_000_000.0 || low !in 0.0..1_000_000.0) {
                error = "Enter a name, unit and valid quantities between 0 and 1,000,000."
            } else if (item != null && expectedInventory(item) == null) {
                error = "Refresh this item before saving."
            } else if (item == null) {
                onSave(JSONObject().put("name", name.trim()).put("category", category).put("qty", quantity).put("unit", unit.trim()).put("low_stock_threshold", low))
            } else {
                val patch = JSONObject().put("expected", expectedInventory(item))
                if (name.trim() != item.text("name")) patch.put("name", name.trim())
                if (unit.trim() != item.text("unit")) patch.put("unit", unit.trim())
                if (quantity != originalQty) patch.put("set_qty", quantity)
                if (low != originalThreshold) patch.put("low_stock_threshold", low)
                if (patch.length() == 1) onDismiss() else onSave(patch)
            }
        }) { Text("Save") } }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } })
}

private fun expectedInventory(item: JSONObject): JSONObject? {
    val qty = item.optDouble("qty", Double.NaN)
    val threshold = item.optDouble("low_stock_threshold", Double.NaN)
    if (!qty.isFinite() || !threshold.isFinite() || listOf("name", "category", "unit").any { item.isNull(it) }) return null
    return JSONObject().put("qty", qty).put("low_stock_threshold", threshold)
        .put("name", item.text("name")).put("category", item.text("category")).put("unit", item.text("unit"))
}
private fun displayNumber(value: Double): String = if (!value.isFinite()) "—" else if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()
