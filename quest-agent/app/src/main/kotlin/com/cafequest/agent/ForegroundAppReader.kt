package com.cafequest.agent

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import android.util.Log

data class UsageSnapshot(
    val accessGranted: Boolean,
    val foregroundApp: ForegroundAppObservation?,
)

/**
 * Picks the time range each poll asks `UsageStatsManager` for.
 *
 * The window only advances past events it actually saw. Android flushes usage
 * events in batches, so an event can become queryable several seconds after it
 * happened; advancing to "now" every poll stepped over those events for good and
 * left a running game reported as no game at all (confirmed on a Quest 3, where
 * a launch's ACTIVITY_RESUMED was in `dumpsys usagestats` but never in a query).
 */
class UsageQueryWindow(private val maxLookbackMs: Long = DEFAULT_MAX_LOOKBACK_MS) {
    private var lastEventMs = 0L

    /** Start of the range to query at `nowMs`. */
    fun from(nowMs: Long): Long {
        val earliest = nowMs - maxLookbackMs
        return if (lastEventMs == 0L) earliest else maxOf(lastEventMs + 1, earliest)
    }

    /** Events not yet applied, oldest first; advances the window past them. */
    fun accept(events: List<UsageTransitionEvent>): List<UsageTransitionEvent> {
        val fresh = events.filter { it.timestampMs > lastEventMs }.sortedBy { it.timestampMs }
        fresh.lastOrNull()?.let { lastEventMs = it.timestampMs }
        return fresh
    }

    companion object {
        /** Also the cold-start lookback, so a restarted agent rebuilds a day of state. */
        const val DEFAULT_MAX_LOOKBACK_MS = 24L * 60 * 60 * 1_000
    }
}

interface ForegroundAppReader {
    fun read(managedPackages: Set<String>): UsageSnapshot
}

class AndroidForegroundAppReader(private val context: Context) : ForegroundAppReader {
    private val tracker = ForegroundAppTracker()
    private val window = UsageQueryWindow()

    override fun read(managedPackages: Set<String>): UsageSnapshot {
        if (!hasUsageAccess()) return UsageSnapshot(accessGranted = false, foregroundApp = null)

        val now = System.currentTimeMillis()
        val events = context.getSystemService(UsageStatsManager::class.java)
            .queryEvents(window.from(now), now + 1)
        val transitions = buildList {
            val event = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val transition = when (event.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> UsageTransition.FOREGROUND
                    UsageEvents.Event.ACTIVITY_PAUSED -> UsageTransition.BACKGROUND
                    else -> null
                }
                if (transition != null && event.packageName != null) {
                    add(UsageTransitionEvent(event.packageName, event.timeStamp, transition))
                }
            }
        }
        val fresh = window.accept(transitions)
        val foregroundApp = tracker.apply(fresh, managedPackages)
        Log.d(
            LOG_TAG,
            "usage poll: queried=${transitions.size} fresh=${fresh.size} " +
                "managed=${managedPackages.size} foreground=${foregroundApp?.packageName ?: "none"}",
        )
        return UsageSnapshot(accessGranted = true, foregroundApp = foregroundApp)
    }

    private fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        return appOps.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName,
        ) == AppOpsManager.MODE_ALLOWED
    }
}
