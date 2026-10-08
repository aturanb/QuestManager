package com.cafequest.agent

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface ManagedAgentConnection {
    fun start()
    fun reconnect()
    fun destroy()
    fun sendTestTelemetry()
    suspend fun testLastLaunch()
}

/** Serializes connection lifecycle actions so only one agent loop is active. */
class AgentConnectionSupervisor(
    private val factory: suspend () -> ManagedAgentConnection,
) {
    private val mutex = Mutex()
    @Volatile private var active: ManagedAgentConnection? = null

    private suspend fun activeLocked(): ManagedAgentConnection {
        active?.let { return it }
        return factory().also {
            active = it
            it.start()
        }
    }

    suspend fun ensureStarted() = mutex.withLock {
        activeLocked()
        Unit
    }

    suspend fun replace() = mutex.withLock {
        val replacement = factory()
        active?.destroy()
        active = replacement
        replacement.start()
    }

    suspend fun reconnect() = mutex.withLock {
        activeLocked().reconnect()
    }

    suspend fun sendTestTelemetry() = mutex.withLock {
        activeLocked().sendTestTelemetry()
    }

    suspend fun testLastLaunch() = mutex.withLock {
        activeLocked().testLastLaunch()
    }

    fun destroy() {
        active?.destroy()
        active = null
    }
}
