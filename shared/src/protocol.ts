import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const LAUNCH_ANDROID_PACKAGE_CAPABILITY = "launch_android_package" as const;
/** Capability that gates the one-headset live-view feature; older agents omit it. */
export const SCREEN_CAST_CAPABILITY = "screen_cast_v1" as const;
/** Signaling bounds keep every relayed frame small; SDP is the largest payload. */
export const MAX_CAST_SDP_CHARS = 65_536;
export const MAX_CAST_ICE_CANDIDATE_CHARS = 4_096;
// Capability negotiation is intentionally open-ended: old servers ignore
// names they do not understand instead of rejecting a newer protocol-v1 agent.
export const AgentCapabilitySchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);

/** A game CafeQuest requested to launch; distinct from "the true foreground game". */
export const ExpectedGameSchema = z.object({
  gameId: z.string().min(1),
  name: z.string().min(1),
  launchedAt: z.string().datetime(),
});

export const HelloSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().uuid(),
  deviceName: z.string().min(1).max(64),
  deviceModel: z.string().min(1).max(64),
  agentVersion: z.string().min(1).max(32),
  // Optional keeps protocol v1 hellos from older agents valid. The server must
  // only send additive command shapes when the connected agent advertises one.
  capabilities: z.array(AgentCapabilitySchema).max(16).optional(),
});

export const BatterySchema = z.object({
  level: z.number().int().min(0).max(100),
  charging: z.boolean(),
});

export const ForegroundAppSchema = z.object({
  packageName: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/),
  startedAt: z.string().datetime(),
});

export const UsageStateSchema = z.object({
  accessGranted: z.boolean(),
  foregroundApp: ForegroundAppSchema.nullable().optional().default(null),
});

export const TelemetrySchema = z.object({
  type: z.literal("telemetry"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().uuid(),
  timestamp: z.string().datetime(),
  battery: BatterySchema,
  agent: z.object({ foreground: z.boolean() }),
  // Older Android agents omitted null because kotlinx.serialization had
  // explicitNulls=false. Accept omission so battery/liveness still work.
  expectedCurrentGame: ExpectedGameSchema.nullable().optional().default(null),
  usage: UsageStateSchema.optional(),
});

export const InstalledAppSchema = z.object({
  packageName: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/),
  label: z.string().min(1).max(128),
  versionName: z.string().max(128).nullable(),
  versionCode: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});

/** Third-party packages visible to the private CafeQuest agent on one headset. */
export const InstalledAppsSchema = z.object({
  type: z.literal("installed_apps"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().uuid(),
  scannedAt: z.string().datetime(),
  apps: z.array(InstalledAppSchema).max(512).superRefine((apps, ctx) => {
    const seen = new Set<string>();
    apps.forEach((app, index) => {
      if (seen.has(app.packageName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "packageName"],
          message: "duplicate packageName",
        });
      }
      seen.add(app.packageName);
    });
  }),
});

export const CommandAckSchema = z.object({
  type: z.literal("command_ack"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  status: z.literal("received"),
  // The connection's own deviceId; the server rejects foreign/unknown ids (P0-A).
  deviceId: z.string().uuid(),
});

export const CommandResultSchema = z.object({
  type: z.literal("command_result"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  status: z.enum(["success", "failed"]),
  error: z.string().max(200).optional(),
  deviceId: z.string().uuid(),
});

/** Ephemeral state of one live-view session as reported by the headset agent. */
export const CastSessionStatusSchema = z.enum([
  "awaiting_approval",
  "negotiating",
  "live",
  "stopped",
  "failed",
]);

/** Stable bounded cast failure codes; never exception strings. */
export const CastFailureCodeSchema = z.enum([
  "consent_denied",
  "approval_timeout",
  "negotiation_timeout",
  "projection_stopped",
  "peer_disconnected",
  "capture_failed",
  "internal_error",
]);

/** Why the server told the agent to stop capturing. */
export const CastStopReasonSchema = z.enum([
  "viewer_stopped",
  "viewer_disconnected",
  "approval_timeout",
  "negotiation_timeout",
  "agent_disconnected",
  "server_stopping",
  "failed",
]);

const castSdpSchema = z.string().min(1).max(MAX_CAST_SDP_CHARS);
const castIceCandidateSchema = z.string().min(1).max(MAX_CAST_ICE_CANDIDATE_CHARS);
const castIceSignalShape = {
  kind: z.literal("ice"),
  candidate: castIceCandidateSchema,
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
};

/**
 * WebRTC signaling union. The agent is always the offerer, so direction is
 * enforced by the schemas below rather than by the storage shape.
 */
export const RtcSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer"), sdp: castSdpSchema }),
  z.object({ kind: z.literal("answer"), sdp: castSdpSchema }),
  z.object(castIceSignalShape),
]);

/** Agent → server: the agent offers and trickles its own ICE only. */
export const AgentRtcSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer"), sdp: castSdpSchema }),
  z.object(castIceSignalShape),
]);

/** Server/viewer → agent: answers and trickled ICE only; an offer is rejected. */
export const AnswerRtcSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), sdp: castSdpSchema }),
  z.object(castIceSignalShape),
]);

/** Agent → server live-view status; deviceId preserves the protocol-v1 ownership rule. */
export const AgentCastStatusSchema = z.object({
  type: z.literal("cast_status"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  status: CastSessionStatusSchema,
  error: CastFailureCodeSchema.optional(),
});

/** Agent → server signaling (offer/ICE); answered by the browser through the server. */
export const AgentCastSignalSchema = z.object({
  type: z.literal("cast_signal"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  signal: AgentRtcSignalSchema,
});

/** Server → agent: start capturing for this session before it expires. */
export const CastRequestSchema = z.object({
  type: z.literal("cast_request"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
});

/** Server → agent: one answer or ICE candidate from the bound viewer. */
export const ServerCastSignalSchema = z.object({
  type: z.literal("cast_signal"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  signal: AnswerRtcSignalSchema,
});

/** Server → agent: stop capturing this session for a bounded reason. */
export const CastStopSchema = z.object({
  type: z.literal("cast_stop"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  reason: CastStopReasonSchema,
});

/** Browser viewer → server: answers and ICE only; the viewer never offers. */
export const ViewerCastSignalSchema = z.object({
  type: z.literal("cast_signal"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  signal: AnswerRtcSignalSchema,
});

/** Server → browser viewer: session state plus the agent's offer/ICE relay. */
export const ViewerCastStatusSchema = z.object({
  type: z.literal("cast_status"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  status: CastSessionStatusSchema,
  error: CastFailureCodeSchema.optional(),
});

export const ViewerCastOfferSchema = z.object({
  type: z.literal("cast_signal"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  signal: AgentRtcSignalSchema,
});

export const AgentMessageSchema = z.discriminatedUnion("type", [
  HelloSchema,
  TelemetrySchema,
  InstalledAppsSchema,
  CommandAckSchema,
  CommandResultSchema,
  AgentCastStatusSchema,
  AgentCastSignalSchema,
]);

export const LaunchPayloadSchema = z
  .object({
    gameId: z.string().min(1),
    gameName: z.string().min(1),
    metaAppId: z.string().min(1).optional(),
    packageName: z
      .string()
      .min(3)
      .max(255)
      .regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/)
      .optional(),
  })
  .superRefine((payload, ctx) => {
    if ((payload.metaAppId === undefined) === (payload.packageName === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "launch payload requires exactly one target",
      });
    }
  });

export const ServerCommandSchema = z.object({
  type: z.literal("command"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  command: z.literal("launch_app"),
  payload: LaunchPayloadSchema,
});

export const ServerErrorSchema = z.object({
  type: z.literal("error"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  code: z.enum([
    "UNSUPPORTED_PROTOCOL_VERSION",
    "MALFORMED_MESSAGE",
    "UNKNOWN_DEVICE",
    "DUPLICATE_DEVICE",
    "DEVICE_MISMATCH",
    "UNKNOWN_COMMAND",
    "FOREIGN_COMMAND",
    "INTERNAL",
  ]),
  message: z.string().max(200),
});

export type Hello = z.infer<typeof HelloSchema>;
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type Telemetry = z.infer<typeof TelemetrySchema>;
export type InstalledApp = z.infer<typeof InstalledAppSchema>;
export type InstalledApps = z.infer<typeof InstalledAppsSchema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type ServerCommand = z.infer<typeof ServerCommandSchema>;
export type ServerError = z.infer<typeof ServerErrorSchema>;
export type ExpectedGame = z.infer<typeof ExpectedGameSchema>;
export type CastSessionStatus = z.infer<typeof CastSessionStatusSchema>;
export type CastFailureCode = z.infer<typeof CastFailureCodeSchema>;
export type CastStopReason = z.infer<typeof CastStopReasonSchema>;
export type RtcSignal = z.infer<typeof RtcSignalSchema>;
export type AgentCastStatus = z.infer<typeof AgentCastStatusSchema>;
export type AgentCastSignal = z.infer<typeof AgentCastSignalSchema>;
export type CastRequest = z.infer<typeof CastRequestSchema>;
export type ServerCastSignal = z.infer<typeof ServerCastSignalSchema>;
export type CastStop = z.infer<typeof CastStopSchema>;
export type ViewerCastSignal = z.infer<typeof ViewerCastSignalSchema>;
export type ViewerCastStatus = z.infer<typeof ViewerCastStatusSchema>;
export type ViewerCastOffer = z.infer<typeof ViewerCastOfferSchema>;
export type ServerCastMessage = CastRequest | ServerCastSignal | CastStop;
export type CastFrameToViewer = ViewerCastStatus | ViewerCastOffer;
