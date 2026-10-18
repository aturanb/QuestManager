package com.cafequest.agent

/** Reconnect schedule per brief §25: 1s, 2s, 5s, 10s, 30s, 30s… */
val BACKOFF_SCHEDULE_MS = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000)

fun backoffDelayMs(attempt: Int): Long =
    BACKOFF_SCHEDULE_MS[minOf(maxOf(attempt, 0), BACKOFF_SCHEDULE_MS.size - 1)]
