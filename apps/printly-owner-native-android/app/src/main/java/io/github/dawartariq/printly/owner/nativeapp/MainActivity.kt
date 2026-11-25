package io.github.dawartariq.printly.owner.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // The app uses a light cream header even when the device is in dark
        // mode, so status-bar icons must remain dark and legible on that header.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
        val api: OwnerApi = if (BuildConfig.DEMO_MODE) DemoOwnerApi() else OwnerApiProvider.live(applicationContext)
        setContent { PrintlyTheme { PrintlyApp(api) } }
    }
}
