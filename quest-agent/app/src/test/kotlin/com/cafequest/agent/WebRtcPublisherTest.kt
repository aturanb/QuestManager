package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WebRtcPublisherTest {
    private class FakeGrant : ProjectionGrant

    private class FakePeer(private val offerSdp: String = "v=0-offer") : RtcPeer {
        var starts = 0
        var closes = 0
        var startError: Throwable? = null
        val answers = mutableListOf<String>()
        val ices = mutableListOf<RtcSignal.Ice>()

        override suspend fun start(profile: CastVideoProfile): String {
            starts++
            startError?.let { throw it }
            return offerSdp
        }

        override suspend fun setRemoteAnswer(sdp: String) {
            answers += sdp
        }

        override suspend fun addRemoteIce(candidate: RtcSignal.Ice) {
            ices += candidate
        }

        override fun close() {
            closes++
        }
    }

    private class Harness(
        val peer: FakePeer = FakePeer(),
        val throwOnCreate: Boolean = false,
        val emitEarlyIce: Boolean = false,
    ) {
        val signals = mutableListOf<RtcSignal>()
        val stopped = mutableListOf<String?>()
        val profiles = mutableListOf<CastVideoProfile>()
        var connectedCount = 0
        var createCalls = 0
        var localSink: ((RtcSignal) -> Unit)? = null
        var stateSink: ((RtcPeerState) -> Unit)? = null

        private val events = object : PublisherEvents {
            override fun onLocalSignal(signal: RtcSignal) {
                signals += signal
            }

            override fun onConnected() {
                connectedCount++
            }

            override fun onStopped(error: String?) {
                stopped += error
            }
        }

        private val factory = RtcPeerFactory { _, profile, onLocalSignal, onState ->
            createCalls++
            profiles += profile
            localSink = onLocalSignal
            stateSink = onState
            if (emitEarlyIce) onLocalSignal(RtcSignal.Ice("early"))
            if (throwOnCreate) throw IllegalStateException("runtime failure: should never reach the wire")
            peer
        }

        val publisher: CastPublisher = WebRtcPublisher(FakeGrant(), factory, events)
    }

    @Test
    fun `the support profile is exactly 960x540 at 15 fps under 1_5 Mbps`() {
        assertEquals(CastVideoProfile(960, 540, 15, 1_500_000), CastVideoProfile.SUPPORT)
    }

    @Test
    fun `start uses the exact support profile and emits one offer`() = runTest {
        val h = Harness()
        h.publisher.start()
        assertEquals(listOf(CastVideoProfile(960, 540, 15, 1_500_000)), h.profiles)
        assertEquals(listOf<RtcSignal>(RtcSignal.Offer("v=0-offer")), h.signals)
        assertEquals(1, h.peer.starts)
    }

    @Test
    fun `local ICE is forwarded after the offer and in order`() = runTest {
        val h = Harness()
        h.publisher.start()
        h.localSink!!(RtcSignal.Ice("ice-1"))
        h.localSink!!(RtcSignal.Ice("ice-2"))
        assertEquals(
            listOf<RtcSignal>(RtcSignal.Offer("v=0-offer"), RtcSignal.Ice("ice-1"), RtcSignal.Ice("ice-2")),
            h.signals,
        )
    }

    @Test
    fun `ICE trickled before the offer is buffered behind it`() = runTest {
        val h = Harness(emitEarlyIce = true)
        h.publisher.start()
        assertEquals(listOf<RtcSignal>(RtcSignal.Offer("v=0-offer"), RtcSignal.Ice("early")), h.signals)
    }

    @Test
    fun `remote answer and ICE are delegated but a remote offer is rejected`() = runTest {
        val h = Harness()
        h.publisher.start()
        h.publisher.handle(RtcSignal.Answer("v=0-answer"))
        h.publisher.handle(RtcSignal.Ice("candidate:remote"))
        h.publisher.handle(RtcSignal.Offer("v=0-remote-offer"))
        assertEquals(listOf("v=0-answer"), h.peer.answers)
        assertEquals(listOf<RtcSignal.Ice>(RtcSignal.Ice("candidate:remote")), h.peer.ices)
    }

    @Test
    fun `peer CONNECTED reports a connected publisher`() = runTest {
        val h = Harness()
        h.publisher.start()
        h.stateSink!!(RtcPeerState.CONNECTED)
        assertEquals(1, h.connectedCount)
        assertEquals(emptyList<String?>(), h.stopped)
    }

    @Test
    fun `failed, closed, and a revoked projection each report one terminal callback and close once`() = runTest {
        val cases = listOf(
            RtcPeerState.FAILED to CastFailure.PEER_DISCONNECTED,
            RtcPeerState.CLOSED to CastFailure.PEER_DISCONNECTED,
            RtcPeerState.PROJECTION_STOPPED to CastFailure.PROJECTION_STOPPED,
        )
        for ((state, expected) in cases) {
            val h = Harness()
            h.publisher.start()
            h.stateSink!!(state)
            assertEquals(listOf(expected), h.stopped)
            assertEquals(1, h.peer.closes)
            // A second cause cannot produce a second terminal event or close.
            h.stateSink!!(RtcPeerState.FAILED)
            h.publisher.stop()
            assertEquals(listOf(expected), h.stopped)
            assertEquals(1, h.peer.closes)
        }
    }

    @Test
    fun `an explicit stop reports one clean terminal callback`() = runTest {
        val h = Harness()
        h.publisher.start()
        h.publisher.stop()
        h.publisher.stop()
        assertEquals(listOf<String?>(null), h.stopped)
        assertEquals(1, h.peer.closes)
    }

    @Test
    fun `start failure maps to capture_failed without an exception string`() = runTest {
        val factoryFailed = Harness(throwOnCreate = true)
        factoryFailed.publisher.start()
        assertEquals(listOf(CastFailure.CAPTURE_FAILED), factoryFailed.stopped)
        assertEquals(emptyList<RtcSignal>(), factoryFailed.signals)

        val peerFailed = Harness()
        peerFailed.peer.startError = IllegalStateException("secret hardware detail")
        peerFailed.publisher.start()
        assertEquals(listOf(CastFailure.CAPTURE_FAILED), peerFailed.stopped)
        assertTrue(peerFailed.stopped.none { it?.contains("secret") == true })
        assertEquals(1, peerFailed.peer.closes)
    }

    @Test
    fun `a stopped publisher cannot reuse its one-use projection grant`() = runTest {
        val h = Harness()
        h.publisher.start()
        h.publisher.stop()
        h.publisher.start()
        assertEquals(1, h.createCalls)
        assertEquals(1, h.peer.starts)
        assertEquals(1, h.signals.size)
        assertEquals(1, h.peer.closes)
    }

    @Test
    fun `handle after a terminal state is a no-op`() = runTest {
        val h = Harness()
        h.publisher.start()
        h.publisher.stop()
        h.publisher.handle(RtcSignal.Answer("v=0-late"))
        h.publisher.handle(RtcSignal.Ice("late"))
        assertEquals(emptyList<String>(), h.peer.answers)
        assertEquals(emptyList<RtcSignal.Ice>(), h.peer.ices)
        assertEquals(1, h.peer.closes)
    }
}
