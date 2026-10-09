package com.cafequest.agent

import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The pure cast lifecycle: one pending request, one publisher, and idempotent
 * teardown. It has no Android or WebRTC dependency; the service injects a
 * transport bound to the live socket and a publisher factory bound to
 * MediaProjection + libWebRTC.
 */
class CastingController(
    private val publisherFactory: CastPublisherFactory,
    private val store: CastingStateStore = CastingStateStore(),
) {
    val state: StateFlow<CastingUiState> = store.state

    private val mutex = Mutex()
    /** Default transport for the next request; written by the service per socket. */
    private var transport: CastingTransport? = null
    private var active: Active? = null

    private class Active(
        val sessionId: String,
        var phase: CastingPhase,
        var transport: CastingTransport?,
        var publisher: CastPublisher? = null,
    )

    /** A new socket becomes the sender for future sessions; it never adopts a live one. */
    fun attachTransport(next: CastingTransport) {
        transport = next
    }

    /**
     * The socket that owned an active cast is gone: stop capture instead of
     * leaving an orphaned projection behind.
     */
    fun detachTransport(current: CastingTransport) {
        if (transport === current) transport = null
        val cast = active ?: return
        if (cast.transport === current) {
            finish(cast, CastingPhase.FAILED, notify = false, error = CastFailure.PEER_DISCONNECTED)
        }
    }

    /** One pending request; a duplicate is re-acknowledged, a different one is refused. */
    fun onRequest(message: CastRequestMessage) {
        val cast = active
        if (cast != null) {
            if (cast.sessionId == message.sessionId) {
                cast.transport?.sendStatus(message.sessionId, CastStatus.AWAITING_APPROVAL)
            }
            return
        }
        val bound = transport ?: return
        val next = Active(message.sessionId, CastingPhase.AWAITING_APPROVAL, bound)
        active = next
        store.set(CastingUiState(CastingPhase.AWAITING_APPROVAL, message.sessionId))
        bound.sendStatus(message.sessionId, CastStatus.AWAITING_APPROVAL)
    }

    /**
     * Consent granted for exactly the awaiting session: create and start one
     * publisher. A mismatched or late grant is discarded without touching the
     * one-use result.
     */
    suspend fun approve(sessionId: String, grant: ProjectionGrant) {
        mutex.withLock {
            val cast = active ?: return
            if (cast.sessionId != sessionId || cast.phase != CastingPhase.AWAITING_APPROVAL) return
            val bound = cast.transport ?: return
            val publisher = publisherFactory.create(grant, publisherEvents(cast))
            cast.publisher = publisher
            cast.phase = CastingPhase.NEGOTIATING
            store.set(CastingUiState(CastingPhase.NEGOTIATING, sessionId))
            bound.sendStatus(sessionId, CastStatus.NEGOTIATING)
            try {
                publisher.start()
            } catch (_: Throwable) {
                finish(cast, CastingPhase.FAILED, notify = true, status = CastStatus.FAILED, error = CastFailure.CAPTURE_FAILED)
            }
        }
    }

    /** Consent refused: report it and clear the request. */
    fun deny(sessionId: String) {
        val cast = active ?: return
        if (cast.sessionId != sessionId || cast.phase != CastingPhase.AWAITING_APPROVAL) return
        finish(cast, CastingPhase.FAILED, notify = true, status = CastStatus.FAILED, error = CastFailure.CONSENT_DENIED)
    }

    /** Server answer/ICE for the matching session; the agent is always the offerer. */
    suspend fun onSignal(message: ServerCastSignalMessage) {
        mutex.withLock {
            val cast = active ?: return
            if (cast.sessionId != message.sessionId) return
            if (cast.phase != CastingPhase.NEGOTIATING && cast.phase != CastingPhase.LIVE) return
            if (message.signal is RtcSignal.Offer) return
            val publisher = cast.publisher ?: return
            try {
                publisher.handle(message.signal)
            } catch (_: Throwable) {
                finish(cast, CastingPhase.FAILED, notify = true, status = CastStatus.FAILED, error = CastFailure.CAPTURE_FAILED)
            }
        }
    }

    /** The server ended the session; do not echo a status back. */
    fun onStop(message: CastStopMessage) {
        val cast = active ?: return
        if (cast.sessionId != message.sessionId) return
        finish(cast, CastingPhase.IDLE, notify = false)
    }

    /** The person wearing the headset pressed Stop sharing. */
    fun stopByUser(sessionId: String) {
        val cast = active ?: return
        if (cast.sessionId != sessionId) return
        finish(cast, CastingPhase.IDLE, notify = true, status = CastStatus.STOPPED)
    }

    /** The service is going away: stop one publisher, send nothing. */
    fun shutdown() {
        val cast = active ?: return
        finish(cast, CastingPhase.IDLE, notify = false)
        transport = null
    }

    private fun publisherEvents(cast: Active): PublisherEvents = object : PublisherEvents {
        override fun onLocalSignal(signal: RtcSignal) {
            if (active !== cast) return
            cast.transport?.sendSignal(cast.sessionId, signal)
        }

        override fun onConnected() {
            if (active !== cast || cast.phase != CastingPhase.NEGOTIATING) return
            cast.phase = CastingPhase.LIVE
            cast.transport?.sendStatus(cast.sessionId, CastStatus.LIVE)
            store.set(CastingUiState(CastingPhase.LIVE, cast.sessionId))
        }

        override fun onStopped(error: String?) {
            if (active !== cast) return
            if (error == null) {
                finish(cast, CastingPhase.IDLE, notify = true, status = CastStatus.STOPPED)
            } else {
                finish(cast, CastingPhase.FAILED, notify = true, status = CastStatus.FAILED, error = stableCastFailure(error))
            }
        }
    }

    /**
     * One idempotent terminal path. The active reference is cleared before any
     * transport or publisher callback so re-entrant cleanup sees a free slot.
     */
    private fun finish(
        cast: Active,
        phase: CastingPhase,
        notify: Boolean,
        status: String? = null,
        error: String? = null,
    ) {
        if (active !== cast) return
        active = null
        val publisher = cast.publisher
        cast.publisher = null
        if (notify && status != null) {
            cast.transport?.sendStatus(cast.sessionId, status, error)
        }
        publisher?.stop()
        store.set(
            if (phase == CastingPhase.IDLE) CastingUiState()
            else CastingUiState(phase, cast.sessionId, error)
        )
    }
}
