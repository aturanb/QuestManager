package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class SetupValuesTest {
    private val deviceId = "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f"

    private val baked = AgentSetupDefaults(
        host = "192.168.1.77",
        port = 3000,
        enrollmentKey = "baked-enrollment-key",
        metaAppId = "1336716629531597",
    )

    private val configured = AgentIdentity(
        deviceId = deviceId,
        deviceName = "Quest 01",
        serverHost = "192.168.1.50",
        serverPort = 3000,
        enrollmentKey = "stored-enrollment-key",
        metaAppId = "1336716629531597",
    )

    // --- mergeSetup: a Save must never silently drop a field staff cannot see ---

    @Test fun `saving with a blank enrollment key keeps the stored key`() {
        val merged = mergeSetup(
            configured,
            AgentSetupInput(
                deviceName = "Quest 02",
                serverHost = "192.168.1.50",
                serverPort = "3000",
                enrollmentKey = "",
                metaAppId = "1336716629531597",
            ),
        )

        assertEquals("stored-enrollment-key", merged.enrollmentKey)
        assertEquals("Quest 02", merged.deviceName)
    }

    @Test fun `saving with a blank Meta App ID keeps the stored one`() {
        val merged = mergeSetup(configured, input(metaAppId = ""))
        assertEquals("1336716629531597", merged.metaAppId)
    }

    @Test fun `saving with a blank name or host keeps the stored values`() {
        val merged = mergeSetup(configured, input(deviceName = "  ", serverHost = ""))
        assertEquals("Quest 01", merged.deviceName)
        assertEquals("192.168.1.50", merged.serverHost)
    }

    @Test fun `provided values replace the stored ones and are trimmed`() {
        val merged = mergeSetup(
            configured,
            input(deviceName = "  Quest 07 ", serverHost = " 10.0.0.9 ", enrollmentKey = " new-key "),
        )

        assertEquals("Quest 07", merged.deviceName)
        assertEquals("10.0.0.9", merged.serverHost)
        assertEquals("new-key", merged.enrollmentKey)
    }

    @Test fun `an unparseable port keeps the stored port`() {
        assertEquals(3000, mergeSetup(configured, input(serverPort = "three thousand")).serverPort)
    }

    @Test fun `a port outside the valid range is clamped`() {
        assertEquals(65535, mergeSetup(configured, input(serverPort = "99999")).serverPort)
        assertEquals(1, mergeSetup(configured, input(serverPort = "0")).serverPort)
    }

    // --- resolveIdentity: a fresh install should need no typing at all ---

    @Test fun `a fresh install falls back to the baked-in defaults`() {
        val identity = resolveIdentity(deviceId, StoredSetup(), baked)

        assertEquals("192.168.1.77", identity.serverHost)
        assertEquals(3000, identity.serverPort)
        assertEquals("baked-enrollment-key", identity.enrollmentKey)
        assertEquals("1336716629531597", identity.metaAppId)
        assertEquals("Quest 0B8F", identity.deviceName)
    }

    @Test fun `stored values win over the baked-in defaults`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(
                deviceName = "Quest 03",
                serverHost = "10.0.0.5",
                serverPort = "4000",
                enrollmentKey = "stored-enrollment-key",
                metaAppId = "9999999999999999",
            ),
            baked,
        )

        assertEquals("Quest 03", identity.deviceName)
        assertEquals("10.0.0.5", identity.serverHost)
        assertEquals(4000, identity.serverPort)
        assertEquals("stored-enrollment-key", identity.enrollmentKey)
        assertEquals("9999999999999999", identity.metaAppId)
    }

    @Test fun `blank stored values are treated as unset`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(deviceName = "   ", serverHost = "", enrollmentKey = "  ", metaAppId = ""),
            baked,
        )

        assertEquals("Quest 0B8F", identity.deviceName)
        assertEquals("192.168.1.77", identity.serverHost)
        assertEquals("baked-enrollment-key", identity.enrollmentKey)
        assertEquals("1336716629531597", identity.metaAppId)
    }

    @Test fun `with nothing baked in the Meta App ID stays unconfigured`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(),
            AgentSetupDefaults(host = "192.168.1.50", port = 3000, enrollmentKey = "", metaAppId = ""),
        )

        assertEquals(UNCONFIGURED_APP_ID, identity.metaAppId)
        assertEquals("", identity.enrollmentKey)
    }

    private fun input(
        deviceName: String = configured.deviceName,
        serverHost: String = configured.serverHost,
        serverPort: String = configured.serverPort.toString(),
        enrollmentKey: String = configured.enrollmentKey,
        metaAppId: String = configured.metaAppId,
    ) = AgentSetupInput(deviceName, serverHost, serverPort, enrollmentKey, metaAppId)
}
