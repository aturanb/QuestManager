package com.cafequest.agent

/** Wire values of Telemetry.wirelessDebugging (mirrors shared WirelessDebuggingSchema). */
object WirelessDebuggingState {
    const val ON = "on"
    const val OFF = "off"
    const val NOT_PERMITTED = "not_permitted"
}

/** The three Settings.Global operations the controller needs, behind a seam for unit tests. */
interface SecureSettings {
    /** 1 while Horizon OS Wireless Debugging is on, 0 while it is off. */
    fun adbWifiEnabled(): Int

    /** Throws SecurityException when WRITE_SECURE_SETTINGS has not been granted. */
    fun setAdbWifiEnabled(value: Int)

    /** Settings.Global.BOOT_COUNT: changes on every reboot. */
    fun bootCount(): Int
}

/** What must outlive the process: who turned the setting on, and in which boot we last asked. */
interface ControllerMonitoringStore {
    var ownedByAgent: Boolean

    /** -1 until a request has been made. */
    var lastRequestBootCount: Int
}

/**
 * Turns Horizon OS Wireless Debugging on for the server's controller-battery
 * monitoring, without ever re-raising the system "Allow wireless debugging?"
 * dialog more than once per boot and without ever switching off a setting staff
 * enabled themselves. Failures here change only the reported state; nothing
 * throws into the connection loop.
 */
class ControllerMonitoringController(
    private val settings: SecureSettings,
    private val store: ControllerMonitoringStore,
) {
    @Volatile private var denied = false

    @Synchronized
    fun apply(enabled: Boolean) {
        val boot = settings.bootCount()
        // A reboot resets Wireless Debugging, so ownership from an earlier boot is stale.
        if (store.lastRequestBootCount != boot) store.ownedByAgent = false
        if (enabled) enable(boot) else disable()
    }

    private fun enable(boot: Int) {
        if (settings.adbWifiEnabled() == 1) {
            denied = false
            return
        }
        // Already asked this boot: a denied dialog must not come back on every reconnect.
        if (store.lastRequestBootCount == boot) return
        try {
            settings.setAdbWifiEnabled(1)
            store.lastRequestBootCount = boot
            store.ownedByAgent = true
            denied = false
        } catch (_: SecurityException) {
            denied = true
        }
    }

    private fun disable() {
        if (store.ownedByAgent && settings.adbWifiEnabled() == 1) {
            try {
                settings.setAdbWifiEnabled(0)
            } catch (_: SecurityException) {
                // The grant was revoked; leave the setting as it is.
            }
        }
        store.ownedByAgent = false
        store.lastRequestBootCount = -1
        denied = false
    }

    /** The value reported in telemetry: what the setting says now, or that the grant is missing. */
    @Synchronized
    fun wireState(): String = when {
        settings.adbWifiEnabled() == 1 -> WirelessDebuggingState.ON
        denied -> WirelessDebuggingState.NOT_PERMITTED
        else -> WirelessDebuggingState.OFF
    }
}
