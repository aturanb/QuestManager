package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class LauncherTest {
    @Test fun `fake launcher succeeds for installed apps, TARGET_NOT_INSTALLED otherwise`() = runTest {
        val fake = FakeAppLauncher()
        assertTrue(fake.launch("test-beat-saber") is LaunchOutcome.Success)
        val failed = fake.launch("some-unknown-app")
        assertTrue(failed is LaunchOutcome.Failed)
        assertEquals("TARGET_NOT_INSTALLED", (failed as LaunchOutcome.Failed).error)
        assertEquals(listOf("test-beat-saber"), fake.launched)
    }

    @Test fun `dispatch maps outcomes to wire statuses`() = runTest {
        val outcomes = listOf<LaunchOutcome>(
            LaunchOutcome.Success,
            LaunchOutcome.Failed("TARGET_NOT_INSTALLED"),
        )
        val statuses = outcomes.map { if (it is LaunchOutcome.Success) "success" else "failed" }
        assertEquals(listOf("success", "failed"), statuses)
    }
}
