plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}


// Build-time setup default: CafeQuest's own Meta App ID from the café PC's
// cafequest.config.json, so a freshly installed headset needs no typing. Blank
// when the file is absent; Gradle re-generates BuildConfig when it changes. The
// server address is not baked in: the agent finds it on the Wi-Fi (Discovery.kt).
val repoRoot = rootProject.projectDir.parentFile

fun configuredMetaAppId(): String {
    val file = File(repoRoot, "cafequest.config.json")
    if (!file.isFile) return ""
    return runCatching {
        @Suppress("UNCHECKED_CAST")
        val parsed = groovy.json.JsonSlurper().parse(file) as Map<String, Any?>
        (parsed["metaAppId"] as? String)?.takeUnless { it.isBlank() || it.startsWith("FILL_") } ?: ""
    }.getOrDefault("")
}

fun javaString(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.cafequest.agent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cafequest.agent"
        minSdk = 29
        targetSdk = 34
        versionCode = 7
        versionName = "0.7.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "DEFAULT_META_APP_ID", javaString(configuredMetaAppId()))
    }

    buildTypes {
        getByName("debug") { isDebuggable = true }
        getByName("release") {
            isMinifyEnabled = false
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Prebuilt libWebRTC with org.webrtc.ScreenCapturerAndroid for Quest casting.
    implementation("io.getstream:stream-webrtc-android:1.3.9")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Meta Horizon Platform SDK (public Maven Central; needs a Dashboard App ID at runtime)
    implementation("com.meta.horizon.platform.sdk:core-kotlin:0.2.2")
    implementation("com.meta.horizon.platform.sdk:application-kotlin:0.2.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
