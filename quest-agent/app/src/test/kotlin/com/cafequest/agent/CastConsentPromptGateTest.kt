package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class CastConsentPromptGateTest {
    private val prompts = mutableListOf<String>()
    private val dismissals = mutableListOf<String>()
    private val gate = CastConsentPromptGate(prompt = { prompts += it }, dismiss = { dismissals += it })

    private fun awaiting(id: String) = CastingUiState(CastingPhase.AWAITING_APPROVAL, id)

    @Test
    fun `an awaiting session opens one consent prompt even when its state repeats`() {
        gate.onState(CastingUiState())
        gate.onState(awaiting("session-1"))
        gate.onState(awaiting("session-1"))
        gate.onState(CastingUiState(CastingPhase.NEGOTIATING, "session-1"))

        assertEquals(listOf("session-1"), prompts)
        assertEquals(emptyList<String>(), dismissals)
    }

    @Test
    fun `a later awaiting session opens its own consent prompt`() {
        gate.onState(awaiting("session-1"))
        gate.onState(CastingUiState(CastingPhase.FAILED, "session-1", CastFailure.CONSENT_DENIED))
        gate.onState(awaiting("session-2"))

        assertEquals(listOf("session-1", "session-2"), prompts)
        assertEquals(emptyList<String>(), dismissals)
    }

    @Test
    fun `an approved prompt is not dismissed when negotiation or the live view follows`() {
        gate.onState(awaiting("session-1"))
        gate.onState(CastingUiState(CastingPhase.NEGOTIATING, "session-1"))
        gate.onState(CastingUiState(CastingPhase.LIVE, "session-1"))
        gate.onState(CastingUiState())

        assertEquals(emptyList<String>(), dismissals)
    }

    @Test
    fun `a stopped session dismisses its unanswered prompt exactly once`() {
        gate.onState(awaiting("session-1"))
        gate.onState(CastingUiState())
        gate.onState(CastingUiState())

        assertEquals(listOf("session-1"), dismissals)
    }

    @Test
    fun `an approval timeout dismisses the prompt left over the customer's game`() {
        gate.onState(awaiting("session-1"))
        gate.onState(CastingUiState(CastingPhase.FAILED, "session-1", CastFailure.APPROVAL_TIMEOUT))

        assertEquals(listOf("session-1"), dismissals)
    }

    @Test
    fun `a replacement session dismisses the previous prompt and opens its own`() {
        gate.onState(awaiting("session-1"))
        gate.onState(awaiting("session-2"))

        assertEquals(listOf("session-1", "session-2"), prompts)
        assertEquals(listOf("session-1"), dismissals)
    }
}
