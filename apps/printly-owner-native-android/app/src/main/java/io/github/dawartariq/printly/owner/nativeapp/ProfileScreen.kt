package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

private val serviceNames = listOf("print", "photocopy", "scan", "bind", "laminate")

@Composable fun ProfileScreen(
    api: OwnerApi, me: JSONObject?, meFresh: Boolean, onInvalidated: () -> Unit,
    onSaved: (JSONObject) -> Unit, onRefreshAccess: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val profile = me
    val shop = profile?.optJSONObject("shop")
    if (profile == null || shop == null) { Column(Modifier.padding(20.dp)) { ErrorBanner("Shop details are unavailable. Refresh your access before editing.") }; return }
    val snapshot = profile.toString()
    var name by remember(snapshot) { mutableStateOf(shop.text("name")) }
    var address by remember(snapshot) { mutableStateOf(shop.text("address")) }
    var city by remember(snapshot) { mutableStateOf(shop.text("city")) }
    var phone by remember(snapshot) { mutableStateOf(shop.text("phone")) }
    var gstin by remember(snapshot) { mutableStateOf(shop.text("gstin")) }
    var upi by remember(snapshot) { mutableStateOf(shop.text("upi_id")) }
    var eta by remember(snapshot) { mutableStateOf(shop.optInt("eta_minutes", 20).toString()) }
    var surcharge by remember(snapshot) { mutableStateOf(paiseInput(shop.optLong("rush_surcharge_bps", 0))) }
    val initialServices = remember(snapshot) { profile.array("services").associate { it.text("service") to it.optBoolean("enabled") } }
    val serviceState = remember(snapshot) { mutableStateMapOf<String, Boolean>().apply { putAll(initialServices) } }
    var claimGstin by remember(snapshot) { mutableStateOf(profile.optJSONObject("onboarding")?.text("name_proof_gstin")?.ifBlank { shop.text("gstin") } ?: shop.text("gstin")) }
    var photo by remember { mutableStateOf<ProofPhoto?>(null) }
    var claimPhoto by remember { mutableStateOf<ProofPhoto?>(null) }
    var selectingClaim by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var confirmUpi by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch {
            try {
                val selected = readProofPhoto(context, uri)
                if (selectingClaim) claimPhoto = selected else photo = selected
                error = ""
            } catch (e: Exception) { error = safeError(e) }
        }
    }
    val onboarding = profile.optJSONObject("onboarding")
    val proofRequired = onboarding?.optBoolean("duplicate_name", false) == true && shop.text("kyc_status") != "approved"
    val isOwner = profile.optBoolean("is_owner", false)
    val canEdit = meFresh && !busy

    suspend fun refreshAfterSave(message: String) {
        notice = message
        try {
            val fresh = api.request("GET", "me")
            if (fresh.optJSONObject("shop") == null || fresh.optJSONArray("services") == null || fresh.opt("is_owner") !is Boolean) {
                throw AppError("invalid_response", "Could not verify the complete shop settings.")
            }
            onSaved(fresh)
        } catch (_: Exception) { error = "Saved, but the latest shop details could not be loaded. Refresh before making another change." }
    }
    suspend fun save() {
        if (!canEdit) return
        val minutes = eta.toIntOrNull()
        val basisPoints = rupeesToPaise(surcharge)
        if (name.trim().length !in 2..80 || address.length > 200 || city.length > 80 || phone.length > 16 || gstin.length > 20 || upi.length > 80 ||
            minutes == null || minutes !in 1..1440 || basisPoints == null || basisPoints !in 0..5000) {
            error = "Check your name, contact details, ETA (1–1440 minutes) and surcharge (0–50%)."; return
        }
        val body = JSONObject()
        fun changed(key: String, value: String, nullable: Boolean = false) {
            val old = shop.text(key)
            if (value != old) body.put(key, if (nullable && value.isBlank()) JSONObject.NULL else value)
        }
        changed("name", name.trim()); changed("address", address.trim()); changed("city", city.trim()); changed("phone", phone.trim())
        changed("gstin", gstin.trim(), true); changed("upi_id", upi.trim(), true)
        if (minutes != shop.optInt("eta_minutes", 20)) body.put("eta_minutes", minutes)
        if (basisPoints != shop.optLong("rush_surcharge_bps", 0)) body.put("rush_surcharge_bps", basisPoints)
        val changes = JSONArray()
        serviceNames.forEach { service ->
            val before = initialServices[service] ?: false
            val after = serviceState[service] ?: false
            if (before != after) changes.put(JSONObject().put("service", service).put("enabled", after))
        }
        if (changes.length() > 0) body.put("services", changes)
        if (body.length() == 0 && photo == null) { notice = "No changes to save."; return }
        busy = true; error = ""; notice = ""; onInvalidated()
        try {
            val response = api.requestWithProof("PUT", "settings", body, photo)
            photo = null
            refreshAfterSave(if (response.optBoolean("duplicate_name", false)) "Name submitted for review. Your shop is paused until the proof is approved." else "Shop settings saved.")
        } catch (e: Exception) { photo = null; error = safeError(e) + " Check your current details before retrying." }
        finally { busy = false }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Heading("Shop settings", "Keep your customer-facing details up to date.")
        if (error.isNotBlank()) ErrorBanner(error)
        if (notice.isNotBlank()) InfoBanner(notice)
        if (!meFresh) {
            InfoBanner("The last settings may be out of date. Refresh and review the current values before making another change.")
            SecondaryButton("Refresh shop settings", onRefreshAccess, Modifier.fillMaxWidth(), enabled = !busy)
        }
        if (proofRequired) {
            SurfaceCard(Modifier.fillMaxWidth()) {
                Text("Duplicate-name proof", fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(6.dp))
                Text("This name matches another shop. The shop remains paused until your photo or GSTIN is reviewed.", color = Muted, style = MaterialTheme.typography.bodySmall)
                onboarding?.text("review_note")?.takeIf { it.isNotBlank() }?.let { Text("Review note: $it", color = OrangeDark, style = MaterialTheme.typography.bodySmall) }
                if (isOwner) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(claimGstin, { claimGstin = it.take(20) }, label = { Text("GSTIN (or choose a photo)") }, enabled = canEdit, singleLine = true, modifier = Modifier.fillMaxWidth())
                    TextButton(enabled = canEdit, onClick = { selectingClaim = true; picker.launch("image/*") }) { Text(if (claimPhoto == null) "Choose shop photo" else "Change selected photo") }
                    if (claimPhoto != null) Text("Photo selected · up to 3 MB", color = Green, style = MaterialTheme.typography.bodySmall)
                    SecondaryButton("Submit proof for review", {
                        scope.launch {
                            busy = true; error = ""; notice = ""; onInvalidated()
                            try {
                                api.requestWithProof("POST", "name-proof", JSONObject().put("gstin", claimGstin.trim()), claimPhoto)
                                claimPhoto = null; refreshAfterSave("Proof submitted. Your shop remains paused until reviewed.")
                            } catch (e: Exception) { claimPhoto = null; error = safeError(e) + " Check its status before retrying." }
                            finally { busy = false }
                        }
                    }, Modifier.fillMaxWidth(), enabled = canEdit && (claimGstin.isNotBlank() || claimPhoto != null))
                } else Text("Only the shop owner can submit proof.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        SurfaceCard(Modifier.fillMaxWidth()) {
            Text("Shop profile", fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(8.dp))
            ProfileField(name, { name = it.take(80) }, "Shop name", canEdit)
            ProfileField(address, { address = it.take(200) }, "Address", canEdit)
            ProfileField(city, { city = it.take(80) }, "City", canEdit)
            ProfileField(phone, { phone = it.take(16) }, "Phone", canEdit, KeyboardType.Phone)
            ProfileField(gstin, { gstin = it.take(20) }, "GSTIN (optional)", canEdit)
            ProfileField(upi, { upi = it.take(80) }, "Your UPI ID (customer payments)", canEdit)
            ProfileField(eta, { eta = it.take(4) }, "Default ETA in minutes", canEdit, KeyboardType.Number)
            ProfileField(surcharge, { surcharge = it.take(5) }, "Rush surcharge (%)", canEdit, KeyboardType.Decimal)
            Spacer(Modifier.height(8.dp))
            Text("Optional name proof", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
            Text("If the new name matches another shop, include a GSTIN or photo for review. Only choose a photo you are comfortable sharing, including any metadata.", color = Muted, style = MaterialTheme.typography.bodySmall)
            TextButton(enabled = canEdit, onClick = { selectingClaim = false; picker.launch("image/*") }) { Text(if (photo == null) "Choose shop photo" else "Change selected photo") }
            if (photo != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Photo selected", color = Green, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !busy, onClick = { photo = null }) { Text("Remove") }
            }
        }
        SurfaceCard(Modifier.fillMaxWidth()) {
            Text("Services offered", fontWeight = FontWeight.ExtraBold)
            serviceNames.forEach { service ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(service.replaceFirstChar { it.uppercase() })
                    Switch(checked = serviceState[service] ?: false, onCheckedChange = { serviceState[service] = it }, enabled = canEdit)
                }
            }
        }
        PrimaryButton(if (busy) "Saving…" else "Save settings", {
            if (upi.trim() != shop.text("upi_id")) confirmUpi = true else scope.launch { save() }
        }, Modifier.fillMaxWidth(), enabled = canEdit)
        Spacer(Modifier.height(16.dp))
    }
    if (confirmUpi) AlertDialog(onDismissRequest = { confirmUpi = false }, title = { Text("Change the receiving UPI ID?") },
        text = { Text("Customers pay your shop directly. Check this ID carefully before saving: ${upi.trim().ifBlank { "No UPI ID" }}") },
        confirmButton = { TextButton(onClick = { confirmUpi = false; scope.launch { save() } }) { Text("Save changes") } },
        dismissButton = { TextButton(onClick = { confirmUpi = false }) { Text("Go back") } })
}

@Composable private fun ProfileField(value: String, change: (String) -> Unit, label: String, enabled: Boolean, type: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(value, change, label = { Text(label) }, enabled = enabled, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = type), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
}

private suspend fun readProofPhoto(context: Context, uri: Uri): ProofPhoto = withContext(Dispatchers.IO) {
    try {
        val stream = context.contentResolver.openInputStream(uri) ?: throw AppError("photo", "Could not open the selected photo.")
        val bytes = ByteArrayOutputStream()
        stream.use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (bytes.size() + count > 3 * 1024 * 1024) throw AppError("photo", "Choose a photo up to 3 MB.")
                bytes.write(buffer, 0, count)
            }
        }
        val data = bytes.toByteArray()
        val mime = detectImageMime(data) ?: throw AppError("photo", "Choose a valid JPEG, PNG or WebP photo.")
        ProofPhoto(data, mime)
    } catch (e: AppError) { throw e }
    catch (_: Exception) { throw AppError("photo", "Could not read the selected photo.") }
}
