package com.cafequest.agent

import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test fun `hello serializes with protocol version 1`() {
        val h = Hello(deviceId = "d", deviceName = "Quest 01", deviceModel = "Quest 3", agentVersion = "0.1.0")
        val json = protocolJson.encodeToString(h)
        assertTrue(json.contains("\"protocolVersion\":1"))
        assertTrue(json.contains("\"type\":\"hello\""))
        assertFalse(json.contains("enrollmentKey"))
    }

    @Test fun `valid launch command parses, errors and unknown types return null`() {
        val good = """{"type":"command","protocolVersion":1,"commandId":"c1","command":"launch_app","payload":{"gameId":"beat-saber","gameName":"Beat Saber","metaAppId":"123"}}"""
        val cmd = parseLaunchCommand(good)
        assertNotNull(cmd)
        assertEquals("c1", cmd!!.commandId)
        assertEquals("123", cmd.payload!!.metaAppId)

        assertNull(parseLaunchCommand("""{"type":"error","protocolVersion":1,"code":"X","message":"y"}"""))
        assertNull(parseLaunchCommand("""{"type":"command","protocolVersion":1,"commandId":"c","command":"reboot","payload":null}"""))
        assertNull(parseLaunchCommand("""{"type":"command","protocolVersion":99,"commandId":"c","command":"launch_app","payload":{"gameId":"g","gameName":"n","metaAppId":"m"}}"""))
        assertNull(parseLaunchCommand("not json"))
        assertNull(parseLaunchCommand("""{"type":"command","protocolVersion":1,"commandId":"c","command":"launch_app"}"""))
    }

    @Test fun `package launch command parses and ambiguous targets are rejected`() {
        val packageCommand = parseLaunchCommand(
            """{"type":"command","protocolVersion":1,"commandId":"c2","command":"launch_app","payload":{"gameId":"local","gameName":"Local App","packageName":"com.example.local"}}"""
        )

        assertNotNull(packageCommand)
        assertEquals("com.example.local", packageCommand!!.payload!!.packageName)
        assertNull(packageCommand.payload!!.metaAppId)
        assertNull(
            parseLaunchCommand(
                """{"type":"command","protocolVersion":1,"commandId":"c3","command":"launch_app","payload":{"gameId":"local","gameName":"Local App","metaAppId":"12345","packageName":"com.example.local"}}"""
            )
        )
        assertNull(
            parseLaunchCommand(
                """{"type":"command","protocolVersion":1,"commandId":"c4","command":"launch_app","payload":{"gameId":"local","gameName":"Local App"}}"""
            )
        )
    }

    @Test fun `ack and result carry deviceId for ownership checks`() {
        val ack = protocolJson.encodeToString(CommandAck(commandId = "c", deviceId = "d"))
        assertTrue(ack.contains("\"deviceId\":\"d\""))
        val res = protocolJson.encodeToString(CommandResult(commandId = "c", status = "failed", error = "TARGET_NOT_INSTALLED", deviceId = "d"))
        assertTrue(res.contains("\"status\":\"failed\""))
    }

    @Test fun `installed app inventory serializes package metadata`() {
        val inventory = InstalledApps(
            deviceId = "device-1",
            scannedAt = "2026-10-08T12:00:00Z",
            apps = listOf(
                InstalledApp(
                    packageName = "com.TriangleFactory.Breachers",
                    label = "Breachers",
                    versionName = "1.0",
                    versionCode = 42,
                )
            ),
        )
        val json = protocolJson.encodeToString(inventory)
        assertTrue(json.contains("\"type\":\"installed_apps\""))
        assertTrue(json.contains("\"packageName\":\"com.TriangleFactory.Breachers\""))
        assertTrue(json.contains("\"versionCode\":42"))
    }
}
