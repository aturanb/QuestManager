package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerLocatorTest {
    private val cafePcMoved = FoundServer("CAFE-PC", "192.168.1.151", 3000)
    private val laptop = FoundServer("DEV-LAPTOP", "192.168.1.20", 3000)
    private val savedCafePc = ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO)

    /** Records what the locator asked of its collaborators. */
    private class Calls(val answers: List<FoundServer>, val persistResult: Boolean = true) {
        var searches = 0
        var searchingShown = 0
        val persisted = mutableListOf<FoundServer>()
        val published = mutableListOf<ServerTarget>()
    }

    private fun locator(initial: ServerTarget, calls: Calls) = ServerLocator(
        initial = initial,
        search = { calls.searches++; calls.answers },
        persist = { found -> calls.persisted += found; calls.persistResult },
        onSearching = { calls.searchingShown++ },
        onTarget = { calls.published += it },
    )

    @Test fun `a fresh install searches at once and dials what it found`() = runTest {
        val calls = Calls(listOf(cafePcMoved))
        val target = locator(ServerTarget(null, "", 3000, ServerMode.AUTO), calls).beforeConnect(failedAttempts = 0)
        assertEquals(ServerTarget("CAFE-PC", "192.168.1.151", 3000, ServerMode.AUTO), target)
        assertEquals(listOf(cafePcMoved), calls.persisted)
        assertEquals(listOf(target), calls.published)
        assertEquals(1, calls.searchingShown)
    }

    @Test fun `a saved address is dialed without searching until three connects fail`() = runTest {
        val calls = Calls(listOf(cafePcMoved))
        val l = locator(savedCafePc, calls)
        assertEquals(savedCafePc, l.beforeConnect(failedAttempts = 2))
        assertEquals(0, calls.searches)
        assertEquals("192.168.1.151", l.beforeConnect(failedAttempts = 3).host)
        assertEquals(1, calls.searches)
        assertEquals("192.168.1.151", l.target.host)
    }

    @Test fun `another server never takes over a headset that remembers the cafe PC`() = runTest {
        val calls = Calls(listOf(laptop))
        assertEquals(savedCafePc, locator(savedCafePc, calls).beforeConnect(failedAttempts = 5))
        assertTrue(calls.persisted.isEmpty())
        assertTrue(calls.published.isEmpty())
    }

    @Test fun `a manual headset never searches`() = runTest {
        val calls = Calls(listOf(cafePcMoved))
        val typed = ServerTarget(null, "192.168.1.77", 3000, ServerMode.MANUAL)
        assertEquals(typed, locator(typed, calls).beforeConnect(failedAttempts = 40))
        assertEquals(0, calls.searches)
        assertEquals(0, calls.searchingShown)
    }

    @Test fun `a result that could not be saved is not dialed`() = runTest {
        // Staff switched the headset to Manual while this search ran, so IdentityStore refused it.
        val calls = Calls(listOf(cafePcMoved), persistResult = false)
        assertEquals(savedCafePc, locator(savedCafePc, calls).beforeConnect(failedAttempts = 3))
        assertTrue(calls.published.isEmpty())
    }

    @Test fun `finding the same server again changes nothing`() = runTest {
        val calls = Calls(listOf(FoundServer("CAFE-PC", "192.168.1.150", 3000)))
        assertEquals(savedCafePc, locator(savedCafePc, calls).beforeConnect(failedAttempts = 3))
        assertTrue(calls.persisted.isEmpty())
        assertTrue(calls.published.isEmpty())
    }
}
