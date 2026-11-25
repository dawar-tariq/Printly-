package io.github.dawartariq.printly.owner.nativeapp

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ComponentActivity() {
    // Permission alone never opts a shop into FCM or starts device registration.
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // The app uses a light cream header even when the device is in dark
        // mode, so status-bar icons must remain dark and legible on that header.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
        val api: OwnerApi = if (BuildConfig.DEMO_MODE) DemoOwnerApi() else OwnerApiProvider.live(applicationContext)
        setContent { PrintlyTheme { PrintlyApp(api) } }
    }

    override fun onPostResume() {
        super.onPostResume()
        if (!NativePush.available) return // The synthetic demo cannot receive push.
        val prefs = getSharedPreferences(FIRST_OPEN_PERMISSION_PREFERENCES, MODE_PRIVATE)
        val granted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        val action = firstOpenNotificationPermissionAction(
            pushAvailable = true,
            androidApi = Build.VERSION.SDK_INT,
            alreadyHandled = prefs.getBoolean(FIRST_OPEN_PERMISSION_HANDLED, false),
            permissionGranted = granted,
        )
        if (action == FirstOpenPermissionAction.SKIP) return
        // Persist before launching so activity recreation or a denial does not
        // automatically prompt on every subsequent open.
        if (!prefs.edit().putBoolean(FIRST_OPEN_PERMISSION_HANDLED, true).commit()) return
        if (action == FirstOpenPermissionAction.REQUEST && Build.VERSION.SDK_INT >= 33) {
            try {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } catch (_: RuntimeException) {
                // A failed launch was not a prompt; allow a later open to retry.
                prefs.edit().remove(FIRST_OPEN_PERMISSION_HANDLED).apply()
            }
        }
    }
}
