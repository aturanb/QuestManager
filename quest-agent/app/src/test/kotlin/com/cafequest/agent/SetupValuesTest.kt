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

    // --- device name: the server owns it; only a typed, unconfirmed name is sent as an edit ---

    @Test fun `typing a different name marks it as pending for the server`() {
        val merged = mergeSetup(auto, input(deviceName = " Quest 07 "))
        assertEquals("Quest 07", merged.deviceName)
        assertTrue(merged.nameSetByStaff)
    }

    @Test fun `saving the unchanged name does not mark it pending`() {
        assertFalse(mergeSetup(auto, input(deviceName = "Quest 01")).nameSetByStaff)
        assertFalse(mergeSetup(auto, input(deviceName = "  ")).nameSetByStaff)
    }

    @Test fun `saving again without touching the name keeps a pending name pending`() {
        val pending = mergeSetup(auto, input(deviceName = "Quest 07"))
        val resaved = mergeSetup(pending, input(deviceName = "Quest 07"))
        assertTrue(resaved.nameSetByStaff)
        assertTrue(mergeSetup(pending, input(deviceName = "")).nameSetByStaff)
    }

    @Test fun `the pending flag is read back only beside a stored name`() {
        val pending = resolveIdentity(deviceId, StoredSetup(deviceName = "Quest 07", nameSetByStaff = "true"), baked)
        assertTrue(pending.nameSetByStaff)
        assertFalse(resolveIdentity(deviceId, StoredSetup(deviceName = "Quest 07"), baked).nameSetByStaff)
        assertFalse(resolveIdentity(deviceId, StoredSetup(nameSetByStaff = "true"), baked).nameSetByStaff)
        assertFalse(resolveIdentity(deviceId, StoredSetup(deviceName = "Quest 07", nameSetByStaff = "yes"), baked).nameSetByStaff)
    }

    @Test fun `the server's name replaces the local one and clears the pending flag`() {
        val adopted = auto.copy(deviceName = "Quest EFGH").withServerName(" Quest 01 ")
        assertEquals("Quest 01", adopted.deviceName)
        assertFalse(adopted.nameSetByStaff)
    }

    @Test fun `the server confirming the typed name clears the pending flag`() {
        val confirmed = mergeSetup(auto, input(deviceName = "Quest 07")).withServerName("Quest 07")
        assertEquals("Quest 07", confirmed.deviceName)
        assertFalse(confirmed.nameSetByStaff)
    }

    @Test fun `a name typed since the last hello is not clobbered by a different server name`() {
        val typed = mergeSetup(auto, input(deviceName = "Quest 07"))
        assertEquals(typed, typed.withServerName("Quest 01"))
    }

    @Test fun `a blank server name is ignored`() {
        assertEquals(auto, auto.withServerName("   "))
    }

    @Test fun `the hello sends the typed name flag only while it is pending`() {
        val pending = mergeSetup(auto, input(deviceName = "Quest 07")).toHello("Quest 3", "0.7.0")
        assertEquals("Quest 07", pending.deviceName)
        assertEquals(true, pending.deviceNameSetByStaff)
        val settled = auto.toHello("Quest 3", "0.7.0")
        assertEquals("Quest 01", settled.deviceName)
        assertNull(settled.deviceNameSetByStaff)
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
