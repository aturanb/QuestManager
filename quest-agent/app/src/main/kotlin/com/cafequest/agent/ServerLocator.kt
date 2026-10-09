package com.cafequest.agent

/**
 * Where the agent dials next (spec §3). Auto searches when nothing is saved or
 * once [SEARCH_AFTER_FAILURES] connects in a row have failed, keeps to the café
 * PC it remembers, and persists a new address before dialing it. Manual never
 * searches. No android.* calls, so the whole decision is unit-tested.
 */
class ServerLocator(
    initial: ServerTarget,
    private val search: suspend () -> List<FoundServer>,
    /** Saves a found server; false when the setup turned Manual meanwhile, so it must not be dialed. */
    private val persist: suspend (FoundServer) -> Boolean,
    private val onSearching: () -> Unit,
    private val onTarget: (ServerTarget) -> Unit,
) {
    @Volatile var target: ServerTarget = initial
        private set

    suspend fun beforeConnect(failedAttempts: Int): ServerTarget {
        val current = target
        if (!shouldSearch(current.mode, current.host, failedAttempts)) return current
        onSearching()
        val pick = chooseServer(search(), current.name) ?: return current
        if (pick.host == current.host && pick.port == current.port && pick.name == current.name) return current
        if (!persist(pick)) return current
        return ServerTarget(pick.name, pick.host, pick.port, ServerMode.AUTO).also {
            target = it
            onTarget(it)
        }
    }
}
