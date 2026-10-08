package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class BackoffTest {
    @Test fun `schedule matches brief 25`() {
        val expected = listOf(1_000L, 2_000L, 5_000L, 10_000L, 30_000L, 30_000L, 30_000L)
        expected.forEachIndexed { i, ms -> assertEquals(ms, backoffDelayMs(i)) }
        assertEquals(1_000L, backoffDelayMs(-3))
    }
}
