package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class AgentStringsTest {
    @Test
    fun aPickOnTheHeadsetBeatsItsSystemLanguage() {
        assertEquals(AgentLanguage.EN, resolveLanguage("en", "tr"))
        assertEquals(AgentLanguage.TR, resolveLanguage("tr", "en"))
    }

    @Test
    fun withoutAPickTheSystemLanguageDecides() {
        assertEquals(AgentLanguage.TR, resolveLanguage(null, "tr"))
        assertEquals(AgentLanguage.EN, resolveLanguage(null, "en"))
        assertEquals(AgentLanguage.EN, resolveLanguage(null, "de"))
        // Junk in storage counts as no pick.
        assertEquals(AgentLanguage.TR, resolveLanguage("xx", "tr"))
    }

    @Test
    fun linkStatusSpeaksTurkish() {
        val tr = AgentLanguage.TR.strings
        assertEquals("Bağlı", linkStatus(ConnState.CONNECTED, "192.168.1.50", 3000, tr).word)
        assertEquals("192.168.1.50:3000 adresine ulaşılıyor", linkStatus(ConnState.CONNECTING, "192.168.1.50", 3000, tr).caption)
        assertEquals("Kafe bilgisayarına ulaşılıyor", linkStatus(ConnState.CONNECTING, null, null, tr).caption)

        val down = linkStatus(ConnState.DISCONNECTED, "192.168.1.50", 3000, tr)
        assertEquals("Bağlı değil", down.word)
        assertEquals(
            "192.168.1.50:3000 adresine ulaşılamıyor. Kafe Wi-Fi ağını kontrol edin, sonra “Yeniden bağlan” düğmesine dokunun.",
            down.caption,
        )
        assertEquals(LinkTone.OFFLINE, down.tone)
    }

    @Test
    fun launchResultsUseTheAppLanguageButKeepTheirCode() {
        val tr = AgentLanguage.TR.strings
        assertEquals("BAŞARILI", displayResult("SUCCESS", tr))
        assertEquals("BAŞARISIZ META_APP_ID_NOT_CONFIGURED", displayResult("FAILED META_APP_ID_NOT_CONFIGURED", tr))
        assertEquals("—", displayResult("—", tr))
        assertEquals("FAILED LAUNCH_FAILED", displayResult("FAILED LAUNCH_FAILED", AgentLanguage.EN.strings))
    }

    @Test
    fun searchingSpeaksTurkish() {
        val searching = linkStatus(ConnState.SEARCHING, "192.168.1.150", 3000, AgentLanguage.TR.strings)
        assertEquals("Sunucu aranıyor…", searching.word)
        assertEquals("Kafe bilgisayarı bu Wi-Fi ağında aranıyor.", searching.caption)
    }
}
