package io.github.dawartariq.printly.owner.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val api: OwnerApi = if (BuildConfig.DEMO_MODE) DemoOwnerApi() else LiveOwnerApi(applicationContext)
        setContent { PrintlyTheme { PrintlyApp(api) } }
    }
}
