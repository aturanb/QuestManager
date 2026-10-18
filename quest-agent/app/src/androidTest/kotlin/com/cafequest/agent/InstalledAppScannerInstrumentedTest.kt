package com.cafequest.agent

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.content.pm.ApplicationInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class InstalledAppScannerInstrumentedTest {
    @Test
    fun queryAllPackagesReturnsThirdPartyAppsWithoutCafeQuestItself() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val result = scanInstalledApps(context)
        assertTrue("package scan failed: $result", result is InstalledAppScanResult.Success)
        val apps = (result as InstalledAppScanResult.Success).apps
        val systemFlags = ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP
        @Suppress("DEPRECATION")
        val deviceHasThirdPartyApps = context.packageManager.getInstalledPackages(0).any { pkg ->
            val info = pkg.applicationInfo
            info != null && info.flags and systemFlags == 0 && pkg.packageName != context.packageName
        }

        assertEquals(deviceHasThirdPartyApps, apps.isNotEmpty())
        assertFalse(apps.any { it.packageName == context.packageName })
        assertTrue(apps.all { it.packageName.contains('.') && it.label.isNotBlank() })
    }
}
