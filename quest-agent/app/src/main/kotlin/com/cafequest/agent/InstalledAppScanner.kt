package com.cafequest.agent

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log

data class InstalledAppCandidate(
    val packageName: String,
    val label: String,
    val versionName: String?,
    val versionCode: Long?,
    val isSystem: Boolean,
)

sealed interface InstalledAppScanResult {
    data class Success(val apps: List<InstalledApp>) : InstalledAppScanResult
    data class Failure(val message: String) : InstalledAppScanResult
}

fun installedAppsReport(
    deviceId: String,
    scannedAt: String,
    result: InstalledAppScanResult,
): InstalledApps? = when (result) {
    is InstalledAppScanResult.Success -> InstalledApps(deviceId = deviceId, scannedAt = scannedAt, apps = result.apps)
    is InstalledAppScanResult.Failure -> null
}

/** Pure selection boundary: only user-installed packages leave the headset. */
fun selectThirdPartyApps(candidates: List<InstalledAppCandidate>): List<InstalledApp> = candidates
    .asSequence()
    .filterNot { it.isSystem }
    .distinctBy { it.packageName }
    .map {
        InstalledApp(
            packageName = it.packageName,
            label = it.label.ifBlank { it.packageName }.take(128),
            versionName = it.versionName?.take(128),
            versionCode = it.versionCode,
        )
    }
    .sortedWith(compareBy<InstalledApp> { it.label.lowercase() }.thenBy { it.packageName })
    .take(512)
    .toList()

@Suppress("DEPRECATION")
fun scanInstalledApps(context: Context): InstalledAppScanResult {
    return try {
        val pm = context.packageManager
        val candidates = pm.getInstalledPackages(0).mapNotNull { pkg ->
            val info = pkg.applicationInfo ?: return@mapNotNull null
            val systemFlags = ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP
            InstalledAppCandidate(
                packageName = pkg.packageName,
                label = runCatching { info.loadLabel(pm).toString() }.getOrDefault(pkg.packageName),
                versionName = pkg.versionName,
                versionCode = pkg.longVersionCode,
                isSystem = info.flags and systemFlags != 0,
            )
        }
        InstalledAppScanResult.Success(selectThirdPartyApps(candidates))
    } catch (error: Exception) {
        Log.w(LOG_TAG, "installed app scan failed: ${error.message}")
        InstalledAppScanResult.Failure(error.message ?: error::class.java.simpleName)
    }
}
