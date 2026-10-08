import { z } from "zod";

export const PROTOCOL_VERSION = 1;

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
  // Presented at enrollment; required only when the server sets DEVICE_ENROLLMENT_KEY (§35).
  enrollmentKey: z.string().min(1).max(128).optional(),
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

export const AgentMessageSchema = z.discriminatedUnion("type", [
  HelloSchema,
  TelemetrySchema,
  InstalledAppsSchema,
  CommandAckSchema,
  CommandResultSchema,
]);

export const ServerCommandSchema = z.object({
  type: z.literal("command"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  command: z.literal("launch_app"),
  payload: z.object({
    gameId: z.string().min(1),
    gameName: z.string().min(1),
    metaAppId: z.string().min(1),
  }),
});

export const ServerErrorSchema = z.object({
  type: z.literal("error"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  code: z.enum([
    "UNSUPPORTED_PROTOCOL_VERSION",
    "MALFORMED_MESSAGE",
    "UNKNOWN_DEVICE",
    "DUPLICATE_DEVICE",
    "ENROLLMENT_REJECTED",
    "DEVICE_MISMATCH",
    "UNKNOWN_COMMAND",
    "FOREIGN_COMMAND",
    "INTERNAL",
  ]),
  message: z.string().max(200),
});

export type Hello = z.infer<typeof HelloSchema>;
export type Telemetry = z.infer<typeof TelemetrySchema>;
export type InstalledApp = z.infer<typeof InstalledAppSchema>;
export type InstalledApps = z.infer<typeof InstalledAppsSchema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type ServerCommand = z.infer<typeof ServerCommandSchema>;
export type ServerError = z.infer<typeof ServerErrorSchema>;
export type ExpectedGame = z.infer<typeof ExpectedGameSchema>;
