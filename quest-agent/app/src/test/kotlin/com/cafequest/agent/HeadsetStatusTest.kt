package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class HeadsetStatusTest {
    @Test
    fun connectedReadsAsReady() {
        val status = linkStatus(ConnState.CONNECTED, "192.168.1.50", 3000)
        assertEquals("Connected", status.word)
        assertEquals(LinkTone.READY, status.tone)
    }

    @Test
    fun connectingNamesTheServerItIsReaching() {
        val status = linkStatus(ConnState.CONNECTING, "192.168.1.50", 3000)
        assertEquals("Connecting…", status.word)
        assertEquals("Reaching 192.168.1.50:3000", status.caption)
        assertEquals(LinkTone.WAITING, status.tone)
    }

    @Test
    fun disconnectedTellsStaffWhatToCheck() {
        val status = linkStatus(ConnState.DISCONNECTED, "192.168.1.50", 3000)
        assertEquals("Not connected", status.word)
        assertEquals("Can't reach 192.168.1.50:3000. Check the café Wi-Fi, then tap Reconnect.", status.caption)
        assertEquals(LinkTone.OFFLINE, status.tone)
    }

    @Test
    fun missingSetupFallsBackToThePlainName() {
        assertEquals("Reaching the café PC", linkStatus(ConnState.CONNECTING, null, null).caption)
        assertEquals("Reaching the café PC", linkStatus(ConnState.CONNECTING, " ", 3000).caption)
    }

    @Test
    fun batteryKeepsOneCellUntilFlat() {
        assertEquals(0, litBatteryCells(0))
        assertEquals(1, litBatteryCells(7))
        assertEquals(4, litBatteryCells(82))
        assertEquals(5, litBatteryCells(100))
    }

    @Test
    fun searchingSaysWhatTheHeadsetIsDoing() {
        val status = linkStatus(ConnState.SEARCHING, null, null)
        assertEquals("Searching for server…", status.word)
        assertEquals("Looking for the café PC on this Wi-Fi.", status.caption)
        assertEquals(LinkTone.WAITING, status.tone)
    }

    @Test
    fun serverLineNamesTheCafePcInAuto() {
        assertEquals(
            "CAFE-PC · 192.168.1.150:3000 · Auto",
            serverSummary(ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO), EnglishStrings),
        )
        // Upgraded from 0.2.0: the saved host works but no PC name was learned yet.
        assertEquals(
            "192.168.1.150:3000 · Auto",
            serverSummary(ServerTarget(null, "192.168.1.150", 3000, ServerMode.AUTO), EnglishStrings),
        )
    }

    @Test
    fun serverLineInManualShowsOnlyTheTypedAddress() {
        assertEquals(
            "192.168.1.77:3000 · Manual",
            serverSummary(ServerTarget("CAFE-PC", "192.168.1.77", 3000, ServerMode.MANUAL), EnglishStrings),
        )
    }

    @Test
    fun serverLineBeforeAutoFindsAnything() {
        assertEquals("Not found yet", serverSummary(ServerTarget(null, "", 3000, ServerMode.AUTO), EnglishStrings))
    }
}
