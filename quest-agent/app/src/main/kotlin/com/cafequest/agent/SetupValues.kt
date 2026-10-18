package com.cafequest.agent

/** Sentinel the launcher treats as "no Meta Dashboard App ID configured yet". */
const val UNCONFIGURED_APP_ID = "UNCONFIGURED"

/** Port a Manual setup starts from; Auto learns the real one from the discovery reply. */
const val DEFAULT_SERVER_PORT = 3000

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
 * CafeQuest's own Meta App ID, baked in at build time from the café PC's
 * `cafequest.config.json` (see app/build.gradle.kts). Blank means "nothing was
 * baked in". The server address is not baked in: Auto finds it on the Wi-Fi.
 */
data class AgentSetupDefaults(val metaAppId: String) {
    companion object {
        fun fromBuildConfig(): AgentSetupDefaults = AgentSetupDefaults(metaAppId = BuildConfig.DEFAULT_META_APP_ID)
    }
}

/** Raw strings as persisted by DataStore; null or blank both mean "unset". */
data class StoredSetup(
    val deviceName: String? = null,
    val serverHost: String? = null,
    val serverPort: String? = null,
    val serverMode: String? = null,
    val serverName: String? = null,
    val metaAppId: String? = null,
    /** "true" while a typed name awaits the server's confirmation. */
    val nameSetByStaff: String? = null,
)

/** Raw setup-screen fields, before trimming or validation. */
data class AgentSetupInput(
    val deviceName: String,
    val serverMode: ServerMode,
    /** Manual only; ignored in Auto. */
    val serverHost: String,
    /** Manual only; ignored in Auto. */
    val serverPort: String,
    val metaAppId: String,
    /** The server picked after Find server; Auto only. */
    val picked: FoundServer? = null,
)

private fun String?.orNullIfBlank(): String? = this?.takeIf { it.isNotBlank() }?.trim()

private fun clampPort(port: Int): Int = port.coerceIn(1, 65535)

/** What the agent runs with: stored values first, then the baked-in Meta App ID. */
fun resolveIdentity(
    deviceId: String,
    stored: StoredSetup,
    defaults: AgentSetupDefaults,
    previousDeviceId: String? = null,
): AgentIdentity = AgentIdentity(
    deviceId = deviceId,
    deviceName = stored.deviceName.orNullIfBlank() ?: "Quest ${deviceId.take(4).uppercase()}",
    nameSetByStaff = stored.nameSetByStaff == "true" && stored.deviceName.orNullIfBlank() != null,
    serverHost = stored.serverHost.orNullIfBlank() ?: "",
    serverPort = stored.serverPort.orNullIfBlank()?.toIntOrNull()?.let(::clampPort) ?: DEFAULT_SERVER_PORT,
    serverMode = ServerMode.fromStored(stored.serverMode),
    serverName = stored.serverName.orNullIfBlank(),
    metaAppId = stored.metaAppId.orNullIfBlank()?.takeUnless { it == UNCONFIGURED_APP_ID }
        ?: defaults.metaAppId.orNullIfBlank()
        ?: UNCONFIGURED_APP_ID,
    previousDeviceId = previousDeviceId,
)

/**
 * What a Save persists. A blank field keeps whatever is already stored: editing
 * the device name must never silently wipe the Meta App ID or a typed address.
 * Manual takes the typed host and port; Auto takes a server picked after Find
 * server, and coming back from Manual without a pick drops the typed address so
 * the agent searches at once.
 */
fun mergeSetup(current: AgentIdentity, input: AgentSetupInput): AgentIdentity {
    val picked = input.picked
    val server = when {
        input.serverMode == ServerMode.MANUAL -> current.copy(
            serverHost = input.serverHost.orNullIfBlank() ?: current.serverHost,
            serverPort = input.serverPort.orNullIfBlank()?.toIntOrNull()?.let(::clampPort) ?: current.serverPort,
        )
        picked != null -> current.copy(serverHost = picked.host, serverPort = picked.port, serverName = picked.name)
        current.serverMode == ServerMode.MANUAL -> current.copy(serverHost = "")
        else -> current
    }
    val deviceName = input.deviceName.orNullIfBlank() ?: current.deviceName
    return server.copy(
        deviceName = deviceName,
        // A typed name differing from what the server last confirmed is an edit to send once.
        nameSetByStaff = current.nameSetByStaff || deviceName != current.deviceName,
        serverMode = input.serverMode,
        metaAppId = input.metaAppId.orNullIfBlank() ?: current.metaAppId,
    )
}

/** A server Auto found, applied to the stored setup; null when the setup is Manual (never overwrite a typed IP). */
fun withDiscovered(current: AgentIdentity, found: FoundServer): AgentIdentity? =
    if (current.serverMode == ServerMode.MANUAL) null
    else current.copy(serverHost = found.host, serverPort = found.port, serverName = found.name)

/**
 * The name the server confirmed or assigned. It replaces the local one and
 * settles any pending edit, except that a name typed since the last hello is
 * kept: it has not reached the server yet and must not be overwritten here.
 */
fun AgentIdentity.withServerName(name: String): AgentIdentity {
    val trimmed = name.orNullIfBlank() ?: return this
    if (nameSetByStaff && trimmed != deviceName) return this
    return copy(deviceName = trimmed, nameSetByStaff = false)
}
