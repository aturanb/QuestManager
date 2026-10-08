package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class BatteryTest {
    @Test fun `normalization clamps to 0-100`() {
        assertEquals(0, normalizeBattery(-50))
        assertEquals(100, normalizeBattery(900))
        assertEquals(0, normalizeBattery(0))
        assertEquals(100, normalizeBattery(100))
        assertEquals(83, normalizeBattery(83))
    }
}
