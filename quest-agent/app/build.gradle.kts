plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}


// Build-time setup defaults, read from the files the café PC already maintains so a
// freshly installed headset needs no typing. Blank when a file is absent; Gradle
// re-generates BuildConfig whenever one of these values changes.
val repoRoot = rootProject.projectDir.parentFile

fun envValue(key: String): String {
    val file = File(repoRoot, ".env")
    if (!file.isFile) return ""
    return file.readLines()
        .map(String::trim)
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .associate { it.substringBefore("=").trim() to it.substringAfter("=").trim() }[key]
        ?: ""
}

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
        versionCode = 2
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "DEFAULT_SERVER_HOST", javaString(envValue("CAFE_PC_LAN_HOST").ifBlank { "192.168.1.50" }))
        buildConfigField("int", "DEFAULT_SERVER_PORT", (envValue("PORT").toIntOrNull() ?: 3000).toString())
        buildConfigField("String", "DEFAULT_ENROLLMENT_KEY", javaString(envValue("DEVICE_ENROLLMENT_KEY")))
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
