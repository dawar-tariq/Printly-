package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun OrdersScreen(api: OwnerApi, onOpen: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var currentLane by remember { mutableStateOf("queued") }
    var searchInput by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var pages by remember { mutableStateOf(lanes.associateWith { 1 }) }
    var snapshot by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var sequence by remember { mutableIntStateOf(0) }
    suspend fun load() {
        val requestSequence = ++sequence
        try {
            val response = api.request("POST", "board", JSONObject().put("pages", JSONObject(pages)).put("search", search))
            val laneData = response.optJSONObject("lanes") ?: throw AppError("invalid_response", "Could not load the complete order board.")
            if (lanes.any { laneData.optJSONObject(it)?.optJSONArray("orders") == null || laneData.optJSONObject(it)?.optJSONObject("pagination") == null }) {
                throw AppError("invalid_response", "Could not load the complete order board.")
            }
            if (requestSequence == sequence) { snapshot = response; error = "" }
        } catch (e: Exception) { if (requestSequence == sequence) error = safeError(e) }
        finally { if (requestSequence == sequence) loading = false }
    }
    LaunchedEffect(api, pages, search) {
        loading = snapshot == null
        load()
        while (isActive) { delay(15_000); load() }
    }
    DisposableEffect(Unit) { onDispose { sequence++ } }
    val lane = snapshot?.optJSONObject("lanes")?.optJSONObject(currentLane)
    val orders = lane?.array("orders") ?: emptyList()
    val pagination = lane?.optJSONObject("pagination")
    val page = pagination?.optInt("page", 1) ?: 1
    val totalPages = pagination?.optInt("pages", 1) ?: 1
    Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) { Heading("Order board", "The latest work for your shop.") }
            IconButton(onClick = { scope.launch { load() } }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh orders", tint = Orange) }
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            OutlinedTextField(searchInput, { searchInput = it }, label = { Text("Search name, phone or token") }, singleLine = true, modifier = Modifier.weight(1f),
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) }, shape = RoundedCornerShape(15.dp))
            SecondaryButton("Search", { search = searchInput.trim(); pages = lanes.associateWith { 1 } })
        }
        Spacer(Modifier.height(12.dp))
        ScrollableTabRow(selectedTabIndex = lanes.indexOf(currentLane), edgePadding = 0.dp, containerColor = Cream, contentColor = OrangeDark,
            divider = {}) {
            lanes.forEach { value ->
                val count = snapshot?.optJSONObject("lanes")?.optJSONObject(value)?.optJSONObject("pagination")?.optInt("count")
                Tab(selected = currentLane == value, onClick = { currentLane = value }, text = { Text("${laneTitle(value)}${count?.let { " ($it)" } ?: ""}", fontSize = 12.sp, fontWeight = FontWeight.Bold) })
            }
        }
        Spacer(Modifier.height(10.dp))
        if (error.isNotBlank()) { ErrorBanner(if (snapshot != null) "$error The last board may be out of date." else error); Spacer(Modifier.height(8.dp)) }
        if (loading && snapshot == null) LoadingPanel("Loading orders…")
        else if (orders.isEmpty()) {
            SurfaceCard(Modifier.fillMaxWidth()) { Text("Nothing here right now.", color = Muted, style = MaterialTheme.typography.bodyMedium) }
        } else {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
                items(orders, key = { it.text("id") }) { order -> OrderCard(order) { val id = order.text("id"); if (isUuid(id)) onOpen(id) } }
            }
        }
        if (totalPages > 1) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(enabled = page > 1, onClick = { pages = pages + (currentLane to (page - 1)) }) { Text("Previous") }
                Text("Page $page of $totalPages", style = MaterialTheme.typography.bodySmall, color = Muted)
                TextButton(enabled = page < totalPages, onClick = { pages = pages + (currentLane to (page + 1)) }) { Text("Next") }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable fun OrderCard(order: JSONObject, open: () -> Unit) {
    SurfaceCard(Modifier.fillMaxWidth().clickable(onClick = open)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(order.text("token").ifBlank { "Payment review" }, fontWeight = FontWeight.Black, fontSize = 16.sp, color = Ink)
                    if (order.optBoolean("rush", false)) StatusPill("RUSH", positive = false)
                }
                Spacer(Modifier.height(4.dp))
                Text(order.text("customer_name", "Customer").ifBlank { "Customer" }, color = Ink, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(5.dp))
                Text("${laneTitle(order.text("status"))} · ${order.text("payment_method", "payment").uppercase()}", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(money(order.optLong("total_paise", 0)), fontWeight = FontWeight.ExtraBold, color = Ink)
                Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Orange)
            }
        }
    }
}

@Composable fun RecoveryScreen(api: OwnerApi, onOpen: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var page by remember { mutableIntStateOf(1) }
    var lookup by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    suspend fun load() {
        loading = true
        try { data = api.request("GET", "recovery?page=$page"); error = "" }
        catch (e: Exception) { error = safeError(e) }
        finally { loading = false }
    }
    LaunchedEffect(api, page) { load() }
    val orders = data?.array("orders") ?: emptyList()
    val pages = data?.optJSONObject("pagination")?.optInt("pages", 1) ?: 1
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Heading("Open orders", "Existing work stays accessible, even when a subscription expires.") }
        item {
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Find an order", fontWeight = FontWeight.ExtraBold)
                Text("Paste an order ID or a Printly tracking link.", style = MaterialTheme.typography.bodySmall, color = Muted)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(lookup, { lookup = it }, label = { Text("Order ID or tracking link") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(10.dp))
                SecondaryButton("Open order", {
                    val id = lookup.trim().substringBefore('?').trimEnd('/').substringAfterLast('/')
                    if (isUuid(id)) { error = ""; onOpen(id) } else error = "Enter a valid order ID or tracking link."
                }, Modifier.fillMaxWidth())
            }
        }
        if (error.isNotBlank()) item { ErrorBanner(error) }
        if (loading && data == null) item { LoadingPanel() }
        if (!loading && orders.isEmpty()) item { SurfaceCard(Modifier.fillMaxWidth()) { Text("No open orders found.", color = Muted) } }
        items(orders, key = { it.text("id") }) { order -> OrderCard(order) { val id = order.text("id"); if (isUuid(id)) onOpen(id) } }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                TextButton(enabled = page > 1, onClick = { page-- }) { Text("Previous") }
                Text("Page $page of $pages", color = Muted, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = page < pages, onClick = { page++ }) { Text("Next") }
            }
            TextButton(onClick = { scope.launch { load() } }) { Text("Refresh") }
        }
    }
}
