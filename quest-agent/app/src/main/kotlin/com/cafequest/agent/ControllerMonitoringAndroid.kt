package com.cafequest.agent

import android.content.Context
import android.provider.Settings

/** Real Settings.Global access. The key is a literal because ADB_WIFI_ENABLED is hidden API. */
class AndroidSecureSettings(private val context: Context) : SecureSettings {
    override fun adbWifiEnabled(): Int = Settings.Global.getInt(context.contentResolver, KEY, 0)

    override fun setAdbWifiEnabled(value: Int) {
        // Throws SecurityException until `pm grant ... WRITE_SECURE_SETTINGS` has been run once.
        Settings.Global.putInt(context.contentResolver, KEY, value)
    }

    override fun bootCount(): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, 0)

    private companion object {
        const val KEY = "adb_wifi_enabled"
    }
}

/** Ownership and the boot of the last request, kept across agent process restarts. */
class PrefsControllerMonitoringStore(context: Context) : ControllerMonitoringStore {
    private val prefs = context.getSharedPreferences("controller_monitoring", Context.MODE_PRIVATE)

    override var ownedByAgent: Boolean
        get() = prefs.getBoolean("ownedByAgent", false)
        set(value) = prefs.edit().putBoolean("ownedByAgent", value).apply()

    override var lastRequestBootCount: Int
        get() = prefs.getInt("lastRequestBootCount", -1)
        set(value) = prefs.edit().putInt("lastRequestBootCount", value).apply()
}
