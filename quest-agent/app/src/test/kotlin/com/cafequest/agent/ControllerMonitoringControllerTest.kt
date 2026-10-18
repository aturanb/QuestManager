package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeSettings(
    var wifi: Int = 0,
    var boot: Int = 1,
    var granted: Boolean = true,
) : SecureSettings {
    val writes = mutableListOf<Int>()
    override fun adbWifiEnabled(): Int = wifi
    override fun setAdbWifiEnabled(value: Int) {
        if (!granted) throw SecurityException("WRITE_SECURE_SETTINGS")
        writes += value
        wifi = value
    }
    override fun bootCount(): Int = boot
}

private class FakeStore : ControllerMonitoringStore {
    override var ownedByAgent = false
    override var lastRequestBootCount = -1
}

class ControllerMonitoringControllerTest {
    private fun controller(settings: FakeSettings, store: FakeStore = FakeStore()) =
        ControllerMonitoringController(settings, store)

    @Test fun `enabling while off turns Wireless Debugging on and owns it`() {
        val settings = FakeSettings(wifi = 0)
        val store = FakeStore()
        controller(settings, store).apply(true)
        assertEquals(listOf(1), settings.writes)
        assertTrue(store.ownedByAgent)
        assertEquals(1, store.lastRequestBootCount)
    }

    @Test fun `enabling while staff already turned it on writes nothing and owns nothing`() {
        val settings = FakeSettings(wifi = 1)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        assertTrue(settings.writes.isEmpty())
        assertFalse(store.ownedByAgent)
        assertEquals(WirelessDebuggingState.ON, c.wireState())
    }

    @Test fun `a missing grant reports not_permitted and records nothing so a later grant retries`() {
        val settings = FakeSettings(wifi = 0, granted = false)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        assertEquals(WirelessDebuggingState.NOT_PERMITTED, c.wireState())
        assertFalse(store.ownedByAgent)
        assertEquals(-1, store.lastRequestBootCount)
        settings.granted = true
        c.apply(true)
        assertEquals(listOf(1), settings.writes)
        assertEquals(WirelessDebuggingState.ON, c.wireState())
    }

    @Test fun `reconnect storms never re-raise the dialog within one boot`() {
        val settings = FakeSettings(wifi = 0)
        val c = controller(settings)
        c.apply(true)
        // The person denied the dialog, so the system put the setting back to off.
        settings.wifi = 0
        repeat(5) { c.apply(true) }
        assertEquals("one request per boot", listOf(1), settings.writes)
        assertEquals(WirelessDebuggingState.OFF, c.wireState())
    }

    @Test fun `a new boot asks again`() {
        val settings = FakeSettings(wifi = 0, boot = 1)
        val c = controller(settings)
        c.apply(true)
        settings.wifi = 0
        settings.boot = 2
        c.apply(true)
        assertEquals(listOf(1, 1), settings.writes)
    }

    @Test fun `disabling switches off only what the agent turned on`() {
        val settings = FakeSettings(wifi = 0)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        c.apply(false)
        assertEquals(listOf(1, 0), settings.writes)
        assertFalse(store.ownedByAgent)
        assertEquals(-1, store.lastRequestBootCount)
    }

    @Test fun `disabling leaves a setting staff enabled alone`() {
        val settings = FakeSettings(wifi = 1)
        val c = controller(settings)
        c.apply(true)
        c.apply(false)
        assertTrue(settings.writes.isEmpty())
        assertEquals(1, settings.wifi)
    }

    @Test fun `ownership from an earlier boot is discarded`() {
        val settings = FakeSettings(wifi = 0, boot = 1)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        assertTrue(store.ownedByAgent)
        // Reboot: Horizon OS reset the setting, then staff switched it on by hand.
        settings.boot = 2
        settings.wifi = 1
        c.apply(false)
        assertTrue("staff's setting is not ours any more", settings.writes == listOf(1))
        assertEquals(1, settings.wifi)
    }

    @Test fun `turning monitoring off then on re-arms the request within the same boot`() {
        val settings = FakeSettings(wifi = 0)
        val c = controller(settings)
        c.apply(true)
        settings.wifi = 0 // denied
        c.apply(false)
        c.apply(true)
        assertEquals(listOf(1, 1), settings.writes)
    }

    @Test fun `ownership survives a process restart through the store`() {
        val settings = FakeSettings(wifi = 0)
        val store = FakeStore()
        controller(settings, store).apply(true)
        // A fresh controller over the same store, as after the agent process restarts.
        controller(settings, store).apply(false)
        assertEquals(listOf(1, 0), settings.writes)
    }

    @Test fun `disabling with the grant revoked never throws`() {
        val settings = FakeSettings(wifi = 0)
        val c = controller(settings)
        c.apply(true)
        settings.granted = false
        c.apply(false)
        assertEquals(listOf(1), settings.writes)
    }

    @Test fun `wire state follows the setting`() {
        val settings = FakeSettings(wifi = 1)
        val c = controller(settings)
        assertEquals(WirelessDebuggingState.ON, c.wireState())
        settings.wifi = 0
        assertEquals(WirelessDebuggingState.OFF, c.wireState())
    }
}
