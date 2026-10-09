package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CastingControllerTest {
    private val session = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"
    private val otherSession = "2a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"
    private val expires = "2026-10-09T12:00:00.000Z"

    private class FakeTransport : CastingTransport {
        val statuses = mutableListOf<Triple<String, String, String?>>()
        val signals = mutableListOf<Pair<String, RtcSignal>>()
        override fun sendStatus(sessionId: String, status: String, error: String?): Boolean {
            statuses += Triple(sessionId, status, error)
            return true
        }
        override fun sendSignal(sessionId: String, signal: RtcSignal): Boolean {
            signals += sessionId to signal
            return true
        }
        fun lastStatus(): Triple<String, String, String?>? = statuses.lastOrNull()
    }

    private class FakePublisher : CastPublisher {
        var started = 0
        var stopped = 0
        val handled = mutableListOf<RtcSignal>()
        override suspend fun start() { started++ }
        override suspend fun handle(signal: RtcSignal) { handled += signal }
        override fun stop() { stopped++ }
    }

    private class FakeGrant : ProjectionGrant

    private class FakeFactory : CastPublisherFactory {
        val created = mutableListOf<FakePublisher>()
        val grants = mutableListOf<ProjectionGrant>()
        var events: PublisherEvents? = null
        override fun create(grant: ProjectionGrant, events: PublisherEvents): CastPublisher {
            grants += grant
            this.events = events
            val publisher = FakePublisher()
            created += publisher
            return publisher
        }
    }

    private class Harness {
        val factory = FakeFactory()
        val controller = CastingController(factory)
        val transport = FakeTransport()
        init {
            controller.attachTransport(transport)
        }
        fun request(id: String, at: String = "2026-10-09T12:00:00.000Z") {
            controller.onRequest(CastRequestMessage(sessionId = id, expiresAt = at))
        }
        fun publisher(): FakePublisher = factory.created.single()
    }

    private fun stopMessage(id: String) = CastStopMessage(sessionId = id, reason = CastStopReason.VIEWER_STOPPED)

    @Test
    fun `a request stores one session, shows awaiting approval, and reports status`() {
        val h = Harness()
        h.request(session)
        assertEquals(CastingPhase.AWAITING_APPROVAL, h.controller.state.value.phase)
        assertEquals(session, h.controller.state.value.sessionId)
        assertEquals(Triple(session, CastStatus.AWAITING_APPROVAL, null), h.transport.lastStatus())
    }

    @Test
    fun `a duplicate request is idempotent and a different one cannot replace the active session`() {
        val h = Harness()
        h.request(session)
        h.request(session)
        assertEquals(2, h.transport.statuses.size)
        assertEquals(0, h.factory.created.size)

        h.request(otherSession)
        assertEquals(session, h.controller.state.value.sessionId)
        assertEquals("a different request is refused", 2, h.transport.statuses.size)
    }

    @Test
    fun `approval from the matching awaiting session creates and starts exactly one publisher`() = runTest {
        val h = Harness()
        h.request(session)
        val grant = FakeGrant()
        h.controller.approve(session, grant)

        assertEquals(1, h.factory.created.size)
        assertEquals(1, h.factory.created.single().started)
        assertEquals(listOf(grant), h.factory.grants)
        assertEquals(CastingPhase.NEGOTIATING, h.controller.state.value.phase)
        assertTrue(h.transport.statuses.contains(Triple(session, CastStatus.NEGOTIATING, null)))

        // Consent is one-use: a second approval for the same session is ignored.
        h.controller.approve(session, FakeGrant())
        assertEquals(1, h.factory.created.size)
    }

    @Test
    fun `late and mismatched grants never create a publisher`() {
        val requested = Harness()
        requested.request(session)
        runTest { requested.controller.approve(otherSession, FakeGrant()) }
        assertEquals(0, requested.factory.created.size)

        val stopped = Harness()
        stopped.request(session)
        stopped.controller.onStop(stopMessage(session))
        runTest { stopped.controller.approve(session, FakeGrant()) }
        assertEquals(0, stopped.factory.created.size)

        val denied = Harness()
        denied.request(session)
        denied.controller.deny(session)
        runTest { denied.controller.approve(session, FakeGrant()) }
        assertEquals(0, denied.factory.created.size)
    }

    @Test
    fun `denial reports consent_denied and returns a terminal UI state`() {
        val h = Harness()
        h.request(session)
        h.controller.deny(session)
        assertEquals(CastingPhase.FAILED, h.controller.state.value.phase)
        assertEquals(CastFailure.CONSENT_DENIED, h.controller.state.value.error)
        assertTrue(h.transport.statuses.contains(Triple(session, CastStatus.FAILED, CastFailure.CONSENT_DENIED)))
    }

    @Test
    fun `answer and ICE reach the matching publisher while an offer or wrong session does not`() = runTest {
        val h = Harness()
        h.request(session)
        h.controller.approve(session, FakeGrant())
        val answer = ServerCastSignalMessage(sessionId = session, signal = RtcSignal.Answer("v=0-answer"))
        val ice = ServerCastSignalMessage(sessionId = session, signal = RtcSignal.Ice("candidate:1"))
        h.controller.onSignal(answer)
        h.controller.onSignal(ice)
        h.controller.onSignal(ServerCastSignalMessage(sessionId = session, signal = RtcSignal.Offer("v=0-offer")))
        h.controller.onSignal(ServerCastSignalMessage(sessionId = otherSession, signal = RtcSignal.Answer("v=0-other")))

        assertEquals(listOf<RtcSignal>(RtcSignal.Answer("v=0-answer"), RtcSignal.Ice("candidate:1")), h.publisher().handled)
    }

    @Test
    fun `publisher local signals use the bound transport and connected reports live`() = runTest {
        val h = Harness()
        h.request(session)
        h.controller.approve(session, FakeGrant())

        h.factory.events!!.onLocalSignal(RtcSignal.Offer("v=0-offer"))
        assertEquals(session to RtcSignal.Offer("v=0-offer"), h.transport.signals.last())

        h.factory.events!!.onConnected()
        assertEquals(CastingPhase.LIVE, h.controller.state.value.phase)
        assertEquals(Triple(session, CastStatus.LIVE, null), h.transport.lastStatus())
    }

    @Test
    fun `attaching a replacement transport never migrates an existing cast`() = runTest {
        val h = Harness()
        h.request(session)
        h.controller.approve(session, FakeGrant())
        val replacement = FakeTransport()
        h.controller.attachTransport(replacement)

        h.factory.events!!.onLocalSignal(RtcSignal.Offer("v=0-offer"))
        assertTrue(h.transport.signals.isNotEmpty())
        assertTrue("the old socket keeps its session", replacement.signals.isEmpty())
        assertEquals(CastingPhase.NEGOTIATING, h.controller.state.value.phase)

        // The old socket dying ends capture rather than migrating it.
        h.controller.detachTransport(h.transport)
        assertEquals(CastingPhase.FAILED, h.controller.state.value.phase)
        assertEquals(CastFailure.PEER_DISCONNECTED, h.controller.state.value.error)
        assertEquals(1, h.publisher().stopped)
        assertTrue(replacement.signals.isEmpty())
    }

    @Test
    fun `publisher failures map only to allowed stable codes`() = runTest {
        val unknown = Harness()
        unknown.request(session)
        unknown.controller.approve(session, FakeGrant())
        unknown.factory.events!!.onStopped("java.lang.IllegalStateException: boom")
        assertEquals(CastingPhase.FAILED, unknown.controller.state.value.phase)
        assertEquals(CastFailure.INTERNAL_ERROR, unknown.controller.state.value.error)
        assertEquals(Triple(session, CastStatus.FAILED, CastFailure.INTERNAL_ERROR), unknown.transport.lastStatus())

        val known = Harness()
        known.request(session)
        known.controller.approve(session, FakeGrant())
        known.factory.events!!.onStopped(CastFailure.PROJECTION_STOPPED)
        assertEquals(CastFailure.PROJECTION_STOPPED, known.controller.state.value.error)
        assertEquals(Triple(session, CastStatus.FAILED, CastFailure.PROJECTION_STOPPED), known.transport.lastStatus())
    }

    @Test
    fun `server stop, user stop, transport loss, and shutdown each stop the publisher exactly once`() = runTest {
        val server = Harness()
        server.request(session)
        server.controller.approve(session, FakeGrant())
        server.controller.onStop(stopMessage(session))
        assertEquals(CastingPhase.IDLE, server.controller.state.value.phase)
        assertNull(server.controller.state.value.sessionId)
        assertEquals(1, server.publisher().stopped)
        // A later publisher callback cannot revive the dead session.
        server.factory.events!!.onStopped(CastFailure.PROJECTION_STOPPED)
        assertEquals(CastingPhase.IDLE, server.controller.state.value.phase)
        server.controller.onStop(stopMessage(session))
        assertEquals(1, server.publisher().stopped)
        assertEquals(0, server.transport.statuses.count { it.second == CastStatus.STOPPED })

        val user = Harness()
        user.request(session)
        user.controller.approve(session, FakeGrant())
        user.controller.stopByUser(session)
        assertEquals(CastingPhase.IDLE, user.controller.state.value.phase)
        assertEquals(1, user.publisher().stopped)
        assertTrue(user.transport.statuses.contains(Triple(session, CastStatus.STOPPED, null)))

        val lost = Harness()
        lost.request(session)
        lost.controller.approve(session, FakeGrant())
        lost.controller.detachTransport(lost.transport)
        assertEquals(1, lost.publisher().stopped)
        assertEquals(CastingPhase.FAILED, lost.controller.state.value.phase)

        val shutdown = Harness()
        shutdown.request(session)
        shutdown.controller.approve(session, FakeGrant())
        shutdown.controller.shutdown()
        assertEquals(1, shutdown.publisher().stopped)
        assertEquals(CastingPhase.IDLE, shutdown.controller.state.value.phase)
        assertNull(shutdown.controller.state.value.sessionId)
    }

    @Test
    fun `a clean publisher stop ends the session and reports stopped`() = runTest {
        val h = Harness()
        h.request(session)
        h.controller.approve(session, FakeGrant())
        h.factory.events!!.onStopped(null)
        assertEquals(CastingPhase.IDLE, h.controller.state.value.phase)
        assertTrue(h.transport.statuses.contains(Triple(session, CastStatus.STOPPED, null)))
        assertEquals(1, h.publisher().stopped)
    }

    @Test
    fun `a request with no attached transport is ignored`() {
        val factory = FakeFactory()
        val controller = CastingController(factory)
        controller.onRequest(CastRequestMessage(sessionId = session, expiresAt = expires))
        assertEquals(CastingPhase.IDLE, controller.state.value.phase)
        assertEquals(0, factory.created.size)
    }

    @Test
    fun `shutdown with no session is a no-op`() {
        val factory = FakeFactory()
        val controller = CastingController(factory)
        controller.shutdown()
        assertEquals(CastingPhase.IDLE, controller.state.value.phase)
        assertTrue(factory.created.isEmpty())
    }
}
