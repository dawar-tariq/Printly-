package io.github.dawartariq.printly.owner.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val Orange = Color(0xFFE95416)
val OrangeDark = Color(0xFFB73508)
val Ink = Color(0xFF281C17)
val Muted = Color(0xFF77675F)
val Cream = Color(0xFFFFF8F1)
val PaleOrange = Color(0xFFFFEAD9)
val Border = Color(0xFFF0E3D9)
val Green = Color(0xFF20764F)
val PaleGreen = Color(0xFFE4F5EA)
val Red = Color(0xFFB12C23)

private val colors = lightColorScheme(
    primary = Orange, onPrimary = Color.White, secondary = OrangeDark,
    background = Cream, onBackground = Ink, surface = Color.White, onSurface = Ink,
    surfaceVariant = PaleOrange, onSurfaceVariant = Muted, outline = Border,
    error = Red,
)

@Composable fun PrintlyTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = Typography(), content = content)
}

@Composable fun SurfaceCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier = modifier, shape = RoundedCornerShape(22.dp), color = Color.White, tonalElevation = 0.dp, shadowElevation = 1.dp) {
        Column(Modifier.padding(18.dp), content = content)
    }
}

@Composable fun Heading(title: String, subtitle: String? = null) {
    Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, color = Ink)
    if (subtitle != null) {
        Spacer(Modifier.height(5.dp))
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Muted, lineHeight = 20.sp)
    }
}

@Composable fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), modifier, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold, color = OrangeDark, letterSpacing = 1.1.sp)
}

@Composable fun StatusPill(text: String, positive: Boolean = true) {
    Surface(shape = RoundedCornerShape(50), color = if (positive) PaleGreen else PaleOrange) {
        Text(text, Modifier.padding(horizontal = 10.dp, vertical = 5.dp), fontSize = 11.sp,
            fontWeight = FontWeight.Bold, color = if (positive) Green else OrangeDark)
    }
}

@Composable fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = Color(0xFFFFE9E6)) {
        Text(message, Modifier.padding(13.dp), color = Red, style = MaterialTheme.typography.bodySmall, lineHeight = 19.sp)
    }
}

@Composable fun InfoBanner(message: String, modifier: Modifier = Modifier) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = PaleOrange) {
        Text(message, Modifier.padding(13.dp), color = Ink, style = MaterialTheme.typography.bodySmall, lineHeight = 19.sp)
    }
}

@Composable fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 50.dp), shape = RoundedCornerShape(15.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Orange, contentColor = Color.White)) {
        Text(text, fontWeight = FontWeight.Bold)
    }
}

@Composable fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(15.dp)) {
        Text(text, fontWeight = FontWeight.Bold, color = if (enabled) Ink else Muted)
    }
}

@Composable fun LoadingPanel(label: String = "Loading…") {
    Column(Modifier.fillMaxWidth().padding(vertical = 52.dp), verticalArrangement = Arrangement.Center) {
        CircularProgressIndicator(Modifier.size(26.dp), color = Orange, strokeWidth = 3.dp)
        Spacer(Modifier.height(12.dp))
        Text(label, color = Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

fun safeError(error: Throwable): String = when (error) {
    is AppError -> error.message
    else -> "Something went wrong. Please refresh and try again."
}
