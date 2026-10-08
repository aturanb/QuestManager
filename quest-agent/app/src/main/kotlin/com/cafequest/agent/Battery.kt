package com.cafequest.agent

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/** Clamp into the 0–100 integer range the protocol requires (§16/§33). */
fun normalizeBattery(level: Int): Int = level.coerceIn(0, 100)

/** Supported sticky-broadcast read; no permissions required. */
fun readBattery(context: Context): Battery {
    val intent: Intent? = context.registerReceiver(
        null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)
    )
    val rawLevel = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val pct = if (rawLevel in 0..scale && scale > 0) (rawLevel * 100) / scale else 0
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL
    return Battery(normalizeBattery(pct), charging)
}
