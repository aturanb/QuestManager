package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class InstalledAppScannerTest {
    @Test fun `select third party apps excludes system packages but includes the CafeQuest agent`() {
        val apps = selectThirdPartyApps(
            candidates = listOf(
                InstalledAppCandidate("com.meta.system", "System", null, null, isSystem = true),
                InstalledAppCandidate("com.cafequest.agent", "CafeQuest", "0.1", 1, isSystem = false),
                InstalledAppCandidate("com.example.zed", "Zed", null, null, isSystem = false),
                InstalledAppCandidate("com.example.alpha", "Alpha", "2.0", 20, isSystem = false),
            ),
        )

        assertEquals(
            listOf("com.example.alpha", "com.cafequest.agent", "com.example.zed"),
            apps.map { it.packageName },
        )
        assertEquals("2.0", apps.first().versionName)
    }

    @Test fun `select third party apps deduplicates packages and caps payload`() {
        val candidates = (0..520).map {
            InstalledAppCandidate("com.example.app$it", "App $it", null, it.toLong(), isSystem = false)
        } + InstalledAppCandidate("com.example.app1", "Duplicate", null, 999, isSystem = false)

        val apps = selectThirdPartyApps(candidates)

        assertEquals(512, apps.size)
        assertEquals(apps.size, apps.map { it.packageName }.distinct().size)
    }

    @Test fun `failed scan does not create an empty inventory report`() {
        val report = installedAppsReport(
            deviceId = "device-1",
            scannedAt = "2026-10-08T12:00:00Z",
            result = InstalledAppScanResult.Failure("package manager unavailable"),
        )

        assertEquals(null, report)
    }

    @Test fun `successful empty scan remains distinguishable from failure`() {
        val report = installedAppsReport(
            deviceId = "device-1",
            scannedAt = "2026-10-08T12:00:00Z",
            result = InstalledAppScanResult.Success(emptyList()),
        )

        assertEquals(emptyList<InstalledApp>(), report?.apps)
    }
}
