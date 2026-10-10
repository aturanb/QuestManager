package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsTest {
    @Test fun `diagnostics exposes real service connection and battery state`() {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }

        diagnostics.setServiceRunning(true)
        diagnostics.setConnection(ConnState.CONNECTED)
        diagnostics.setBattery(Battery(level = 83, charging = false))

        val state = diagnostics.state.value
        assertTrue(state.serviceRunning)
        assertEquals(ConnState.CONNECTED, state.connection)
        assertEquals(83, state.battery?.level)
        assertFalse(state.battery?.charging ?: true)
    }

    @Test fun `diagnostics carries the name the server assigned so the screen can follow a dashboard rename`() {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        assertNull(diagnostics.state.value.deviceName)

        diagnostics.setDeviceName("Quest 01")

        assertEquals("Quest 01", diagnostics.state.value.deviceName)
    }

    @Test fun `test launch without a previous game reports a useful failure`() = runTest {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        val launcher = FakeAppLauncher()
        val packageLauncher = FakePackageAppLauncher()

        val outcome = diagnostics.testLastLaunch(launcher, packageLauncher)

        assertTrue(outcome is LaunchOutcome.Failed)
        assertEquals("NO_GAME_COMMAND_RECEIVED", (outcome as LaunchOutcome.Failed).error)
        assertEquals("test_launch", diagnostics.state.value.lastCommand)
        assertEquals("FAILED NO_GAME_COMMAND_RECEIVED", diagnostics.state.value.lastResult)
        assertNull(diagnostics.state.value.expectedGame)
        assertTrue(launcher.launched.isEmpty())
    }

    @Test fun `test launch retries the most recently received game`() = runTest {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        val launcher = FakeAppLauncher()
        val packageLauncher = FakePackageAppLauncher()
        val payload = LaunchPayload("beat-saber", "Beat Saber", "test-beat-saber")

        assertTrue(diagnostics.launch(payload, launcher, packageLauncher, "launch_app beat-saber") is LaunchOutcome.Success)
        assertTrue(diagnostics.testLastLaunch(launcher, packageLauncher) is LaunchOutcome.Success)

        assertEquals(listOf("test-beat-saber", "test-beat-saber"), launcher.launched)
        assertEquals("test_launch beat-saber", diagnostics.state.value.lastCommand)
        assertEquals("SUCCESS", diagnostics.state.value.lastResult)
        assertEquals("Beat Saber", diagnostics.state.value.expectedGame?.name)
        assertEquals("2026-01-02T03:04:05Z", diagnostics.state.value.expectedGame?.launchedAt)
    }

    @Test fun `package launch uses the Android launcher instead of the Meta launcher`() = runTest {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        val metaLauncher = FakeAppLauncher()
        val packageLauncher = FakePackageAppLauncher(setOf("com.example.local"))
        val payload = LaunchPayload(
            gameId = "installed:com.example.local",
            gameName = "Local App",
            packageName = "com.example.local",
        )

        val outcome = diagnostics.launch(payload, metaLauncher, packageLauncher, "launch_app local")

        assertEquals(LaunchOutcome.Success, outcome)
        assertTrue(metaLauncher.launched.isEmpty())
        assertEquals(listOf("com.example.local"), packageLauncher.launched)
        assertEquals("Local App", diagnostics.state.value.expectedGame?.name)
    }

    @Test fun `diagnostics carries the server the agent dials`() {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        assertNull(diagnostics.state.value.server)
        val identity = AgentIdentity(
            deviceId = "d",
            deviceName = "Quest 01",
            serverHost = "192.168.1.150",
            serverPort = 3000,
            serverMode = ServerMode.AUTO,
            serverName = "CAFE-PC",
            metaAppId = "1",
        )
        diagnostics.setServer(identity.serverTarget())
        assertEquals(ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO), diagnostics.state.value.server)
    }
}
