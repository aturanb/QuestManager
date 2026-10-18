package com.cafequest.agent

import android.content.Context
import android.content.Intent

fun interface PackageLaunchDriver {
    /** Returns false when Android cannot find a front-door activity for the package. */
    fun launch(packageName: String): Boolean
}

/** Android package fallback for sideloaded apps that have no Meta App ID. */
class AndroidPackageAppLauncher(
    private val driver: PackageLaunchDriver,
) : PackageAppLauncher {
    constructor(context: Context) : this(
        PackageLaunchDriver { packageName ->
            val appContext = context.applicationContext
            val manager = appContext.packageManager
            val intent = manager.getLeanbackLaunchIntentForPackage(packageName)
                ?: manager.getLaunchIntentForPackage(packageName)
                ?: return@PackageLaunchDriver false
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            appContext.startActivity(intent)
            true
        }
    )

    override suspend fun launch(packageName: String): LaunchOutcome = try {
        if (driver.launch(packageName)) LaunchOutcome.Success
        else LaunchOutcome.Failed("TARGET_NOT_LAUNCHABLE")
    } catch (error: Exception) {
        LaunchOutcome.Failed(error.message?.take(200) ?: "PACKAGE_LAUNCH_FAILED")
    }
}
