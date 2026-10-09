package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PackageLauncherTest {
    @Test fun `package launcher reports success only when Android starts the package`() = runTest {
        val started = mutableListOf<String>()
        val launcher = AndroidPackageAppLauncher { packageName ->
            started += packageName
            packageName == "com.example.installed"
        }

        assertEquals(LaunchOutcome.Success, launcher.launch("com.example.installed"))
        val missing = launcher.launch("com.example.missing")

        assertTrue(missing is LaunchOutcome.Failed)
        assertEquals("TARGET_NOT_LAUNCHABLE", (missing as LaunchOutcome.Failed).error)
        assertEquals(listOf("com.example.installed", "com.example.missing"), started)
    }

    @Test fun `package launcher turns Android failures into bounded command errors`() = runTest {
        val launcher = AndroidPackageAppLauncher { throw SecurityException("blocked by headset policy") }

        val outcome = launcher.launch("com.example.blocked")

        assertTrue(outcome is LaunchOutcome.Failed)
        assertEquals("blocked by headset policy", (outcome as LaunchOutcome.Failed).error)
    }
}
