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

    @Test fun `test launch without a previous game reports a useful failure`() = runTest {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        val launcher = FakeAppLauncher()

        val outcome = diagnostics.testLastLaunch(launcher)

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
        val payload = LaunchPayload("beat-saber", "Beat Saber", "test-beat-saber")

        assertTrue(diagnostics.launch(payload, launcher, "launch_app beat-saber") is LaunchOutcome.Success)
        assertTrue(diagnostics.testLastLaunch(launcher) is LaunchOutcome.Success)

        assertEquals(listOf("test-beat-saber", "test-beat-saber"), launcher.launched)
        assertEquals("test_launch beat-saber", diagnostics.state.value.lastCommand)
        assertEquals("SUCCESS", diagnostics.state.value.lastResult)
        assertEquals("Beat Saber", diagnostics.state.value.expectedGame?.name)
        assertEquals("2026-01-02T03:04:05Z", diagnostics.state.value.expectedGame?.launchedAt)
    }
}
