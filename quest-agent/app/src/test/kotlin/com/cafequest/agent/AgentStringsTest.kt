package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
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

    @Test
    fun serverLineSpeaksTurkish() {
        val tr = AgentLanguage.TR.strings
        assertEquals(
            "CAFE-PC · 192.168.1.150:3000 · Otomatik",
            serverSummary(ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO), tr),
        )
        assertEquals("192.168.1.77:3000 · Manuel", serverSummary(ServerTarget("CAFE-PC", "192.168.1.77", 3000, ServerMode.MANUAL), tr))
        assertEquals("Henüz bulunamadı", serverSummary(ServerTarget(null, "", 3000, ServerMode.AUTO), tr))
    }

    @Test
    fun castingCopyExistsInBothLanguages() {
        AgentLanguage.entries.forEach { language ->
            val s = language.strings
            listOf(
                s.casting,
                s.castRequestPending,
                s.castShare,
                s.castNegotiating,
                s.castSharing,
                s.castStop,
                s.castStopped,
                s.castFailedTitle,
                s.castFailedHint,
                s.notificationAwaiting,
                s.notificationSharing,
            ).forEach { assertTrue("${language.code}: blank casting copy", it.isNotBlank()) }
            CastFailure.ALL.forEach { code ->
                assertTrue("${language.code}: blank failure copy for $code", s.castFailure(code).isNotBlank())
            }
        }
    }

    @Test
    fun castFailureCopyIsLocalizedAndNeverLeaksUnknownText() {
        val en = AgentLanguage.EN.strings
        val tr = AgentLanguage.TR.strings
        assertNotEquals(en.castFailure(CastFailure.PEER_DISCONNECTED), tr.castFailure(CastFailure.PEER_DISCONNECTED))
        // An unknown or absent code gets generic localized copy, never the raw value.
        assertEquals("Something went wrong.", en.castFailure(null))
        assertEquals("Bir şeyler ters gitti.", tr.castFailure("SECURITY_EXCEPTION at MediaProjection"))
    }

    @Test
    fun theNotificationNamesTheLiveViewState() {
        val en = AgentLanguage.EN.strings
        assertEquals(en.notificationAwaiting, notificationText(CastingPhase.AWAITING_APPROVAL, en))
        assertEquals(en.notificationSharing, notificationText(CastingPhase.NEGOTIATING, en))
        assertEquals(en.notificationSharing, notificationText(CastingPhase.LIVE, en))
        assertEquals(en.notificationText, notificationText(CastingPhase.IDLE, en))
        assertEquals(en.notificationText, notificationText(CastingPhase.FAILED, en))
        val tr = AgentLanguage.TR.strings
        assertEquals(tr.notificationAwaiting, notificationText(CastingPhase.AWAITING_APPROVAL, tr))
        assertEquals(tr.notificationSharing, notificationText(CastingPhase.LIVE, tr))
    }

    @Test
    fun turkishCastCopyNeverSuffixesTheDeviceName() {
        val tr = AgentLanguage.TR.strings
        assertEquals("Quest 02 ekranını kafe personeliyle paylaş", tr.castShareLabel("Quest 02"))
        assertEquals("Quest 01 ekranını kafe personeliyle paylaş", tr.castShareLabel("Quest 01"))
        assertFalse(tr.castShareLabel("Quest 02").startsWith("Quest 02'"))
    }
}
