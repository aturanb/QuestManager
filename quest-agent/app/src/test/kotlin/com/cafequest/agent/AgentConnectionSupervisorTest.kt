package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AgentConnectionSupervisorTest {
    private class FakeConnection : ManagedAgentConnection {
        var starts = 0
        var reconnects = 0
        var destroys = 0
        var telemetry = 0
        var testLaunches = 0

        override fun start() { starts += 1 }
        override fun reconnect() { reconnects += 1 }
        override fun destroy() { destroys += 1 }
        override fun sendTestTelemetry() { telemetry += 1 }
        override suspend fun testLastLaunch() { testLaunches += 1 }
    }

    @Test fun `reconnect reuses one connection while reconfigure replaces it once`() = runTest {
        val created = mutableListOf<FakeConnection>()
        val supervisor = AgentConnectionSupervisor {
            FakeConnection().also(created::add)
        }

        supervisor.replace()
        supervisor.reconnect()

        assertEquals(1, created.size)
        assertEquals(1, created[0].starts)
        assertEquals(1, created[0].reconnects)
        assertEquals(0, created[0].destroys)

        supervisor.replace()

        assertEquals(2, created.size)
        assertEquals(1, created[0].destroys)
        assertEquals(1, created[1].starts)
        assertEquals(0, created[1].reconnects)

        supervisor.destroy()
        assertEquals(1, created[1].destroys)
    }
}
