package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SetupValuesTest {
    private val deviceId = "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f"

    private val baked = AgentSetupDefaults(metaAppId = "1336716629531597")

    private val auto = AgentIdentity(
        deviceId = deviceId,
        deviceName = "Quest 01",
        serverHost = "192.168.1.150",
        serverPort = 3000,
        serverMode = ServerMode.AUTO,
        serverName = "CAFE-PC",
        metaAppId = "1336716629531597",
    )
    private val manual = auto.copy(serverHost = "192.168.1.77", serverMode = ServerMode.MANUAL)
    private val cafePcMoved = FoundServer(name = "CAFE-PC", host = "192.168.1.151", port = 3000)

    // --- mergeSetup: a Save must never silently drop a field staff cannot see ---

    @Test fun `saving with a blank name or Meta App ID keeps the stored values`() {
        val merged = mergeSetup(auto, input(deviceName = "  ", metaAppId = ""))
        assertEquals("Quest 01", merged.deviceName)
        assertEquals("1336716629531597", merged.metaAppId)
    }

    @Test fun `manual saves the typed address, trimmed, and keeps the remembered PC name`() {
        val merged = mergeSetup(auto, input(serverMode = ServerMode.MANUAL, serverHost = " 10.0.0.9 ", serverPort = "4000"))
        assertEquals(ServerMode.MANUAL, merged.serverMode)
        assertEquals("10.0.0.9", merged.serverHost)
        assertEquals(4000, merged.serverPort)
        assertEquals("CAFE-PC", merged.serverName)
    }

    @Test fun `manual with a blank host or a bad port keeps the stored address`() {
        val merged = mergeSetup(manual, input(serverMode = ServerMode.MANUAL, serverHost = "", serverPort = "three thousand"))
        assertEquals("192.168.1.77", merged.serverHost)
        assertEquals(3000, merged.serverPort)
    }

    @Test fun `a manual port outside the valid range is clamped`() {
        assertEquals(65535, mergeSetup(manual, input(serverMode = ServerMode.MANUAL, serverPort = "99999")).serverPort)
        assertEquals(1, mergeSetup(manual, input(serverMode = ServerMode.MANUAL, serverPort = "0")).serverPort)
    }

    @Test fun `auto with a found server takes its address and name`() {
        val merged = mergeSetup(manual, input(serverMode = ServerMode.AUTO, picked = cafePcMoved))
        assertEquals(ServerMode.AUTO, merged.serverMode)
        assertEquals("192.168.1.151", merged.serverHost)
        assertEquals(3000, merged.serverPort)
        assertEquals("CAFE-PC", merged.serverName)
    }

    @Test fun `auto without a pick keeps what auto found before and ignores a typed host`() {
        assertEquals(auto, mergeSetup(auto, input(serverMode = ServerMode.AUTO, serverHost = "10.9.9.9")))
    }

    @Test fun `switching from manual to auto without a pick drops the typed address so the agent searches`() {
        val merged = mergeSetup(manual, input(serverMode = ServerMode.AUTO))
        assertEquals(ServerMode.AUTO, merged.serverMode)
        assertEquals("", merged.serverHost)
        assertEquals("CAFE-PC", merged.serverName)
        assertTrue(shouldSearch(merged.serverMode, merged.serverHost, failedAttempts = 0))
    }

    // --- withDiscovered: what the agent persists after a search ---

    @Test fun `a search result moves an auto headset to the PC's new address`() {
        val moved = withDiscovered(auto, cafePcMoved)
        assertEquals(auto.copy(serverHost = "192.168.1.151"), moved)
    }

    @Test fun `a search result never overwrites a manual address`() {
        assertNull(withDiscovered(manual, cafePcMoved))
    }

    // --- resolveIdentity: a fresh install should need no typing at all ---

    @Test fun `a fresh install is auto with no address yet, so it searches at once`() {
        val identity = resolveIdentity(deviceId, StoredSetup(), baked)
        assertEquals(ServerMode.AUTO, identity.serverMode)
        assertEquals("", identity.serverHost)
        assertEquals(DEFAULT_SERVER_PORT, identity.serverPort)
        assertNull(identity.serverName)
        assertEquals("1336716629531597", identity.metaAppId)
        assertEquals("Quest 0B8F", identity.deviceName)
        assertTrue(shouldSearch(identity.serverMode, identity.serverHost, failedAttempts = 0))
    }

    @Test fun `a headset upgraded from the old agent keeps its saved address and reads as auto`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(deviceName = "Quest 03", serverHost = "192.168.1.150", serverPort = "3000"),
            baked,
        )
        assertEquals(ServerMode.AUTO, identity.serverMode)
        assertEquals("192.168.1.150", identity.serverHost)
        assertNull(identity.serverName)
        assertFalse(shouldSearch(identity.serverMode, identity.serverHost, failedAttempts = 0))
    }

    @Test fun `stored values win over the baked-in Meta App ID`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(
                deviceName = "Quest 03",
                serverHost = "10.0.0.5",
                serverPort = "4000",
                serverMode = "manual",
                serverName = "CAFE-PC",
                metaAppId = "9999999999999999",
            ),
            baked,
        )
        assertEquals("Quest 03", identity.deviceName)
        assertEquals("10.0.0.5", identity.serverHost)
        assertEquals(4000, identity.serverPort)
        assertEquals(ServerMode.MANUAL, identity.serverMode)
        assertEquals("CAFE-PC", identity.serverName)
        assertEquals("9999999999999999", identity.metaAppId)
    }

    @Test fun `blank or junk stored values are treated as unset`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(deviceName = "   ", serverHost = "", serverPort = "x", serverMode = "sideways", serverName = " ", metaAppId = ""),
            baked,
        )
        assertEquals("Quest 0B8F", identity.deviceName)
        assertEquals("", identity.serverHost)
        assertEquals(DEFAULT_SERVER_PORT, identity.serverPort)
        assertEquals(ServerMode.AUTO, identity.serverMode)
        assertNull(identity.serverName)
        assertEquals("1336716629531597", identity.metaAppId)
    }

    @Test fun `with nothing baked in the Meta App ID stays unconfigured`() {
        assertEquals(UNCONFIGURED_APP_ID, resolveIdentity(deviceId, StoredSetup(), AgentSetupDefaults(metaAppId = "")).metaAppId)
    }

    private fun input(
        deviceName: String = "Quest 01",
        serverMode: ServerMode = ServerMode.AUTO,
        serverHost: String = "",
        serverPort: String = "",
        metaAppId: String = "1336716629531597",
        picked: FoundServer? = null,
    ) = AgentSetupInput(deviceName, serverMode, serverHost, serverPort, metaAppId, picked)
}
