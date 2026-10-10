package com.cafequest.agent

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

const val PROTOCOL_VERSION = 1
const val LOG_TAG = "CafeQuest"
const val CAPABILITY_LAUNCH_ANDROID_PACKAGE = "launch_android_package"
const val CAPABILITY_SCREEN_CAST = "screen_cast_v1"
const val CAPABILITY_CONTROLLER_MONITORING = "controller_monitoring_v1"

/** Mirrors shared MAX_CAST_SDP_CHARS / MAX_CAST_ICE_CANDIDATE_CHARS. */
const val MAX_CAST_SDP_CHARS = 65_536
const val MAX_CAST_ICE_CHARS = 4_096

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
    val capabilities: List<String> = listOf(
        CAPABILITY_LAUNCH_ANDROID_PACKAGE,
        CAPABILITY_SCREEN_CAST,
        CAPABILITY_CONTROLLER_MONITORING,
    ),
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
    /** "on" | "off" | "not_permitted"; advisory only (mirrors shared WirelessDebuggingSchema). */
    val wirelessDebugging: String? = null,
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
data class LaunchPayload(
    val gameId: String,
    val gameName: String,
    val metaAppId: String? = null,
    val packageName: String? = null,
)

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
    val hasMetaTarget = !cmd.payload.metaAppId.isNullOrBlank()
    val hasPackageTarget = !cmd.payload.packageName.isNullOrBlank()
    if (hasMetaTarget == hasPackageTarget) return null
    return cmd
}

/** Agent-reported live-view statuses (mirrors shared CastSessionStatusSchema). */
object CastStatus {
    const val AWAITING_APPROVAL = "awaiting_approval"
    const val NEGOTIATING = "negotiating"
    const val LIVE = "live"
    const val STOPPED = "stopped"
    const val FAILED = "failed"
    val ALL = setOf(AWAITING_APPROVAL, NEGOTIATING, LIVE, STOPPED, FAILED)
}

/** Stable bounded cast failure codes (mirrors shared CastFailureCodeSchema). */
object CastFailure {
    const val CONSENT_DENIED = "consent_denied"
    const val APPROVAL_TIMEOUT = "approval_timeout"
    const val NEGOTIATION_TIMEOUT = "negotiation_timeout"
    const val PROJECTION_STOPPED = "projection_stopped"
    const val PEER_DISCONNECTED = "peer_disconnected"
    const val CAPTURE_FAILED = "capture_failed"
    const val INTERNAL_ERROR = "internal_error"
    val ALL = setOf(
        CONSENT_DENIED,
        APPROVAL_TIMEOUT,
        NEGOTIATION_TIMEOUT,
        PROJECTION_STOPPED,
        PEER_DISCONNECTED,
        CAPTURE_FAILED,
        INTERNAL_ERROR,
    )
}

/** Stop reasons the server may send (mirrors shared CastStopReasonSchema). */
object CastStopReason {
    const val VIEWER_STOPPED = "viewer_stopped"
    const val VIEWER_DISCONNECTED = "viewer_disconnected"
    const val APPROVAL_TIMEOUT = "approval_timeout"
    const val NEGOTIATION_TIMEOUT = "negotiation_timeout"
    const val AGENT_DISCONNECTED = "agent_disconnected"
    const val SERVER_STOPPING = "server_stopping"
    const val FAILED = "failed"
    val ALL = setOf(
        VIEWER_STOPPED,
        VIEWER_DISCONNECTED,
        APPROVAL_TIMEOUT,
        NEGOTIATION_TIMEOUT,
        AGENT_DISCONNECTED,
        SERVER_STOPPING,
        FAILED,
    )
}

/**
 * WebRTC signaling; serialized with the `kind` discriminator so it matches
 * shared RtcSignalSchema. The agent only ever offers.
 */
@OptIn(ExperimentalSerializationApi::class)
@JsonClassDiscriminator("kind")
@Serializable
sealed interface RtcSignal {
    @Serializable
    @SerialName("offer")
    data class Offer(val sdp: String) : RtcSignal

    @Serializable
    @SerialName("answer")
    data class Answer(val sdp: String) : RtcSignal

    @Serializable
    @SerialName("ice")
    data class Ice(
        val candidate: String,
        val sdpMid: String? = null,
        val sdpMLineIndex: Int? = null,
    ) : RtcSignal
}

@Serializable
data class AgentCastStatus(
    val type: String = "cast_status",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val deviceId: String,
    val sessionId: String,
    val status: String,
    val error: String? = null,
)

@Serializable
data class AgentCastSignal(
    val type: String = "cast_signal",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val deviceId: String,
    val sessionId: String,
    val signal: RtcSignal,
)

@Serializable
data class CastRequestMessage(
    val type: String = "cast_request",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val sessionId: String,
    val expiresAt: String,
)

@Serializable
data class ServerCastSignalMessage(
    val type: String = "cast_signal",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val sessionId: String,
    val signal: RtcSignal,
)

@Serializable
data class CastStopMessage(
    val type: String = "cast_stop",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val sessionId: String,
    val reason: String,
)

@Serializable
data class ControllerMonitoringMessage(
    val type: String = "controller_monitoring",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val enabled: Boolean,
)

/** One parsed inbound server frame; distinct variants keep directions explicit. */
sealed interface ParsedServerMessage {
    data class Launch(val command: ServerCommand) : ParsedServerMessage
    data class CastRequest(val message: CastRequestMessage) : ParsedServerMessage
    data class CastSignal(val message: ServerCastSignalMessage) : ParsedServerMessage
    data class CastStop(val message: CastStopMessage) : ParsedServerMessage
    data class ControllerMonitoring(val message: ControllerMonitoringMessage) : ParsedServerMessage
}

private val CAST_UUID_RE =
    Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

/** Cast session ids are UUIDs; the service-action parser reuses the same check. */
fun isCastSessionId(value: String): Boolean = CAST_UUID_RE.matches(value)

private fun isCastInstant(value: String): Boolean =
    runCatching { java.time.Instant.parse(value) }.isSuccess

/**
 * Parse one inbound server frame. Server-to-agent casts may only carry an
 * answer or an ICE candidate; an offer is an invalid direction. Never throws.
 */
fun parseServerMessage(raw: String): ParsedServerMessage? {
    val element = runCatching { protocolJson.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
    if (element["protocolVersion"]?.jsonPrimitive?.intOrNull != PROTOCOL_VERSION) return null
    return when (element["type"]?.jsonPrimitive?.contentOrNull) {
        "command" -> parseLaunchCommand(raw)?.let { ParsedServerMessage.Launch(it) }
        "cast_request" -> {
            val message = runCatching { protocolJson.decodeFromString<CastRequestMessage>(raw) }.getOrNull() ?: return null
            if (!isCastSessionId(message.sessionId) || !isCastInstant(message.expiresAt)) return null
            ParsedServerMessage.CastRequest(message)
        }
        "cast_signal" -> {
            val message = runCatching { protocolJson.decodeFromString<ServerCastSignalMessage>(raw) }.getOrNull() ?: return null
            if (!isCastSessionId(message.sessionId)) return null
            if (message.signal is RtcSignal.Offer) return null
            if (!hasValidSignalBounds(message.signal)) return null
            ParsedServerMessage.CastSignal(message)
        }
        "cast_stop" -> {
            val message = runCatching { protocolJson.decodeFromString<CastStopMessage>(raw) }.getOrNull() ?: return null
            if (!isCastSessionId(message.sessionId) || message.reason !in CastStopReason.ALL) return null
            ParsedServerMessage.CastStop(message)
        }
        "controller_monitoring" -> {
            // A quoted "true" or a number is not a boolean on this wire.
            val enabled = element["enabled"] as? JsonPrimitive
            if (enabled == null || enabled.isString) return null
            val value = enabled.booleanOrNull ?: return null
            ParsedServerMessage.ControllerMonitoring(ControllerMonitoringMessage(enabled = value))
        }
        else -> null
    }
}

/** Bounds identical to the Zod schemas, checked after decoding succeeds. */
fun hasValidSignalBounds(signal: RtcSignal): Boolean = when (signal) {
    is RtcSignal.Offer -> signal.sdp.length in 1..MAX_CAST_SDP_CHARS
    is RtcSignal.Answer -> signal.sdp.length in 1..MAX_CAST_SDP_CHARS
    is RtcSignal.Ice -> signal.candidate.length in 1..MAX_CAST_ICE_CHARS
}
