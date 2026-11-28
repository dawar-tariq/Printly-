package io.github.dawartariq.printly.owner.nativeapp

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

@Composable fun QrScreen(api: OwnerApi, me: JSONObject?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var qr by remember { mutableStateOf<ByteArray?>(null) }
    var standee by remember { mutableStateOf<JSONObject?>(null) }
    var theme by remember { mutableStateOf("orange") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val shop = me?.optJSONObject("shop")
    val code = shop?.text("short_code") ?: ""
    val link = if (Regex("^[A-Za-z0-9]{4,16}$").matches(code)) "${BuildConfig.SITE_ORIGIN}/s/p-${code.lowercase()}" else ""
    LaunchedEffect(api) {
        try {
            val bytes = api.file("qr")
            if (detectImageMime(bytes) != "image/png") throw AppError("qr", "Could not verify the QR image.")
            qr = bytes
        } catch (e: Exception) { error = safeError(e) }
    }
    suspend fun generate() {
        busy = true; error = ""; standee = null
        try {
            val value = api.request("GET", "standee?format=preview&theme=$theme")
            if (value.text("theme") != theme || !Regex("^[0-9a-f]{64}$").matches(value.text("revision")) ||
                !value.text("preview").startsWith("data:image/png;base64,") || value.optJSONObject("info") == null) {
                throw AppError("standee", "Could not verify the standee preview.")
            }
            standee = value
        } catch (e: Exception) { error = safeError(e) }
        finally { busy = false }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        Heading("Your shop QR", "Customers can scan it to visit your shop.")
        if (error.isNotBlank()) ErrorBanner(error)
        if (shop?.text("status") != "active" || shop?.text("kyc_status") != "approved" || shop?.optBoolean("is_open", false) != true) {
            InfoBanner("Your shop may not currently accept new orders. Approval, availability and subscription requirements still apply.")
        }
        SurfaceCard(Modifier.fillMaxWidth()) {
            qr?.let { bytes ->
                val bitmap = remember(bytes) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
                if (bitmap != null) Image(bitmap.asImageBitmap(), contentDescription = "Customer shop QR code", modifier = Modifier.fillMaxWidth().sizeIn(maxHeight = 250.dp).aspectRatio(1f).align(Alignment.CenterHorizontally))
            } ?: Text(if (api.isDemo) "The sample shop does not have a real customer QR." else "Loading the shop QR…", color = Muted)
            Spacer(Modifier.height(8.dp))
            Text("Shop code: $code", fontWeight = FontWeight.ExtraBold)
            if (link.isNotBlank() && !api.isDemo) Text(link, color = OrangeDark, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            if (qr != null) SecondaryButton("Share QR image", {
                val data = qr ?: return@SecondaryButton
                scope.launch {
                    busy = true; error = ""
                    try { shareGeneratedFile(context, data, "image/png", "png", "shop-qr") }
                    catch (e: Exception) { error = safeError(e) }
                    finally { busy = false }
                }
            }, Modifier.fillMaxWidth(), enabled = !busy)
            if (link.isNotBlank() && !api.isDemo) TextButton(onClick = {
                try { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), "Share shop link")) }
                catch (_: Exception) { error = "Could not share the shop link on this device." }
            }) { Text("Share shop link") }
        }
        SurfaceCard(Modifier.fillMaxWidth()) {
            Text("A4 counter standee", fontWeight = FontWeight.ExtraBold)
            Text("Generate a preview using your saved shop details, then share the matching PDF for printing.", color = Muted, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = theme == "orange", onClick = { theme = "orange"; standee = null }, label = { Text("Orange") }, enabled = !busy)
                FilterChip(selected = theme == "deep", onClick = { theme = "deep"; standee = null }, label = { Text("Deep orange") }, enabled = !busy)
            }
            SecondaryButton(if (busy) "Please wait…" else "Generate preview", { scope.launch { generate() } }, Modifier.fillMaxWidth(), enabled = !busy)
            standee?.let { value ->
                val encoded = value.text("preview").substringAfter("data:image/png;base64,")
                val bitmap = remember(encoded) {
                    try {
                        val bytes = Base64.decode(encoded, Base64.DEFAULT)
                        if (detectImageMime(bytes) != "image/png") null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    } catch (_: Exception) { null }
                }
                if (bitmap != null) {
                    Spacer(Modifier.height(12.dp))
                    Image(bitmap.asImageBitmap(), contentDescription = "A4 standee preview", modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(10.dp))
                    PrimaryButton("Share matching PDF", {
                        scope.launch {
                            busy = true; error = ""
                            try {
                                val pdf = api.file("standee?format=pdf&theme=$theme&revision=${value.text("revision")}")
                                if (pdf.size < 5 || pdf.copyOfRange(0, 5).toString(Charsets.US_ASCII) != "%PDF-") throw AppError("standee", "Could not verify the PDF.")
                                shareGeneratedFile(context, pdf, "application/pdf", "pdf", "standee")
                            } catch (e: Exception) {
                                if (e is AppError && e.httpStatus == 409) standee = null
                                error = safeError(e)
                            } finally { busy = false }
                        }
                    }, Modifier.fillMaxWidth(), enabled = !busy)
                    Text("Print A4 at actual size, without headers or footers. Test a scan after printing.", Modifier.padding(top = 8.dp), color = Muted, style = MaterialTheme.typography.bodySmall)
                } else Text("Could not read the preview. Generate it again.", color = Red)
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

private suspend fun shareGeneratedFile(context: Context, bytes: ByteArray, mime: String, extension: String, label: String) {
    val target = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        dir.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
        File(dir, "printly-$label-${UUID.randomUUID()}.$extension").apply { writeBytes(bytes) }
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", target)
    try {
        val intent = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(intent, "Share Printly file"))
    } catch (_: Exception) { throw AppError("share", "Could not share this file on this device.") }
}
