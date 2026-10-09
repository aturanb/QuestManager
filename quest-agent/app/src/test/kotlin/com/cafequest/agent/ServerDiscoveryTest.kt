package com.cafequest.agent

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real UDP on loopback: a fake café PC answers, ServerDiscovery listens. */
class ServerDiscoveryTest {
    private val loopback = InetAddress.getLoopbackAddress()
    private val sockets = mutableListOf<DatagramSocket>()

    @After fun closeSockets() = sockets.forEach { it.close() }

    /** A fake café PC: answers every valid probe with each of [replies] as its own datagram. */
    private fun responder(vararg replies: String): DatagramSocket {
        val socket = DatagramSocket(0, loopback).also(sockets::add)
        Thread {
            val buffer = ByteArray(MAX_DISCOVERY_BYTES)
            while (!socket.isClosed) {
                val probe = DatagramPacket(buffer, buffer.size)
                try { socket.receive(probe) } catch (_: Exception) { return@Thread }
                if (String(probe.data, 0, probe.length, Charsets.UTF_8) != """{"type":"cafequest_discover"}""") continue
                for (reply in replies) {
                    val bytes = reply.toByteArray(Charsets.UTF_8)
                    socket.send(DatagramPacket(bytes, bytes.size, probe.address, probe.port))
                }
            }
        }.apply { isDaemon = true }.start()
        return socket
    }

    private fun discovery(port: Int, targets: () -> List<InetAddress> = { listOf(loopback) }) =
        ServerDiscovery(targets = targets, port = port, windowMs = 400, probes = 3, gapMs = 50)

    @Test fun `answers are deduped across probes, kept in arrival order, and junk is skipped`() = runBlocking {
        val pc = responder(
            "not json",
            """{"type":"cafequest_server","name":"CAFE-PC","port":3000}""",
            """{"type":"cafequest_server","name":"DEV-LAPTOP","port":3001}""",
        )
        val host = loopback.hostAddress
        assertEquals(
            listOf(FoundServer("CAFE-PC", host, 3000), FoundServer("DEV-LAPTOP", host, 3001)),
            discovery(pc.localPort).search(),
        )
    }

    @Test fun `silence means nothing found once the window closes`() = runBlocking {
        val quiet = DatagramSocket(0, loopback).also(sockets::add) // bound, never answers
        val started = System.currentTimeMillis()
        assertEquals(emptyList<FoundServer>(), discovery(quiet.localPort).search())
        assertTrue(System.currentTimeMillis() - started < 2_000)
    }

    @Test fun `no network reads as nothing found, never a crash`() = runBlocking {
        val broken = discovery(DISCOVERY_PORT) { throw IllegalStateException("Wi-Fi off") }
        assertEquals(emptyList<FoundServer>(), broken.search())
    }
}
