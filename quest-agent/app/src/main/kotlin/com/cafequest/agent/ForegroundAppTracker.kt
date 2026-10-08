package com.cafequest.agent

enum class UsageTransition { FOREGROUND, BACKGROUND }

data class UsageTransitionEvent(
    val packageName: String,
    val timestampMs: Long,
    val transition: UsageTransition,
)

data class ForegroundAppObservation(
    val packageName: String,
    val startedAtMs: Long,
)

/**
 * Pure state reducer for Android usage events.
 *
 * Quest keeps several activities resumed at once — the immersive game on the
 * main display plus 2D panel apps on their own panels — so this tracks *which
 * managed packages are currently resumed* rather than a single "current" slot.
 * A one-second Instagram panel blink used to wipe a game that had been running
 * for minutes (observed on a Quest 3: `com.oculus.igvr` resumed and paused
 * while Breachers stayed resumed throughout).
 *
 * The reported app is the most recently resumed one still resumed, and its
 * `startedAtMs` is when it came forward, which survives both unmanaged overlays
 * and managed panel apps appearing on top.
 */
class ForegroundAppTracker {
    /** Managed package → when it came forward; only currently-resumed entries. */
    private val resumed = mutableMapOf<String, Long>()

    fun apply(
        events: List<UsageTransitionEvent>,
        managedPackages: Set<String>,
    ): ForegroundAppObservation? {
        for (event in events.sortedBy { it.timestampMs }) {
            // Unmanaged packages (the Meta universal menu, system bars) are not
            // games and never change what CafeQuest reports.
            if (event.packageName !in managedPackages) continue
            when (event.transition) {
                // Already resumed: keep the original start time, don't restart the timer.
                UsageTransition.FOREGROUND -> resumed.putIfAbsent(event.packageName, event.timestampMs)
                UsageTransition.BACKGROUND -> resumed.remove(event.packageName)
            }
        }
        resumed.keys.retainAll(managedPackages)
        return resumed.maxByOrNull { it.value }?.let { ForegroundAppObservation(it.key, it.value) }
    }
}
