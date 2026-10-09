package com.cafequest.agent

import java.net.Inet4Address
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {
    private val cafePc = FoundServer("CAFE-PC", "192.168.1.150", 3000)
    private val laptop = FoundServer("Turans-MacBook-Air", "192.168.1.20", 3000)

    private fun v4(text: String) = InetAddress.getByName(text) as Inet4Address

    @Test fun `constants match shared discovery ts`() {
        assertEquals(3000, DISCOVERY_PORT)
        assertEquals(512, MAX_DISCOVERY_BYTES)
    }

    @Test fun `the probe is exactly the shared probe shape`() {
        assertEquals("""{"type":"cafequest_discover"}""", encodeDiscoveryProbe().toString(Charsets.UTF_8))
    }

    @Test fun `a reply becomes a server at the address it came from`() {
        assertEquals(
            FoundServer("CAFE-PC", "192.168.1.150", 3000),
            parseDiscoveryReply("""{"type":"cafequest_server","name":"CAFE-PC","port":3000}""", "192.168.1.150"),
        )
    }

    @Test fun `anything that is not a valid reply is ignored`() {
        val junk = listOf(
            "",
            "hello",
            """{"type":"cafequest_discover"}""",
            """{"type":"cafequest_server","name":"","port":3000}""",
            """{"type":"cafequest_server","name":"${"x".repeat(65)}","port":3000}""",
            """{"type":"cafequest_server","name":"PC","port":0}""",
            """{"type":"cafequest_server","name":"PC","port":65536}""",
            """{"type":"cafequest_server","name":"PC"}""",
            """{"type":"cafequest_server","port":3000}""",
        )
        for (raw in junk) assertNull(raw, parseDiscoveryReply(raw, "192.168.1.150"))
    }

    @Test fun `with no remembered PC the first answer wins`() {
        assertEquals(laptop, chooseServer(listOf(laptop, cafePc), rememberedName = null))
        assertNull(chooseServer(emptyList(), rememberedName = null))
    }

    @Test fun `a remembered PC is the only one accepted`() {
        assertEquals(cafePc, chooseServer(listOf(laptop, cafePc), rememberedName = "CAFE-PC"))
        // The café PC is down and only the laptop answers: stay put rather than move.
        assertNull(chooseServer(listOf(laptop), rememberedName = "CAFE-PC"))
    }

    @Test fun `a blank remembered name counts as none`() {
        assertEquals(laptop, chooseServer(listOf(laptop), rememberedName = " "))
    }

    @Test fun `auto searches with no address or after three failed connects`() {
        assertTrue(shouldSearch(ServerMode.AUTO, "", failedAttempts = 0))
        assertFalse(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 0))
        assertFalse(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 2))
        assertTrue(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 3))
        assertTrue(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 9))
    }

    @Test fun `manual never searches`() {
        assertFalse(shouldSearch(ServerMode.MANUAL, "192.168.1.77", failedAttempts = 50))
        assertFalse(shouldSearch(ServerMode.MANUAL, "", failedAttempts = 0))
    }

    @Test fun `stored modes read back, and anything else is auto`() {
        assertEquals(ServerMode.MANUAL, ServerMode.fromStored("manual"))
        assertEquals(ServerMode.AUTO, ServerMode.fromStored("auto"))
        assertEquals(ServerMode.AUTO, ServerMode.fromStored(null))
        assertEquals(ServerMode.AUTO, ServerMode.fromStored("MANUAL"))
    }

    @Test fun `targets are the all-ones address plus each subnet broadcast`() {
        val targets = broadcastTargets(listOf(v4("192.168.1.150") to 24, v4("10.0.5.7") to 16))
        assertEquals(listOf("255.255.255.255", "192.168.1.255", "10.0.255.255"), targets.map { it.hostAddress })
    }

    @Test fun `point-to-point links and duplicates add nothing`() {
        val targets = broadcastTargets(
            listOf(v4("192.168.1.150") to 32, v4("192.168.1.151") to 31, v4("192.168.1.150") to 24, v4("192.168.1.9") to 24),
        )
        assertEquals(listOf("255.255.255.255", "192.168.1.255"), targets.map { it.hostAddress })
        assertEquals(listOf("255.255.255.255"), broadcastTargets(emptyList()).map { it.hostAddress })
    }
}
