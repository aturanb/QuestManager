package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class UsageQueryWindowTest {
    private val now = 1_000_000L
    private val lookback = 60_000L

    @Test fun `the first poll looks back the whole lookback window`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        assertEquals(now - lookback, window.from(now))
    }

    @Test fun `a poll that saw no events leaves the window where it was`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        window.accept(emptyList())

        // Android flushes usage events in batches: an event that happened at `now`
        // may only become queryable seconds later, so the window must not move past it.
        assertEquals(now - lookback, window.from(now))
        assertEquals(now + 5_000 - lookback, window.from(now + 5_000))
    }

    @Test fun `an event that becomes queryable late is still returned`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        val resumedAt = now - 1_000

        // Poll at `now` sees nothing yet (not flushed).
        assertEquals(emptyList<UsageTransitionEvent>(), window.accept(emptyList()))
        // Poll five seconds later: the event is now in the database, and the window
        // still covers it.
        val late = UsageTransitionEvent("com.example.alpha", resumedAt, UsageTransition.FOREGROUND)
        assertEquals(true, window.from(now + 5_000) <= resumedAt)
        assertEquals(listOf(late), window.accept(listOf(late)))
    }

    @Test fun `the window advances past the newest applied event`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        window.accept(
            listOf(
                UsageTransitionEvent("com.example.alpha", now - 9_000, UsageTransition.FOREGROUND),
                UsageTransitionEvent("com.example.alpha", now - 4_000, UsageTransition.BACKGROUND),
            )
        )

        assertEquals(now - 4_000 + 1, window.from(now))
    }

    @Test fun `events already applied are not replayed`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        val first = UsageTransitionEvent("com.example.alpha", now - 9_000, UsageTransition.FOREGROUND)
        val second = UsageTransitionEvent("com.example.beta", now - 2_000, UsageTransition.FOREGROUND)
        window.accept(listOf(first))

        assertEquals(listOf(second), window.accept(listOf(first, second)))
    }

    @Test fun `events are applied oldest first`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        val older = UsageTransitionEvent("com.example.alpha", now - 9_000, UsageTransition.FOREGROUND)
        val newer = UsageTransitionEvent("com.example.beta", now - 2_000, UsageTransition.FOREGROUND)

        assertEquals(listOf(older, newer), window.accept(listOf(newer, older)))
    }

    @Test fun `the window never looks back further than the lookback allows`() {
        val window = UsageQueryWindow(maxLookbackMs = lookback)
        window.accept(listOf(UsageTransitionEvent("com.example.alpha", now, UsageTransition.FOREGROUND)))

        // Long idle stretch: the window clamps instead of querying days of history.
        val muchLater = now + 10 * lookback
        assertEquals(muchLater - lookback, window.from(muchLater))
    }
}
