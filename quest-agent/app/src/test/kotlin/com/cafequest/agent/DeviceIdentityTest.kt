package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class DeviceIdentityTest {
    @Test fun `the same Android id produces the same protocol UUID after reinstall`() {
        val firstInstall = stableDeviceId("a1b2c3d4e5f67890")
        val reinstalled = stableDeviceId("a1b2c3d4e5f67890")

        assertEquals(firstInstall, reinstalled)
        assertEquals("3464b798-2488-3977-a3ab-484b86e60948", firstInstall)
        assertEquals(firstInstall, java.util.UUID.fromString(firstInstall).toString())
    }

    @Test fun `different headsets produce different protocol UUIDs`() {
        assertNotEquals(
            stableDeviceId("a1b2c3d4e5f67890"),
            stableDeviceId("0011223344556677"),
        )
    }

    @Test fun `an upgraded install uses the stable id and carries its legacy id for migration`() {
        val legacyId = "7a6c1c78-30cc-4ba8-8e72-cfcf3a729c18"
        val selected = resolveDeviceId(
            androidId = "a1b2c3d4e5f67890",
            storedId = legacyId,
            fallbackId = { "unused" },
        )

        assertEquals(stableDeviceId("a1b2c3d4e5f67890"), selected.deviceId)
        assertEquals(legacyId, selected.previousDeviceId)
    }

    @Test fun `a reinstall selects the same stable id without claiming a previous install`() {
        val stableId = stableDeviceId("a1b2c3d4e5f67890")
        val selected = resolveDeviceId(
            androidId = "a1b2c3d4e5f67890",
            storedId = stableId,
            fallbackId = { "unused" },
        )

        assertEquals(stableId, selected.deviceId)
        assertEquals(null, selected.previousDeviceId)
    }

    @Test fun `a missing Android id keeps the stored id instead of inventing a replacement`() {
        val storedId = "7a6c1c78-30cc-4ba8-8e72-cfcf3a729c18"
        val selected = resolveDeviceId(
            androidId = null,
            storedId = storedId,
            fallbackId = { "fallback" },
        )

        assertEquals(storedId, selected.deviceId)
        assertEquals(null, selected.previousDeviceId)
    }
}
