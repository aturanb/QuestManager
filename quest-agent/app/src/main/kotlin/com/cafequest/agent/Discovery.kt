package com.cafequest.agent

import android.content.Context
import android.net.ConnectivityManager
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/*
 * LAN discovery (docs/superpowers/specs/2026-10-09-server-discovery-design.md).
 * Hand-synced with shared/src/discovery.ts: same port, size cap and JSON shapes.
 */

/** UDP port the server answers probes on; fixed, independent of the server's PORT. */
const val DISCOVERY_PORT = 3000

/** Largest datagram either side sends or reads. */
const val MAX_DISCOVERY_BYTES = 512

/** Auto searches before every retry once this many connects in a row have failed. */
const val SEARCH_AFTER_FAILURES = 3

private const val PROBE_TYPE = "cafequest_discover"
private const val REPLY_TYPE = "cafequest_server"

@Serializable
private data class DiscoveryProbe(val type: String = PROBE_TYPE)

@Serializable
private data class DiscoveryReply(val type: String, val name: String, val port: Int)

/** A CafeQuest server that answered a probe; [host] is the reply's source address. */
data class FoundServer(val name: String, val host: String, val port: Int)

fun encodeDiscoveryProbe(): ByteArray = protocolJson.encodeToString(DiscoveryProbe()).toByteArray(Charsets.UTF_8)

/** One datagram as a server, or null for anything that is not a valid reply. Never throws. */
fun parseDiscoveryReply(text: String, fromHost: String): FoundServer? {
    val reply = runCatching { protocolJson.decodeFromString<DiscoveryReply>(text) }.getOrNull() ?: return null
    if (reply.type != REPLY_TYPE || reply.name.isEmpty() || reply.name.length > 64 || reply.port !in 1..65535) return null
    return FoundServer(name = reply.name, host = fromHost, port = reply.port)
}

/** Which answer to dial: only the remembered café PC, else the first answer (spec §3). */
fun chooseServer(found: List<FoundServer>, rememberedName: String?): FoundServer? =
    if (rememberedName.isNullOrBlank()) found.firstOrNull() else found.firstOrNull { it.name == rememberedName }

/** Auto searches with no address yet, or once [SEARCH_AFTER_FAILURES] connects in a row have failed; Manual never. */
fun shouldSearch(mode: ServerMode, savedHost: String, failedAttempts: Int): Boolean =
    mode == ServerMode.AUTO && (savedHost.isBlank() || failedAttempts >= SEARCH_AFTER_FAILURES)

/** 255.255.255.255 plus each IPv4 subnet's directed broadcast; some access points drop the all-ones address. */
fun broadcastTargets(subnets: List<Pair<Inet4Address, Int>>): List<InetAddress> {
    val targets = linkedSetOf<InetAddress>(InetAddress.getByAddress(byteArrayOf(-1, -1, -1, -1)))
    for ((address, prefixLength) in subnets) {
        if (prefixLength !in 1..30) continue // /31 and /32 links have no broadcast address
        val ip = address.address.fold(0) { acc, byte -> (acc shl 8) or (byte.toInt() and 0xFF) }
        val broadcast = ip or (-1 ushr prefixLength)
        targets += InetAddress.getByAddress(ByteArray(4) { i -> (broadcast ushr (24 - 8 * i)).toByte() })
    }
    return targets.toList()
}

/**
 * Broadcasts the probe and collects answers (spec §3): [probes] sends, [gapMs]
 * apart, to every target, listening until [windowMs] after the first. Answers
 * are deduped by address and port and kept in arrival order. Never throws: no
 * Wi-Fi or no route reads as "nothing found". No android.* calls, so it runs in
 * JVM tests against a loopback responder.
 */
class ServerDiscovery(
    private val targets: () -> List<InetAddress>,
    private val port: Int = DISCOVERY_PORT,
    private val windowMs: Long = 1_500,
    private val probes: Int = 3,
    private val gapMs: Long = 400,
) {
    suspend fun search(): List<FoundServer> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, FoundServer>()
        runCatching { collect(found) }
        found.values.toList()
    }

    private fun collect(found: MutableMap<String, FoundServer>) {
        val destinations = targets()
        val probe = encodeDiscoveryProbe()
        DatagramSocket().use { socket ->
            socket.broadcast = true
            val buffer = ByteArray(MAX_DISCOVERY_BYTES)
            val start = System.currentTimeMillis()
            val deadline = start + windowMs
            var sent = 0
            while (true) {
                val now = System.currentTimeMillis()
                if (sent < probes && now >= start + sent * gapMs) {
                    for (target in destinations) {
                        // One unreachable target (say, no route for 255.255.255.255) must not stop the others.
                        runCatching { socket.send(DatagramPacket(probe, probe.size, target, port)) }
                    }
                    sent++
                    continue
                }
                if (now >= deadline) break
                val wakeAt = if (sent < probes) minOf(start + sent * gapMs, deadline) else deadline
                socket.soTimeout = (wakeAt - now).coerceAtLeast(1).toInt()
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val host = packet.address?.hostAddress ?: continue
                val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                val server = parseDiscoveryReply(text, host) ?: continue
                found.putIfAbsent("${server.host}:${server.port}", server)
            }
        }
    }
}

/** Broadcast targets for the network the headset is on now: all-ones plus its subnet broadcast. */
fun wifiBroadcastTargets(context: Context): List<InetAddress> {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val links = connectivity?.getLinkProperties(connectivity.activeNetwork)?.linkAddresses.orEmpty()
    return broadcastTargets(links.mapNotNull { link -> (link.address as? Inet4Address)?.let { it to link.prefixLength } })
}
