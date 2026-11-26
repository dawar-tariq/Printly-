package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

@Composable fun HomeScreen(api: OwnerApi, me: JSONObject?, meFresh: Boolean, experience: OwnerExperience, open: (Screen) -> Unit,
    openOrder: (String) -> Unit, invalidateAccess: () -> Unit, reloadAccess: () -> Unit) {
    val scope = rememberCoroutineScope()
    var snapshot by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var sequence by remember { mutableIntStateOf(0) }
    var lastUpdated by remember { mutableStateOf<Long?>(null) }
    var recent by remember { mutableStateOf<JSONObject?>(null) }
    var recentLoading by remember { mutableStateOf(true) }
    var recentError by remember { mutableStateOf("") }
    var recentSequence by remember { mutableIntStateOf(0) }
    var recentPage by remember { mutableIntStateOf(1) }
    var lookup by remember { mutableStateOf("") }
    var lookupError by remember { mutableStateOf("") }
    var confirmAvailability by remember { mutableStateOf(false) }
    val shop = me?.optJSONObject("shop")
    val isOpen = shop?.optBoolean("is_open", false) == true
    val owner = me?.optBoolean("is_owner", false) == true
    suspend fun load() {
        val requestSequence = ++sequence
        loading = true
        try {
            val response = api.request("POST", "board", JSONObject().put("pages", JSONObject()).put("search", ""))
            val laneData = response.optJSONObject("lanes") ?: throw AppError("invalid_response", "Could not load the complete order board.")
            if (lanes.any { laneData.optJSONObject(it)?.optJSONArray("orders") == null || laneData.optJSONObject(it)?.optJSONObject("pagination") == null }) {
                throw AppError("invalid_response", "Could not load the complete order board.")
            }
            if (requestSequence == sequence) { snapshot = response; lastUpdated = System.currentTimeMillis(); error = "" }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { if (requestSequence == sequence) error = safeError(e) }
        finally { if (requestSequence == sequence) loading = false }
    }
    suspend fun loadRecent() {
        val requestSequence = ++recentSequence
        recentLoading = true
        try {
            val response = api.request("GET", "recovery?page=$recentPage")
            val pagination = response.optJSONObject("pagination")
                ?: throw AppError("invalid_response", "Could not load the complete order list.")
            if (response.optJSONArray("orders") == null || pagination.optInt("page", 0) != recentPage ||
                pagination.optInt("pages", 0) < 1 || pagination.optInt("count", -1) < 0) {
                throw AppError("invalid_response", "Could not load the complete order list.")
            }
            if (requestSequence == recentSequence) {
                val lastPage = pagination.optInt("pages")
                if (recentPage > lastPage) recentPage = lastPage
                else { recent = response; recentError = "" }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { if (requestSequence == recentSequence) recentError = safeError(e) }
        finally { if (requestSequence == recentSequence) recentLoading = false }
    }
    LaunchedEffect(api, recentPage) { recentSequence++; recent = null; recentError = ""; recentLoading = true }
    BoardRefreshEffect(api, shop?.optString("id", "") ?: "", experience.boardRefreshSeconds, recentPage) {
        // Independent reads: a failed count must not make the order list look empty.
        coroutineScope { launch { load() }; launch { loadRecent() } }
    }
    DisposableEffect(Unit) { onDispose { sequence++; recentSequence++ } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Spacer(Modifier.height(2.dp))
        Column {
            Text("YOUR SHOP, AT A GLANCE", fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, color = OrangeDark)
            Spacer(Modifier.height(7.dp))
            Text("Hello, ${shop?.text("name", "shop owner") ?: "shop owner"}.", fontSize = 27.sp, lineHeight = 32.sp, fontWeight = FontWeight.Black, color = Ink)
            Spacer(Modifier.height(4.dp))
            Text(experience.homeSubtitle ?: "Here’s what’s happening at your counter.", color = Muted, style = MaterialTheme.typography.bodyMedium)
        }
        experience.notice?.let { InfoBanner(it) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text("Your orders", fontSize = 21.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
                Text("All open orders, newest first", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = { scope.launch { coroutineScope { launch { load() }; launch { loadRecent() } } } }) {
                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Refresh")
            }
        }
        SurfaceCard(Modifier.fillMaxWidth()) {
            Text("Find any order", fontWeight = FontWeight.ExtraBold, color = Ink)
            Text("Paste the customer's full order ID or tracking link, including for completed orders.", color = Muted, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(lookup, { lookup = it.take(2048); lookupError = "" }, label = { Text("Order ID or link") },
                    singleLine = true, modifier = Modifier.weight(1f), shape = RoundedCornerShape(15.dp))
                SecondaryButton("Find", {
                    val id = orderIdFromLookup(lookup)
                    if (id == null) lookupError = "Enter the full order ID or tracking link." else { lookupError = ""; openOrder(id) }
                })
            }
            if (lookupError.isNotBlank()) Text(lookupError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        if (recentError.isNotBlank()) ErrorBanner(if (recent != null) "$recentError The list may be out of date." else recentError)
        if (recentLoading && recent == null) LoadingPanel("Loading your orders…")
        recent?.let { result ->
            val orders = result.array("orders")
            val pagination = result.optJSONObject("pagination")
            if (orders.isEmpty()) SurfaceCard(Modifier.fillMaxWidth()) { Text("No open orders right now.", color = Muted) }
            orders.forEach { order ->
                val id = order.text("id")
                OrderCard(order) { if (isUuid(id)) openOrder(id) }
            }
            val totalPages = pagination?.optInt("pages", 1) ?: 1
            if (totalPages > 1) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(enabled = recentPage > 1 && !recentLoading, onClick = { recentPage-- }) { Text("Previous") }
                Text("Page $recentPage of $totalPages", color = Muted, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = recentPage < totalPages && !recentLoading, onClick = { recentPage++ }) { Text("Next") }
            }
        }
        SurfaceCard(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    SectionLabel("SHOP AVAILABILITY")
                    Spacer(Modifier.height(8.dp))
                    Text(if (isOpen) "Open for new orders" else "Closed for new orders", fontWeight = FontWeight.ExtraBold, color = Ink)
                    Spacer(Modifier.height(4.dp))
                    Text("Approval and subscription still apply.", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = isOpen, onCheckedChange = { if (owner && !busy && meFresh) confirmAvailability = true }, enabled = owner && !busy && meFresh)
            }
            if (!owner) Text("Only the shop owner can change availability.", color = Muted, style = MaterialTheme.typography.labelSmall)
            if (!meFresh) {
                Text("This status may be out of date. Refresh before changing it.", color = Muted, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !busy, onClick = reloadAccess) { Text("Refresh shop status") }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Order snapshot", fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
            TextButton(onClick = { scope.launch { load() } }) { Icon(Icons.Default.Refresh, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Refresh") }
        }
        lastUpdated?.let { Text("Checked ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it))} · refreshes while open", color = Muted, style = MaterialTheme.typography.bodySmall) }
        if (error.isNotBlank()) ErrorBanner(if (snapshot != null) "$error The last snapshot may be out of date." else error)
        if (loading && snapshot == null) LoadingPanel("Loading your order board…")
        snapshot?.let { data ->
            val laneData = data.optJSONObject("lanes")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricCard("New", laneData?.optJSONObject("queued")?.optJSONObject("pagination")?.optInt("count")?.toString() ?: "—", Modifier.weight(1f), PaleOrange)
                MetricCard("Printing", laneData?.optJSONObject("printing")?.optJSONObject("pagination")?.optInt("count")?.toString() ?: "—", Modifier.weight(1f), Color(0xFFF5F0FF))
                MetricCard("Ready", laneData?.optJSONObject("ready")?.optJSONObject("pagination")?.optInt("count")?.toString() ?: "—", Modifier.weight(1f), PaleGreen)
            }
            val paymentCount = laneData?.optJSONObject("confirm")?.optJSONObject("pagination")?.optInt("count") ?: 0
            SurfaceCard(Modifier.fillMaxWidth().clickable { open(Screen.ORDERS) }) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text("Payment review", fontWeight = FontWeight.ExtraBold, color = Ink)
                        Text(if (paymentCount == 0) "No transfers waiting for review" else "$paymentCount transfer${if (paymentCount == 1) "" else "s"} to review", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Orange)
                }
            }
        }
        PrimaryButton("Open order board", { open(Screen.ORDERS) }, Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Shortcut("Inventory", Icons.Default.Inventory2, Modifier.weight(1f)) { open(Screen.INVENTORY) }
            Shortcut("Reports", Icons.Default.BarChart, Modifier.weight(1f)) { open(Screen.REPORTS) }
            Shortcut("Shop QR", Icons.Default.QrCode2, Modifier.weight(1f)) { open(Screen.QR) }
        }
        Spacer(Modifier.height(18.dp))
    }
    if (confirmAvailability) AlertDialog(
        onDismissRequest = { if (!busy) confirmAvailability = false },
        title = { Text(if (isOpen) "Close for new orders?" else "Open for new orders?") },
        text = { Text(if (isOpen) "Customers cannot start new orders while your shop is closed. Existing orders remain available." else "Your shop can accept new orders when approval and subscription requirements are met.") },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            scope.launch {
                busy = true; error = ""; invalidateAccess()
                try { api.request("PUT", "availability", JSONObject().put("is_open", !isOpen)); confirmAvailability = false; reloadAccess() }
                catch (e: Exception) { error = safeError(e); confirmAvailability = false }
                finally { busy = false }
            }
        }) { Text(if (isOpen) "Close shop" else "Open shop") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { confirmAvailability = false }) { Text("Cancel") } },
    )
}

@Composable private fun MetricCard(label: String, value: String, modifier: Modifier, background: Color) {
    Surface(modifier, color = background, shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text(value, fontSize = 25.sp, fontWeight = FontWeight.Black, color = Ink)
            Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Muted)
        }
    }
}

@Composable private fun Shortcut(text: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Surface(modifier.clickable(onClick = onClick), shape = RoundedCornerShape(18.dp), color = Color.White) {
        Column(Modifier.padding(vertical = 17.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, tint = Orange, modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(6.dp)); Text(text, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
    }
}

@Composable fun MoreScreen(restricted: Boolean, isDemo: Boolean, onOpen: (Screen) -> Unit, onSignOut: () -> Unit, onCheckUpdates: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Heading("Everything else", "Useful tools for your shop and account.")
        Spacer(Modifier.height(4.dp))
        if (restricted) InfoBanner("Your plan is inactive or expired. Open orders and subscription tools remain available.")
        if (!restricted) {
            MenuCard("Shop settings", "Profile, services and payments", Icons.Default.Store) { onOpen(Screen.PROFILE) }
            MenuCard("Rate card", "Your services and print prices", Icons.Default.Sell) { onOpen(Screen.RATES) }
            MenuCard("Shop QR", "View and share your customer QR", Icons.Default.QrCode2) { onOpen(Screen.QR) }
        }
        MenuCard("Subscription", "Manage your Printly access", Icons.Default.CreditCard) { onOpen(Screen.SUBSCRIPTION) }
        MenuCard("Open orders", "Recover or look up an existing order", Icons.Default.Assignment) { onOpen(Screen.RECOVERY) }
        if (NativePush.available) MenuCard("Notifications", "Manage alerts on this phone", Icons.Default.Notifications) { onOpen(Screen.NOTIFICATIONS) }
        if (!isDemo && !BuildConfig.ISOLATED_TEST_MODE) {
            MenuCard("Check for app updates", "Review and verify updates in the app", Icons.Default.SystemUpdate, onCheckUpdates)
        }
        MenuCard("Sign out", "Remove this session from the phone", Icons.AutoMirrored.Filled.Logout) { confirm = true }
        Spacer(Modifier.height(16.dp))
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Sign out?") }, text = { Text("Your local session will be removed from this device.") },
        confirmButton = { TextButton(onClick = { confirm = false; onSignOut() }) { Text("Sign out") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } })
}

@Composable private fun MenuCard(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    SurfaceCard(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).background(PaleOrange, RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Orange) }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.ExtraBold, color = Ink); Text(subtitle, color = Muted, style = MaterialTheme.typography.bodySmall) }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Muted)
        }
    }
}
