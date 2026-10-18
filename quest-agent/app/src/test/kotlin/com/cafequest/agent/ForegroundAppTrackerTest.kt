package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForegroundAppTrackerTest {
    private val games = setOf("com.example.alpha", "com.example.beta")

    @Test fun `reports managed game and preserves its original foreground time`() {
        val tracker = ForegroundAppTracker()

        tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND)),
            games,
        )
        val result = tracker.apply(emptyList(), games)

        assertEquals("com.example.alpha", result?.packageName)
        assertEquals(1_000L, result?.startedAtMs)
    }

    @Test fun `switching games resets foreground duration`() {
        val tracker = ForegroundAppTracker()

        val result = tracker.apply(
            listOf(
                UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND),
                UsageTransitionEvent("com.example.beta", 4_000, UsageTransition.FOREGROUND),
            ),
            games,
        )

        assertEquals("com.example.beta", result?.packageName)
        assertEquals(4_000L, result?.startedAtMs)
    }

    @Test fun `an unmanaged overlay leaves the running game and its start time intact`() {
        val tracker = ForegroundAppTracker()
        tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND)),
            games,
        )

        val result = tracker.apply(
            listOf(UsageTransitionEvent("com.oculus.vrshell", 2_000, UsageTransition.FOREGROUND)),
            games,
        )

        assertEquals("com.example.alpha", result?.packageName)
        assertEquals(1_000L, result?.startedAtMs)
    }

    @Test fun `returning from an overlay keeps the original foreground start time`() {
        val tracker = ForegroundAppTracker()
        tracker.apply(
            listOf(
                UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND),
                UsageTransitionEvent("com.oculus.vrshell", 2_000, UsageTransition.FOREGROUND),
            ),
            games,
        )

        val result = tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 3_000, UsageTransition.FOREGROUND)),
            games,
        )

        assertEquals("com.example.alpha", result?.packageName)
        assertEquals(1_000L, result?.startedAtMs)
    }

    @Test fun `the game going to background clears the current game`() {
        val tracker = ForegroundAppTracker()
        tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND)),
            games,
        )

        assertNull(
            tracker.apply(
                listOf(UsageTransitionEvent("com.example.alpha", 4_000, UsageTransition.BACKGROUND)),
                games,
            )
        )
    }

    @Test fun `a managed panel app blinking in and out leaves the running game intact`() {
        val tracker = ForegroundAppTracker()
        val managed = games + "com.oculus.igvr"
        tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND)),
            managed,
        )

        // Quest resumes 2D panel apps alongside the immersive game: Instagram was
        // seen resuming and pausing one second later while the game kept running.
        val result = tracker.apply(
            listOf(
                UsageTransitionEvent("com.oculus.igvr", 2_000, UsageTransition.FOREGROUND),
                UsageTransitionEvent("com.oculus.igvr", 3_000, UsageTransition.BACKGROUND),
            ),
            managed,
        )

        assertEquals("com.example.alpha", result?.packageName)
        assertEquals(1_000L, result?.startedAtMs)
    }

    @Test fun `the most recently resumed managed app wins while both are resumed`() {
        val tracker = ForegroundAppTracker()
        val managed = games + "com.oculus.igvr"

        val result = tracker.apply(
            listOf(
                UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND),
                UsageTransitionEvent("com.oculus.igvr", 2_000, UsageTransition.FOREGROUND),
            ),
            managed,
        )

        assertEquals("com.oculus.igvr", result?.packageName)
        assertEquals(2_000L, result?.startedAtMs)
    }

    @Test fun `a repeated resume for an already running game keeps its start time`() {
        val tracker = ForegroundAppTracker()
        tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND)),
            games,
        )

        val result = tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 8_000, UsageTransition.FOREGROUND)),
            games,
        )

        assertEquals(1_000L, result?.startedAtMs)
    }

    @Test fun `inventory removal clears an app that is no longer managed`() {
        val tracker = ForegroundAppTracker()
        tracker.apply(
            listOf(UsageTransitionEvent("com.example.alpha", 1_000, UsageTransition.FOREGROUND)),
            games,
        )

        assertNull(tracker.apply(emptyList(), setOf("com.example.beta")))
    }
}
