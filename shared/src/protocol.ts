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
});

export const BatterySchema = z.object({
  level: z.number().int().min(0).max(100),
  charging: z.boolean(),
});

export const TelemetrySchema = z.object({
  type: z.literal("telemetry"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().uuid(),
  timestamp: z.string().datetime(),
  battery: BatterySchema,
  agent: z.object({ foreground: z.boolean() }),
  expectedCurrentGame: ExpectedGameSchema.nullable(),
});

export const CommandAckSchema = z.object({
  type: z.literal("command_ack"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  status: z.literal("received"),
});

export const CommandResultSchema = z.object({
  type: z.literal("command_result"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  status: z.enum(["success", "failed"]),
  error: z.string().max(200).optional(),
});

export const AgentMessageSchema = z.discriminatedUnion("type", [
  HelloSchema,
  TelemetrySchema,
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
    "INTERNAL",
  ]),
  message: z.string().max(200),
});

export type Hello = z.infer<typeof HelloSchema>;
export type Telemetry = z.infer<typeof TelemetrySchema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type ServerCommand = z.infer<typeof ServerCommandSchema>;
export type ServerError = z.infer<typeof ServerErrorSchema>;
export type ExpectedGame = z.infer<typeof ExpectedGameSchema>;
