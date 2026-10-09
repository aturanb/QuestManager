package com.cafequest.agent

/** Sentinel the launcher treats as "no Meta Dashboard App ID configured yet". */
const val UNCONFIGURED_APP_ID = "UNCONFIGURED"

/** How the agent gets its server address (spec §4). */
enum class ServerMode(val stored: String) {
    /** Found on the Wi-Fi, and followed when the café PC's IP changes. */
    AUTO("auto"),
    /** Typed on the setup screen; never replaced by a search. */
    MANUAL("manual");

    companion object {
        /** Missing or junk reads as Auto, so headsets upgraded from 0.2.0 start healing themselves. */
        fun fromStored(value: String?): ServerMode = entries.firstOrNull { it.stored == value } ?: AUTO
    }
}

/**
 * Values baked in at build time from the café PC's `.env` and
 * `cafequest.config.json` (see app/build.gradle.kts), so a freshly installed
 * headset needs no typing at all. Blank means "nothing was baked in".
 */
data class AgentSetupDefaults(
    val host: String,
    val port: Int,
    val enrollmentKey: String,
    val metaAppId: String,
) {
    companion object {
        fun fromBuildConfig(): AgentSetupDefaults = AgentSetupDefaults(
            host = BuildConfig.DEFAULT_SERVER_HOST,
            port = BuildConfig.DEFAULT_SERVER_PORT,
            enrollmentKey = BuildConfig.DEFAULT_ENROLLMENT_KEY,
            metaAppId = BuildConfig.DEFAULT_META_APP_ID,
        )
    }
}

/** Raw strings as persisted by DataStore; null or blank both mean "unset". */
data class StoredSetup(
    val deviceName: String? = null,
    val serverHost: String? = null,
    val serverPort: String? = null,
    val enrollmentKey: String? = null,
    val metaAppId: String? = null,
)

/** Raw setup-screen fields, before trimming or validation. */
data class AgentSetupInput(
    val deviceName: String,
    val serverHost: String,
    val serverPort: String,
    val enrollmentKey: String,
    val metaAppId: String,
)

private fun String?.orNullIfBlank(): String? = this?.takeIf { it.isNotBlank() }?.trim()

private fun clampPort(port: Int): Int = port.coerceIn(1, 65535)

/** What the agent runs with: stored values first, then the baked-in defaults. */
fun resolveIdentity(
    deviceId: String,
    stored: StoredSetup,
    defaults: AgentSetupDefaults,
): AgentIdentity = AgentIdentity(
    deviceId = deviceId,
    deviceName = stored.deviceName.orNullIfBlank() ?: "Quest ${deviceId.take(4).uppercase()}",
    serverHost = stored.serverHost.orNullIfBlank() ?: defaults.host,
    serverPort = stored.serverPort.orNullIfBlank()?.toIntOrNull()?.let(::clampPort) ?: clampPort(defaults.port),
    enrollmentKey = stored.enrollmentKey.orNullIfBlank() ?: defaults.enrollmentKey,
    metaAppId = stored.metaAppId.orNullIfBlank()?.takeUnless { it == UNCONFIGURED_APP_ID }
        ?: defaults.metaAppId.orNullIfBlank()
        ?: UNCONFIGURED_APP_ID,
)

/**
 * What a Save persists. A blank field keeps whatever is already stored: editing
 * the device name must never silently wipe the enrollment key or App ID, which
 * previously left the headset unable to enroll with nothing on screen to show it.
 */
fun mergeSetup(current: AgentIdentity, input: AgentSetupInput): AgentIdentity = AgentIdentity(
    deviceId = current.deviceId,
    deviceName = input.deviceName.orNullIfBlank() ?: current.deviceName,
    serverHost = input.serverHost.orNullIfBlank() ?: current.serverHost,
    serverPort = input.serverPort.orNullIfBlank()?.toIntOrNull()?.let(::clampPort) ?: current.serverPort,
    enrollmentKey = input.enrollmentKey.orNullIfBlank() ?: current.enrollmentKey,
    metaAppId = input.metaAppId.orNullIfBlank() ?: current.metaAppId,
)
