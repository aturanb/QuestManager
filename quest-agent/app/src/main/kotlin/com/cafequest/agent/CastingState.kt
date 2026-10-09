package com.cafequest.agent

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the headset UI shows for the live-view feature. */
enum class CastingPhase { IDLE, AWAITING_APPROVAL, NEGOTIATING, LIVE, FAILED }

data class CastingUiState(
    val phase: CastingPhase = CastingPhase.IDLE,
    val sessionId: String? = null,
    val error: String? = null,
)

/** Observable casting state shared by the service and Compose screens. */
class CastingStateStore {
    private val _state = MutableStateFlow(CastingUiState())
    val state: StateFlow<CastingUiState> = _state.asStateFlow()

    fun set(next: CastingUiState) {
        _state.value = next
    }
}

/**
 * One-use Quest MediaProjection consent result. The controller only passes it to
 * the publisher factory; it is never cached, logged, or reused.
 */
interface ProjectionGrant

/** Sends bounded cast frames over the current agent socket. */
interface CastingTransport {
    fun sendStatus(sessionId: String, status: String, error: String? = null): Boolean
    fun sendSignal(sessionId: String, signal: RtcSignal): Boolean
}

/** One capture session's WebRTC publisher, created after consent. */
interface CastPublisher {
    suspend fun start()
    suspend fun handle(signal: RtcSignal)
    fun stop()
}

/** Publisher → controller callbacks: local signaling, connection, and one terminal event. */
interface PublisherEvents {
    fun onLocalSignal(signal: RtcSignal)
    fun onConnected()
    /** `error` is a stable failure code, or null for a clean stop. */
    fun onStopped(error: String?)
}

/** Creates (but does not start) a publisher for an approved grant. */
interface CastPublisherFactory {
    fun create(grant: ProjectionGrant, events: PublisherEvents): CastPublisher
}

/** Maps any publisher string to a bounded stable code; anything unknown is internal_error. */
fun stableCastFailure(code: String?): String =
    if (code != null && code in CastFailure.ALL) code else CastFailure.INTERNAL_ERROR

/** Intent actions the activity and notification send to the casting service. */
object CastAction {
    const val APPROVED = "com.cafequest.agent.CAST_APPROVED"
    const val DENIED = "com.cafequest.agent.CAST_DENIED"
    const val STOP = "com.cafequest.agent.CAST_STOP"
}

/** Mirrors android.app.Activity.RESULT_OK without pulling Android into this decision. */
const val CAST_RESULT_OK = -1

/** One validated cast service action; anything else is [None]. */
sealed interface CastServiceAction {
    data class Approve(val sessionId: String) : CastServiceAction
    data class Deny(val sessionId: String) : CastServiceAction
    data class Stop(val sessionId: String) : CastServiceAction
    data object None : CastServiceAction
}

/**
 * Validates one cast service action before anything touches MediaProjection.
 * Malformed, unknown, or non-matching actions (including an activity result for
 * a session the controller no longer holds) become [None], so a stale consent
 * dialog can never promote the service or start a publisher.
 */
fun parseCastServiceAction(
    action: String?,
    sessionId: String?,
    resultCode: Int?,
    hasResultData: Boolean,
    currentSessionId: String?,
): CastServiceAction {
    val id = sessionId?.takeIf { isCastSessionId(it) } ?: return CastServiceAction.None
    if (id != currentSessionId) return CastServiceAction.None
    return when (action) {
        CastAction.APPROVED ->
            if (resultCode == CAST_RESULT_OK && hasResultData) CastServiceAction.Approve(id) else CastServiceAction.None
        CastAction.DENIED -> CastServiceAction.Deny(id)
        CastAction.STOP -> CastServiceAction.Stop(id)
        else -> CastServiceAction.None
    }
}
