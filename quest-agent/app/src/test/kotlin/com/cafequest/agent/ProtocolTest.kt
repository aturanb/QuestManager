package com.cafequest.agent

import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    private val castSessionId = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"

    @Test fun `hello serializes with protocol version 1`() {
        val h = Hello(deviceId = "d", deviceName = "Quest 01", deviceModel = "Quest 3", agentVersion = "0.1.0")
        val json = protocolJson.encodeToString(h)
        assertTrue(json.contains("\"protocolVersion\":1"))
        assertTrue(json.contains("\"type\":\"hello\""))
        assertFalse(json.contains("enrollmentKey"))
    }

    @Test fun `the default hello advertises package launch, screen cast and controller monitoring exactly once`() {
        val json = protocolJson.encodeToString(
            Hello(deviceId = "d", deviceName = "Quest 01", deviceModel = "Quest 3", agentVersion = "0.5.0")
        )
        assertTrue(
            json.contains("\"capabilities\":[\"launch_android_package\",\"screen_cast_v1\",\"controller_monitoring_v1\"]")
        )
        assertEquals(1, Regex(Regex.escape(CAPABILITY_SCREEN_CAST)).findAll(json).count())
        assertEquals(1, Regex(Regex.escape(CAPABILITY_CONTROLLER_MONITORING)).findAll(json).count())
    }

    @Test fun `explicit screen cast capability serializes beside package launch`() {
        val json = protocolJson.encodeToString(
            Hello(
                deviceId = "d",
                deviceName = "Quest 01",
                deviceModel = "Quest 3",
                agentVersion = "0.5.0",
                capabilities = listOf(CAPABILITY_LAUNCH_ANDROID_PACKAGE, CAPABILITY_SCREEN_CAST),
            )
        )
        assertTrue(json.contains("\"launch_android_package\""))
        assertTrue(json.contains("\"screen_cast_v1\""))
    }

    @Test fun `agent cast frames serialize with the kind discriminator and no nulls`() {
        val offer = protocolJson.encodeToString<RtcSignal>(RtcSignal.Offer("v=0"))
        assertTrue(offer.contains("\"kind\":\"offer\""))
        assertTrue(offer.contains("\"sdp\":\"v=0\""))
        val status = protocolJson.encodeToString(
            AgentCastStatus(
                deviceId = "d",
                sessionId = castSessionId,
                status = CastStatus.AWAITING_APPROVAL,
            )
        )
        assertTrue(status.contains("\"type\":\"cast_status\""))
        assertTrue(status.contains("\"sessionId\":\"$castSessionId\""))
        assertFalse(status.contains("\"error\""))
    }

    @Test fun `parseServerMessage distinguishes launch, cast request, signal and stop frames`() {
        val launch = """{"type":"command","protocolVersion":1,"commandId":"c1","command":"launch_app","payload":{"gameId":"beat-saber","gameName":"Beat Saber","metaAppId":"123"}}"""
        assertTrue(parseServerMessage(launch) is ParsedServerMessage.Launch)

        val request = """{"type":"cast_request","protocolVersion":1,"sessionId":"$castSessionId","expiresAt":"2026-10-09T12:00:00.000Z"}"""
        val parsedRequest = parseServerMessage(request)
        assertTrue(parsedRequest is ParsedServerMessage.CastRequest)
        assertEquals(castSessionId, (parsedRequest as ParsedServerMessage.CastRequest).message.sessionId)

        val signal = """{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"answer","sdp":"v=0"}}"""
        val parsedSignal = parseServerMessage(signal)
        assertTrue(parsedSignal is ParsedServerMessage.CastSignal)
        assertTrue((parsedSignal as ParsedServerMessage.CastSignal).message.signal is RtcSignal.Answer)

        val ice = """{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"ice","candidate":"candidate:1 1 udp 1 10.0.0.1 1 typ host","sdpMid":"0","sdpMLineIndex":0}}"""
        assertTrue(parseServerMessage(ice) is ParsedServerMessage.CastSignal)

        val stop = """{"type":"cast_stop","protocolVersion":1,"sessionId":"$castSessionId","reason":"viewer_stopped"}"""
        val parsedStop = parseServerMessage(stop)
        assertTrue(parsedStop is ParsedServerMessage.CastStop)
        assertEquals("viewer_stopped", (parsedStop as ParsedServerMessage.CastStop).message.reason)
    }

    @Test fun `parseServerMessage rejects malformed, wrong-version, bad-id and wrong-direction frames`() {
        assertNull(parseServerMessage("not json"))
        assertNull(parseServerMessage("42"))
        assertNull(parseServerMessage("""{"type":"cast_request","protocolVersion":2,"sessionId":"$castSessionId","expiresAt":"2026-10-09T12:00:00.000Z"}"""))
        assertNull(parseServerMessage("""{"type":"cast_request","protocolVersion":1,"sessionId":"not-a-uuid","expiresAt":"2026-10-09T12:00:00.000Z"}"""))
        assertNull(parseServerMessage("""{"type":"cast_request","protocolVersion":1,"sessionId":"$castSessionId","expiresAt":"yesterday"}"""))
        assertNull(parseServerMessage("""{"type":"cast_stop","protocolVersion":1,"sessionId":"$castSessionId","reason":"because"}"""))
        assertNull(parseServerMessage("""{"type":"nonsense","protocolVersion":1}"""))
        // The server must never send an offer to the agent that is always the offerer.
        assertNull(parseServerMessage("""{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"offer","sdp":"v=0"}}"""))
        assertNull(parseServerMessage("""{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"bogus","sdp":"v=0"}}"""))
    }

    @Test fun `parseServerMessage bounds SDP and ICE exactly at the shared caps`() {
        val maxSdp = "x".repeat(MAX_CAST_SDP_CHARS)
        val overSdp = "x".repeat(MAX_CAST_SDP_CHARS + 1)
        assertNotNull(
            parseServerMessage("""{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"answer","sdp":"$maxSdp"}}""")
        )
        assertNull(
            parseServerMessage("""{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"answer","sdp":"$overSdp"}}""")
        )
        val maxIce = "c".repeat(MAX_CAST_ICE_CHARS)
        val overIce = "c".repeat(MAX_CAST_ICE_CHARS + 1)
        assertNotNull(
            parseServerMessage("""{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"ice","candidate":"$maxIce"}}""")
        )
        assertNull(
            parseServerMessage("""{"type":"cast_signal","protocolVersion":1,"sessionId":"$castSessionId","signal":{"kind":"ice","candidate":"$overIce"}}""")
        )
    }

    @Test fun `parseLaunchCommand remains a compatibility wrapper`() {
        val good = """{"type":"command","protocolVersion":1,"commandId":"c1","command":"launch_app","payload":{"gameId":"beat-saber","gameName":"Beat Saber","metaAppId":"123"}}"""
        assertNotNull(parseLaunchCommand(good))
        assertNull(parseLaunchCommand("""{"type":"error","protocolVersion":1,"code":"X","message":"y"}"""))
        assertNull(parseLaunchCommand("""{"type":"cast_request","protocolVersion":1,"sessionId":"$castSessionId","expiresAt":"2026-10-09T12:00:00.000Z"}"""))
        assertNull(parseLaunchCommand("not json"))
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

    @Test fun `parseServerMessage reads a controller monitoring frame`() {
        val on = parseServerMessage("""{"type":"controller_monitoring","protocolVersion":1,"enabled":true}""")
        assertTrue(on is ParsedServerMessage.ControllerMonitoring)
        assertTrue((on as ParsedServerMessage.ControllerMonitoring).message.enabled)
        val off = parseServerMessage("""{"type":"controller_monitoring","protocolVersion":1,"enabled":false}""")
        assertFalse((off as ParsedServerMessage.ControllerMonitoring).message.enabled)
    }

    @Test fun `parseServerMessage rejects malformed monitoring frames`() {
        for (raw in listOf(
            """{"type":"controller_monitoring","protocolVersion":1}""",
            """{"type":"controller_monitoring","protocolVersion":1,"enabled":"true"}""",
            """{"type":"controller_monitoring","protocolVersion":1,"enabled":1}""",
            """{"type":"controller_monitoring","protocolVersion":1,"enabled":null}""",
            """{"type":"controller_monitoring","protocolVersion":2,"enabled":true}""",
            """{"type":"controller_monitoring","enabled":true}""",
        )) {
            assertNull(raw, parseServerMessage(raw))
        }
    }

    @Test fun `telemetry carries wirelessDebugging and omits it when unset`() {
        val withState = protocolJson.encodeToString(
            Telemetry(
                deviceId = "d",
                timestamp = "2026-10-10T00:00:00Z",
                battery = Battery(80, false),
                agent = AgentState(true),
                wirelessDebugging = "off",
            )
        )
        assertTrue(withState.contains("\"wirelessDebugging\":\"off\""))
        val without = protocolJson.encodeToString(
            Telemetry(
                deviceId = "d",
                timestamp = "2026-10-10T00:00:00Z",
                battery = Battery(80, false),
                agent = AgentState(true),
            )
        )
        assertFalse(without.contains("wirelessDebugging"))
    }
}
