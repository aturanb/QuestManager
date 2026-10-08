package com.cafequest.agent

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

const val PROTOCOL_VERSION = 1
const val LOG_TAG = "CafeQuest"

val protocolJson = Json {
    ignoreUnknownKeys = true
    // Defaults (type, protocolVersion) must hit the wire; nulls stay omitted.
    encodeDefaults = true
    explicitNulls = false
}

@Serializable
data class Hello(
    val type: String = "hello",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val deviceId: String,
    val deviceName: String,
    val deviceModel: String,
    val agentVersion: String,
    val enrollmentKey: String? = null,
)

@Serializable
data class Battery(val level: Int, val charging: Boolean)

@Serializable
data class AgentState(val foreground: Boolean)

@Serializable
data class ExpectedGame(val gameId: String, val name: String, val launchedAt: String)

@Serializable
data class ForegroundApp(val packageName: String, val startedAt: String)

@Serializable
data class UsageState(val accessGranted: Boolean, val foregroundApp: ForegroundApp? = null)

@Serializable
data class Telemetry(
    val type: String = "telemetry",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val deviceId: String,
    val timestamp: String,
    val battery: Battery,
    val agent: AgentState,
    val expectedCurrentGame: ExpectedGame? = null,
    val usage: UsageState? = null,
)

@Serializable
data class InstalledApp(
    val packageName: String,
    val label: String,
    val versionName: String? = null,
    val versionCode: Long? = null,
)

@Serializable
data class InstalledApps(
    val type: String = "installed_apps",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val deviceId: String,
    val scannedAt: String,
    val apps: List<InstalledApp>,
)

@Serializable
data class CommandAck(
    val type: String = "command_ack",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val commandId: String,
    val status: String = "received",
    val deviceId: String,
)

@Serializable
data class CommandResult(
    val type: String = "command_result",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val commandId: String,
    val status: String, // "success" | "failed"
    val error: String? = null,
    val deviceId: String,
)

@Serializable
data class LaunchPayload(val gameId: String, val gameName: String, val metaAppId: String)

@Serializable
data class ServerCommand(
    val type: String = "command",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val commandId: String,
    val command: String,
    val payload: LaunchPayload? = null,
)

/** Parse one inbound server frame; null = not a launch command (error/unknown). */
fun parseLaunchCommand(raw: String): ServerCommand? {
    val cmd = runCatching { protocolJson.decodeFromString<ServerCommand>(raw) }.getOrNull()
    if (cmd?.type != "command" || cmd.command != "launch_app") return null
    if (cmd.protocolVersion != PROTOCOL_VERSION || cmd.payload == null) return null
    return cmd
}
