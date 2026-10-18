package com.cafequest.agent

/**
 * Opens the system consent flow once for each newly awaiting cast session, and
 * takes it down again if the session ends before the customer answers (admin
 * stop, timeout, replacement) so no selector is left over their game. An
 * answered prompt removes itself, so only unanswered ones are dismissed.
 */
class CastConsentPromptGate(
    private val prompt: (String) -> Unit,
    private val dismiss: (String) -> Unit,
) {
    private var openSessionId: String? = null
    private var promptedSessionId: String? = null

    fun onState(state: CastingUiState) {
        val open = openSessionId
        if (open != null && !(state.phase == CastingPhase.AWAITING_APPROVAL && state.sessionId == open)) {
            openSessionId = null
            if (!answered(state, open)) dismiss(open)
        }
        val sessionId = state.sessionId ?: return
        if (state.phase != CastingPhase.AWAITING_APPROVAL || sessionId == promptedSessionId) return
        promptedSessionId = sessionId
        openSessionId = sessionId
        prompt(sessionId)
    }

    private fun answered(state: CastingUiState, sessionId: String): Boolean {
        if (state.sessionId != sessionId) return false
        return state.phase == CastingPhase.NEGOTIATING ||
            state.phase == CastingPhase.LIVE ||
            (state.phase == CastingPhase.FAILED && state.error == CastFailure.CONSENT_DENIED)
    }
}
