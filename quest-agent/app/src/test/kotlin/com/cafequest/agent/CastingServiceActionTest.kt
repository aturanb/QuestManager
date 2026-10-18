package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The activity result reaches the service as an intent action. These tests pin
 * the pure validation: only a well-formed action naming the session the
 * controller currently holds may touch the projection.
 */
class CastingServiceActionTest {
    private val session = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"
    private val otherSession = "2a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"
    private val expires = "2026-10-09T12:00:00.000Z"

    private class FakeGrant : ProjectionGrant

    private class RecordingPublisher : CastPublisher {
        var stopped = 0
        override suspend fun start() = Unit
        override suspend fun handle(signal: RtcSignal) = Unit
        override fun stop() { stopped++ }
    }

    private class RecordingFactory : CastPublisherFactory {
        var created = 0
        override fun create(grant: ProjectionGrant, events: PublisherEvents): CastPublisher {
            created++
            return RecordingPublisher()
        }
    }

    private class FakeTransport : CastingTransport {
        val statuses = mutableListOf<Triple<String, String, String?>>()
        override fun sendStatus(sessionId: String, status: String, error: String?): Boolean {
            statuses += Triple(sessionId, status, error)
            return true
        }
        override fun sendSignal(sessionId: String, signal: RtcSignal): Boolean = true
    }

    private fun approveAction(
        action: String? = CastAction.APPROVED,
        sessionId: String? = session,
        resultCode: Int? = CAST_RESULT_OK,
        hasResultData: Boolean = true,
        currentSessionId: String? = session,
    ) = parseCastServiceAction(action, sessionId, resultCode, hasResultData, currentSessionId)

    @Test
    fun `an approved result for the current session becomes an approve action`() {
        assertEquals(CastServiceAction.Approve(session), approveAction())
    }

    @Test
    fun `a denied result for the current session becomes a deny action`() {
        assertEquals(
            CastServiceAction.Deny(session),
            approveAction(action = CastAction.DENIED, resultCode = null, hasResultData = false),
        )
    }

    @Test
    fun `a user stop becomes a stop action for the current session`() {
        assertEquals(
            CastServiceAction.Stop(session),
            approveAction(action = CastAction.STOP, resultCode = null, hasResultData = false),
        )
    }

    @Test
    fun `malformed and unknown inputs are ignored`() {
        assertEquals(CastServiceAction.None, approveAction(action = null))
        assertEquals(CastServiceAction.None, approveAction(action = "android.intent.action.MAIN"))
        assertEquals(CastServiceAction.None, approveAction(sessionId = null))
        assertEquals(CastServiceAction.None, approveAction(sessionId = ""))
        assertEquals(CastServiceAction.None, approveAction(sessionId = "not-a-uuid"))
        // A cancelled dialog (no OK result) must never be promoted.
        assertEquals(CastServiceAction.None, approveAction(resultCode = 0))
        assertEquals(CastServiceAction.None, approveAction(resultCode = null))
        assertEquals(CastServiceAction.None, approveAction(hasResultData = false))
    }

    @Test
    fun `actions naming a session the controller does not hold are ignored`() {
        assertEquals(CastServiceAction.None, approveAction(sessionId = otherSession, currentSessionId = session))
        assertEquals(CastServiceAction.None, approveAction(currentSessionId = null))
        assertEquals(
            CastServiceAction.None,
            approveAction(action = CastAction.STOP, resultCode = null, hasResultData = false, currentSessionId = otherSession),
        )
        assertEquals(
            CastServiceAction.None,
            approveAction(action = CastAction.DENIED, resultCode = null, hasResultData = false, currentSessionId = null),
        )
    }

    /** The positive control: without it the stale test below could pass vacuously. */
    @Test
    fun `a current approval creates exactly one publisher`() = runTest {
        val factory = RecordingFactory()
        val controller = CastingController(factory)
        controller.attachTransport(FakeTransport())
        controller.onRequest(CastRequestMessage(sessionId = session, expiresAt = expires))

        val action = approveAction(currentSessionId = controller.state.value.sessionId)
        assertTrue(action is CastServiceAction.Approve)

        controller.approve((action as CastServiceAction.Approve).sessionId, FakeGrant())
        assertEquals(1, factory.created)
        assertEquals(CastingPhase.NEGOTIATING, controller.state.value.phase)
    }

    @Test
    fun `a stale activity result never reaches the publisher`() = runTest {
        val factory = RecordingFactory()
        val controller = CastingController(factory)
        controller.attachTransport(FakeTransport())
        controller.onRequest(CastRequestMessage(sessionId = session, expiresAt = expires))
        // The server stops the session while the Quest consent dialog is still open.
        controller.onStop(CastStopMessage(sessionId = session, reason = CastStopReason.APPROVAL_TIMEOUT))

        var promoted = false
        val action = approveAction(currentSessionId = controller.state.value.sessionId)
        if (action is CastServiceAction.Approve) {
            promoted = true
            controller.approve(action.sessionId, FakeGrant())
        }

        assertEquals(CastServiceAction.None, action)
        assertFalse("a stale result must not promote the service", promoted)
        assertEquals(0, factory.created)
        assertEquals(CastingPhase.IDLE, controller.state.value.phase)
    }
}
