package io.github.dawartariq.printly.owner.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import org.json.JSONObject

private enum class Phase { STARTING, INTRO, LOGIN, WORKSPACE }
enum class Screen { HOME, ORDERS, INVENTORY, REPORTS, MORE, DETAIL, PROFILE, RATES, SUBSCRIPTION, RECOVERY, QR }

@Composable fun PrintlyApp(api: OwnerApi) {
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("native_preferences", 0) }
    var phase by remember { mutableStateOf(Phase.STARTING) }
    var hadSession by remember { mutableStateOf(false) }
    var loginNotice by remember { mutableStateOf("") }
    val workspaceApi = remember(api) {
        ExpiryHandlingApi(api) {
            if (phase == Phase.WORKSPACE) {
                hadSession = false
                loginNotice = "Your session expired. Please sign in again."
                phase = Phase.LOGIN
            }
        }
    }
    LaunchedEffect(api) {
        hadSession = try { api.restore() } catch (_: Exception) { false }
        phase = if (!preferences.getBoolean("onboarding_done", false)) Phase.INTRO else if (hadSession) Phase.WORKSPACE else Phase.LOGIN
    }
    Surface(Modifier.fillMaxSize(), color = Cream) {
        when (phase) {
            Phase.STARTING -> StartingScreen()
            Phase.INTRO -> IntroScreen {
                preferences.edit().putBoolean("onboarding_done", true).apply()
                phase = if (hadSession) Phase.WORKSPACE else Phase.LOGIN
            }
            Phase.LOGIN -> LoginScreen(api, loginNotice) { loginNotice = ""; phase = Phase.WORKSPACE }
            Phase.WORKSPACE -> Workspace(workspaceApi) { confirmed ->
                hadSession = false
                loginNotice = if (confirmed) "Signed out on this device." else "Signed out locally, but server sign-out could not be confirmed. Keep this device private."
                phase = Phase.LOGIN
            }
        }
    }
}

/** Shown only while secure local session restoration is actually in progress. */
@Composable private fun StartingScreen() {
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Image(painterResource(R.drawable.owner_icon), contentDescription = null, modifier = Modifier.size(104.dp))
        Spacer(Modifier.height(16.dp))
        Text("printly", fontSize = 30.sp, fontWeight = FontWeight.Black, letterSpacing = (-1).sp, color = Ink)
        Text("FOR SHOPS", fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, color = OrangeDark)
        Spacer(Modifier.height(25.dp))
        CircularProgressIndicator(Modifier.size(24.dp), color = Orange, strokeWidth = 3.dp)
        Spacer(Modifier.height(12.dp))
        Text("Getting your shop ready…", color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun IntroScreen(finish: () -> Unit) {
    var step by remember { mutableIntStateOf(0) }
    val image = listOf(R.drawable.onboarding_qr, R.drawable.onboarding_printer, R.drawable.onboarding_growth)[step]
    val title = listOf("Get orders from anyone, anywhere.", "Manage everything in one place.", "Grow your print shop.")[step]
    val body = listOf(
        "Customers scan your QR, upload their files and choose their options. You stay in control.",
        "Follow orders, manage your inventory and keep your shop moving, right from your phone.",
        "See useful reports, share your shop and spend more time doing what you do best.",
    )[step]
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp, vertical = 12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            BrandWordmark()
            TextButton(onClick = finish) { Text("Skip", color = Muted, fontWeight = FontWeight.Bold) }
        }
        Column(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Image(painterResource(image), contentDescription = null, modifier = Modifier.fillMaxWidth(0.9f).aspectRatio(1f))
            Spacer(Modifier.height(18.dp))
            SectionLabel(listOf("YOUR SHOP, CONNECTED", "LESS COUNTER CLUTTER", "MADE FOR YOUR BUSINESS")[step])
            Spacer(Modifier.height(12.dp))
            Text(title, textAlign = TextAlign.Center, fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.Black, color = Ink)
            Spacer(Modifier.height(12.dp))
            Text(body, textAlign = TextAlign.Center, color = Muted, lineHeight = 22.sp, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                repeat(3) { index -> Box(Modifier.size(width = if (index == step) 24.dp else 8.dp, height = 8.dp).background(if (index == step) Orange else Color(0xFFF3C7A8), RoundedCornerShape(20.dp))) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (step > 0) SecondaryButton("Back", { step-- })
            PrimaryButton(if (step == 2) "Get started" else "Next", { if (step == 2) finish() else step++ }, Modifier.weight(1f))
        }
        Text("Built for the shops behind every good print.", Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 8.dp), textAlign = TextAlign.Center, color = Muted, fontSize = 11.sp)
    }
}

@Composable fun BrandWordmark() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.owner_icon), contentDescription = null, modifier = Modifier.size(34.dp))
        Spacer(Modifier.width(8.dp))
        Text("printly", fontSize = 23.sp, fontWeight = FontWeight.Black, letterSpacing = (-1).sp, color = Ink)
        Spacer(Modifier.width(5.dp))
        Text("FOR SHOPS", fontSize = 9.sp, color = OrangeDark, fontWeight = FontWeight.ExtraBold, letterSpacing = .7.sp)
    }
}

@Composable private fun LoginScreen(api: OwnerApi, notice: String, onSignedIn: () -> Unit) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center) {
        BrandWordmark()
        Spacer(Modifier.height(32.dp))
        Heading(if (api.isDemo) "Explore the native app" else "Welcome back.",
            if (api.isDemo) "This build uses sample data only and cannot change your real shop." else "Sign in to manage your shop from your phone.")
        Spacer(Modifier.height(22.dp))
        SurfaceCard(Modifier.fillMaxWidth()) {
            if (api.isDemo) {
                InfoBanner("DEMO MODE · No real account, orders, inventory or payments are used.")
            } else {
                OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            }
            if (notice.isNotBlank()) { Spacer(Modifier.height(14.dp)); InfoBanner(notice) }
            if (error.isNotBlank()) { Spacer(Modifier.height(14.dp)); ErrorBanner(error) }
            Spacer(Modifier.height(18.dp))
            PrimaryButton(if (busy) "Please wait…" else if (api.isDemo) "Open sample shop" else "Sign in", {
                if (!busy) scope.launch {
                    busy = true; error = ""
                    try { api.signIn(email, password); password = ""; onSignedIn() }
                    catch (e: Exception) { password = ""; error = safeError(e) }
                    finally { busy = false }
                }
            }, Modifier.fillMaxWidth(), enabled = !busy && (api.isDemo || (email.isNotBlank() && password.isNotBlank())))
        }
        Spacer(Modifier.height(18.dp))
        Text("Your session is stored securely on this device. Sign out on shared phones.", color = Muted, style = MaterialTheme.typography.bodySmall, lineHeight = 19.sp)
    }
}

@Composable private fun Workspace(api: OwnerApi, onSignedOut: (Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    var screen by remember { mutableStateOf(Screen.HOME) }
    var detailId by remember { mutableStateOf("") }
    var detailParent by remember { mutableStateOf(Screen.ORDERS) }
    var me by remember { mutableStateOf<JSONObject?>(null) }
    // Persist freshness across navigation: an uncertain settings write must not
    // become editable again merely by leaving and reopening the screen.
    var meFresh by remember { mutableStateOf(false) }
    var subscription by remember { mutableStateOf<JSONObject?>(null) }
    var accessLoading by remember { mutableStateOf(true) }
    var accessError by remember { mutableStateOf("") }
    var restricted by remember { mutableStateOf(false) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var experience by remember(api) { mutableStateOf(OwnerExperience()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // These are presentation settings only. Keep the last safe values if the
    // server is unavailable; never change access/payment rules from this feed.
    LaunchedEffect(api, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                try { api.experience()?.let { experience = it } }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* Defaults and board polling remain available. */ }
                delay(5 * 60_000L)
            }
        }
    }

    suspend fun loadAccess() = supervisorScope {
        accessLoading = true; accessError = ""; meFresh = false
        // Both are independent authoritative reads; overlap their network wait
        // without allowing failure of either to grant workspace access.
        val billingRequest = async { api.request("GET", "subscription") }
        val meRequest = async { api.request("GET", "me") }
        try {
            val billing = billingRequest.await()
            subscription = billing
            try {
                val fresh = meRequest.await()
                if (fresh.optJSONObject("shop") == null || fresh.optJSONArray("services") == null || fresh.opt("is_owner") !is Boolean) {
                    throw AppError("invalid_response", "Could not verify the complete shop settings.")
                }
                me = fresh; meFresh = true; restricted = false
            }
            catch (e: AppError) {
                if (e.httpStatus == 403) { me = null; restricted = true; screen = Screen.RECOVERY }
                else throw e
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            if (e !is AppError || e.httpStatus != 401) accessError = safeError(e)
        } finally { billingRequest.cancel(); meRequest.cancel(); accessLoading = false }
    }
    LaunchedEffect(api, refreshKey) { loadAccess() }
    val main = setOf(Screen.HOME, Screen.ORDERS, Screen.INVENTORY, Screen.REPORTS, Screen.MORE)
    BackHandler(enabled = screen !in main && !accessLoading) {
        screen = if (screen == Screen.DETAIL) detailParent else if (restricted) Screen.RECOVERY else Screen.MORE
    }
    val title = when (screen) {
        Screen.HOME -> "Home"; Screen.ORDERS -> "Orders"; Screen.INVENTORY -> "Inventory"; Screen.REPORTS -> "Reports"
        Screen.MORE -> "More"; Screen.DETAIL -> "Order details"; Screen.PROFILE -> "Shop settings"; Screen.RATES -> "Rate card"
        Screen.SUBSCRIPTION -> "Subscription"; Screen.RECOVERY -> "Open orders"; Screen.QR -> "Your shop QR"
    }
    Scaffold(
        containerColor = Cream,
        topBar = {
            Column(Modifier.statusBarsPadding().fillMaxWidth()) {
                if (api.isDemo) Box(Modifier.fillMaxWidth().background(OrangeDark).padding(vertical = 5.dp), contentAlignment = Alignment.Center) {
                    Text("DEMO · SAMPLE DATA ONLY", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
                }
                Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (screen !in main) {
                        IconButton(onClick = { screen = if (screen == Screen.DETAIL) detailParent else if (restricted) Screen.RECOVERY else Screen.MORE }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Ink)
                        }
                        Text(title, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = Ink)
                    } else BrandWordmark()
                }
            }
        },
        bottomBar = {
            if (!accessLoading && accessError.isBlank()) {
                val destinations = if (restricted) listOf(Screen.RECOVERY, Screen.SUBSCRIPTION, Screen.MORE)
                    else listOf(Screen.HOME, Screen.ORDERS, Screen.INVENTORY, Screen.REPORTS, Screen.MORE)
                NavigationBar(containerColor = Color.White, contentColor = Ink, tonalElevation = 0.dp) {
                    destinations.forEach { tab ->
                        val icon = when (tab) {
                            Screen.HOME -> Icons.Default.Home; Screen.ORDERS -> Icons.Default.ReceiptLong
                            Screen.INVENTORY -> Icons.Default.Inventory2; Screen.REPORTS -> Icons.Default.BarChart
                            Screen.RECOVERY -> Icons.Default.Assignment; Screen.SUBSCRIPTION -> Icons.Default.CreditCard
                            else -> Icons.Default.MoreHoriz
                        }
                        val label = when (tab) {
                            Screen.HOME -> "Home"; Screen.ORDERS -> "Orders"; Screen.INVENTORY -> "Stock"
                            Screen.REPORTS -> "Reports"; Screen.RECOVERY -> "Open orders"; Screen.SUBSCRIPTION -> "Plan"; else -> "More"
                        }
                        NavigationBarItem(selected = screen == tab, onClick = { screen = tab }, icon = { Icon(icon, contentDescription = null) }, label = { Text(label, fontSize = 10.sp) },
                            colors = NavigationBarItemDefaults.colors(selectedIconColor = OrangeDark, selectedTextColor = OrangeDark, indicatorColor = PaleOrange))
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                accessLoading -> Column(Modifier.padding(24.dp)) { LoadingPanel("Checking your shop access…") }
                accessError.isNotBlank() -> Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Heading("Can’t open your shop", "Your account or shop access could not be checked.")
                    ErrorBanner(accessError)
                    PrimaryButton("Try again", { refreshKey++ }, Modifier.fillMaxWidth())
                    SecondaryButton("Sign out", { scope.launch { onSignedOut(api.signOut()) } }, Modifier.fillMaxWidth())
                }
                else -> when (screen) {
                    Screen.HOME -> HomeScreen(api, me, meFresh, experience, { screen = it }, { meFresh = false }, { refreshKey++ })
                    Screen.ORDERS -> OrdersScreen(api, me?.optJSONObject("shop")?.optString("id", "") ?: "", experience.boardRefreshSeconds,
                        onOpen = { detailId = it; detailParent = Screen.ORDERS; screen = Screen.DETAIL })
                    Screen.INVENTORY -> InventoryScreen(api)
                    Screen.REPORTS -> ReportsScreen(api)
                    Screen.MORE -> MoreScreen(restricted, onOpen = { screen = it }, onSignOut = { scope.launch { onSignedOut(api.signOut()) } })
                    Screen.DETAIL -> OrderDetailScreen(api, detailId, onBack = { screen = detailParent })
                    Screen.PROFILE -> ProfileScreen(api, me, meFresh,
                        onInvalidated = { meFresh = false }, onSaved = { updated -> me = updated; meFresh = true },
                        onRefreshAccess = { refreshKey++ })
                    Screen.RATES -> RatesScreen(api)
                    Screen.SUBSCRIPTION -> SubscriptionScreen(api, subscription, onUpdated = { updated -> subscription = updated }, onRecheckAccess = { refreshKey++ })
                    Screen.RECOVERY -> RecoveryScreen(api, onOpen = { detailId = it; detailParent = Screen.RECOVERY; screen = Screen.DETAIL })
                    Screen.QR -> QrScreen(api, me)
                }
            }
        }
    }
}
