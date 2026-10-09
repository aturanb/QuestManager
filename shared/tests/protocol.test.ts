import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HelloSchema,
  TelemetrySchema,
  CommandAckSchema,
  CommandResultSchema,
  ServerCommandSchema,
  ServerErrorSchema,
  InstalledAppsSchema,
  AgentCastStatusSchema,
  AgentCastSignalSchema,
  CastRequestSchema,
  ServerCastSignalSchema,
  CastStopSchema,
  ViewerCastSignalSchema,
  ViewerCastOfferSchema,
  RtcSignalSchema,
  MAX_CAST_SDP_CHARS,
  MAX_CAST_ICE_CANDIDATE_CHARS,
  SCREEN_CAST_CAPABILITY,
} from "../src/protocol.js";
import { parseAgentMessage } from "../src/parse.js";

const castSessionId = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

const hello = {
  type: "hello",
  protocolVersion: 1,
  deviceId: "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f",
  deviceName: "Quest 03",
  deviceModel: "Quest 3",
  agentVersion: "0.1.0",
};

const telemetry = {
  type: "telemetry",
  protocolVersion: 1,
  deviceId: "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f",
  timestamp: new Date().toISOString(),
  battery: { level: 83, charging: false },
  agent: { foreground: false },
  expectedCurrentGame: {
    gameId: "beat-saber",
    name: "Beat Saber",
    launchedAt: new Date().toISOString(),
  },
};

test("hello schema accepts a valid hello", () => {
  assert.equal(HelloSchema.safeParse(hello).success, true);
});

test("hello advertises package-launch support without breaking older agents", () => {
  const capable = HelloSchema.safeParse({
    ...hello,
    capabilities: ["launch_android_package"],
  });

  assert.equal(capable.success, true);
  if (capable.success) assert.deepEqual(capable.data.capabilities, ["launch_android_package"]);
  const future = HelloSchema.safeParse({ ...hello, capabilities: ["future_capability"] });
  assert.equal(future.success, true);
  if (future.success) assert.deepEqual(future.data.capabilities, ["future_capability"]);
  assert.equal(HelloSchema.safeParse(hello).success, true);
});

test("telemetry schema rejects battery -50 and 900 (§33)", () => {
  assert.equal(TelemetrySchema.safeParse({ ...telemetry, battery: { level: -50, charging: false } }).success, false);
  assert.equal(TelemetrySchema.safeParse({ ...telemetry, battery: { level: 900, charging: false } }).success, false);
  assert.equal(TelemetrySchema.safeParse({ ...telemetry, battery: { level: 0, charging: true } }).success, true);
  assert.equal(TelemetrySchema.safeParse({ ...telemetry, battery: { level: 100, charging: true } }).success, true);
});

test("telemetry schema rejects wrong protocolVersion and missing deviceId", () => {
  assert.equal(TelemetrySchema.safeParse({ ...telemetry, protocolVersion: 2 }).success, false);
  const { deviceId: _drop, ...noId } = telemetry;
  assert.equal(TelemetrySchema.safeParse(noId).success, false);
});

test("telemetry accepts omitted nullable expected game and foreground usage state", () => {
  const withoutExpectedGame = {
    type: "telemetry",
    protocolVersion: 1,
    deviceId: hello.deviceId,
    timestamp: new Date().toISOString(),
    battery: { level: 73, charging: true },
    agent: { foreground: true },
    usage: {
      accessGranted: true,
      foregroundApp: {
        packageName: "com.TriangleFactory.Breachers",
        startedAt: "2026-10-08T15:30:00.000Z",
      },
    },
  };

  const parsed = TelemetrySchema.safeParse(withoutExpectedGame);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.expectedCurrentGame, null);
    assert.equal(parsed.data.usage?.foregroundApp?.packageName, "com.TriangleFactory.Breachers");
  }
});

test("telemetry rejects malformed foreground package and timestamp", () => {
  const base = {
    ...telemetry,
    usage: { accessGranted: true, foregroundApp: null },
  };
  assert.equal(
    TelemetrySchema.safeParse({
      ...base,
      usage: { accessGranted: true, foregroundApp: { packageName: "bad package", startedAt: new Date().toISOString() } },
    }).success,
    false,
  );
  assert.equal(
    TelemetrySchema.safeParse({
      ...base,
      usage: { accessGranted: true, foregroundApp: { packageName: "com.example.game", startedAt: "yesterday" } },
    }).success,
    false,
  );
});

test("command_ack and command_result require owning deviceId", () => {
  const ack = { type: "command_ack", protocolVersion: 1, commandId: hello.deviceId, status: "received", deviceId: hello.deviceId };
  assert.equal(CommandAckSchema.safeParse(ack).success, true);
  const { deviceId: _d1, ...ackNoId } = ack;
  assert.equal(CommandAckSchema.safeParse(ackNoId).success, false);
  const res = { type: "command_result", protocolVersion: 1, commandId: hello.deviceId, status: "success" as const, deviceId: hello.deviceId };
  assert.equal(CommandResultSchema.safeParse(res).success, true);
  const { deviceId: _d2, ...resNoId } = res;
  assert.equal(CommandResultSchema.safeParse(resNoId).success, false);
});

test("a hello from a 0.2.0 agent still carrying enrollmentKey parses without it", () => {
  const parsed = HelloSchema.safeParse({ ...hello, enrollmentKey: "cafe-secret" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal("enrollmentKey" in parsed.data, false);
});

test("server error schema carries ownership codes, and no enrollment code", () => {
  assert.equal(
    ServerErrorSchema.safeParse({ type: "error", protocolVersion: 1, code: "ENROLLMENT_REJECTED", message: "x" }).success,
    false,
  );
  for (const code of ["DEVICE_MISMATCH", "UNKNOWN_COMMAND", "FOREIGN_COMMAND", "DUPLICATE_DEVICE"]) {
    assert.equal(
      ServerErrorSchema.safeParse({ type: "error", protocolVersion: 1, code, message: "x" }).success,
      true,
      code
    );
  }
});

test("command_result requires success|failed status", () => {
  const base = { type: "command_result", protocolVersion: 1, commandId: hello.deviceId, deviceId: hello.deviceId };
  assert.equal(CommandResultSchema.safeParse({ ...base, status: "success" }).success, true);
  assert.equal(CommandResultSchema.safeParse({ ...base, status: "failed", error: "TARGET_NOT_INSTALLED" }).success, true);
  assert.equal(CommandResultSchema.safeParse({ ...base, status: "pending" }).success, false);
});

test("server command schema matches brief §20 shape", () => {
  const cmd = {
    type: "command",
    protocolVersion: 1,
    commandId: "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f",
    command: "launch_app",
    payload: { gameId: "beat-saber", gameName: "Beat Saber", metaAppId: "1234" },
  };
  assert.equal(ServerCommandSchema.safeParse(cmd).success, true);
});

test("launch command accepts exactly one Meta or Android package target", () => {
  const base = {
    type: "command",
    protocolVersion: 1,
    commandId: hello.deviceId,
    command: "launch_app",
    payload: { gameId: "local-game", gameName: "Local Game" },
  } as const;

  assert.equal(
    ServerCommandSchema.safeParse({ ...base, payload: { ...base.payload, metaAppId: "12345" } }).success,
    true,
  );
  assert.equal(
    ServerCommandSchema.safeParse({ ...base, payload: { ...base.payload, packageName: "com.example.localgame" } }).success,
    true,
  );
  assert.equal(ServerCommandSchema.safeParse(base).success, false);
  assert.equal(
    ServerCommandSchema.safeParse({
      ...base,
      payload: { ...base.payload, metaAppId: "12345", packageName: "com.example.localgame" },
    }).success,
    false,
  );
});

test("parseAgentMessage: invalid JSON is rejected safely", () => {
  const r = parseAgentMessage("{not json");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MALFORMED_MESSAGE");
});

test("parseAgentMessage: missing type rejected", () => {
  const r = parseAgentMessage(JSON.stringify({ protocolVersion: 1 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MALFORMED_MESSAGE");
});

test("parseAgentMessage: wrong protocolVersion yields specific error (§34)", () => {
  const r = parseAgentMessage(JSON.stringify({ ...hello, protocolVersion: 99 }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "UNSUPPORTED_PROTOCOL_VERSION");
    assert.match(r.message, /99/);
  }
});

test("parseAgentMessage: valid hello parses", () => {
  const r = parseAgentMessage(JSON.stringify(hello));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.type, "hello");
});

test("installed_apps accepts a bounded device inventory and parses as an agent message", () => {
  const inventory = {
    type: "installed_apps",
    protocolVersion: 1,
    deviceId: hello.deviceId,
    scannedAt: new Date().toISOString(),
    apps: [
      {
        packageName: "com.TriangleFactory.Breachers",
        label: "Breachers",
        versionName: "1.2.3",
        versionCode: 42,
      },
    ],
  };

  assert.equal(InstalledAppsSchema.safeParse(inventory).success, true);
  const parsed = parseAgentMessage(JSON.stringify(inventory));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.type, "installed_apps");
});

test("installed_apps rejects unsafe package data and oversized inventories", () => {
  const base = {
    type: "installed_apps",
    protocolVersion: 1,
    deviceId: hello.deviceId,
    scannedAt: new Date().toISOString(),
  };
  assert.equal(
    InstalledAppsSchema.safeParse({
      ...base,
      apps: [{ packageName: "bad package/name", label: "Bad", versionName: null, versionCode: null }],
    }).success,
    false
  );
  assert.equal(
    InstalledAppsSchema.safeParse({
      ...base,
      apps: Array.from({ length: 513 }, (_, i) => ({
        packageName: `com.example.app${i}`,
        label: `App ${i}`,
        versionName: null,
        versionCode: null,
      })),
    }).success,
    false
  );
  const duplicate = { packageName: "com.example.same", label: "Same", versionName: null, versionCode: null };
  assert.equal(
    InstalledAppsSchema.safeParse({ ...base, apps: [duplicate, { ...duplicate, label: "Duplicate" }] }).success,
    false
  );
});

test("parseAgentMessage: non-object JSON rejected", () => {
  assert.equal(parseAgentMessage("42").ok, false);
  assert.equal(parseAgentMessage("null").ok, false);
});

// --- Screen cast protocol (screen_cast_v1) ---------------------------------

test("hello accepts screen_cast_v1 beside package launch and still parses without capabilities", () => {
  const both = HelloSchema.safeParse({
    ...hello,
    capabilities: ["launch_android_package", SCREEN_CAST_CAPABILITY],
  });
  assert.equal(both.success, true);
  if (both.success) assert.deepEqual(both.data.capabilities, ["launch_android_package", "screen_cast_v1"]);
  assert.equal(HelloSchema.safeParse(hello).success, true);
});

test("rtc signals bound SDP and ICE candidates exactly at their caps", () => {
  assert.equal(RtcSignalSchema.safeParse({ kind: "offer", sdp: "x".repeat(MAX_CAST_SDP_CHARS) }).success, true);
  assert.equal(RtcSignalSchema.safeParse({ kind: "answer", sdp: "x".repeat(MAX_CAST_SDP_CHARS) }).success, true);
  assert.equal(RtcSignalSchema.safeParse({ kind: "offer", sdp: "x".repeat(MAX_CAST_SDP_CHARS + 1) }).success, false);
  const ice = { kind: "ice", candidate: "c".repeat(MAX_CAST_ICE_CANDIDATE_CHARS), sdpMid: "0", sdpMLineIndex: 0 };
  assert.equal(RtcSignalSchema.safeParse(ice).success, true);
  assert.equal(
    RtcSignalSchema.safeParse({ kind: "ice", candidate: "c".repeat(MAX_CAST_ICE_CANDIDATE_CHARS + 1) }).success,
    false,
  );
  assert.equal(RtcSignalSchema.safeParse({ kind: "ice", candidate: "" }).success, false);
});

test("agent cast frames require deviceId and a UUID sessionId through parseAgentMessage", () => {
  const status = {
    type: "cast_status",
    protocolVersion: 1,
    deviceId: hello.deviceId,
    sessionId: castSessionId,
    status: "awaiting_approval",
  };
  const parsedStatus = parseAgentMessage(JSON.stringify(status));
  assert.equal(parsedStatus.ok, true);
  if (parsedStatus.ok) assert.equal(parsedStatus.value.type, "cast_status");
  const { deviceId: _d, ...statusNoId } = status;
  assert.equal(AgentCastStatusSchema.safeParse(statusNoId).success, false);
  assert.equal(AgentCastStatusSchema.safeParse({ ...status, sessionId: "not-a-uuid" }).success, false);
  assert.equal(AgentCastStatusSchema.safeParse({ ...status, status: "reserved" }).success, false);
  assert.equal(
    AgentCastStatusSchema.safeParse({ ...status, status: "failed", error: "consent_denied" }).success,
    true,
  );
  assert.equal(AgentCastStatusSchema.safeParse({ ...status, status: "failed", error: "boom: stacktrace" }).success, false);

  const signal = {
    type: "cast_signal",
    protocolVersion: 1,
    deviceId: hello.deviceId,
    sessionId: castSessionId,
    signal: { kind: "offer", sdp: "v=0" },
  };
  const parsedSignal = parseAgentMessage(JSON.stringify(signal));
  assert.equal(parsedSignal.ok, true);
  if (parsedSignal.ok) assert.equal(parsedSignal.value.type, "cast_signal");
  assert.equal(AgentCastSignalSchema.safeParse({ ...signal, signal: { kind: "answer", sdp: "v=0" } }).success, false);
  const { deviceId: _d2, ...signalNoId } = signal;
  assert.equal(AgentCastSignalSchema.safeParse(signalNoId).success, false);
});

test("server-to-agent cast frames accept only their exact direction and shape", () => {
  assert.equal(
    CastRequestSchema.safeParse({
      type: "cast_request",
      protocolVersion: 1,
      sessionId: castSessionId,
      expiresAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    CastRequestSchema.safeParse({ type: "cast_stop", protocolVersion: 1, sessionId: castSessionId, reason: "failed" })
      .success,
    false,
  );
  assert.equal(
    ServerCastSignalSchema.safeParse({ type: "cast_signal", protocolVersion: 1, sessionId: castSessionId, signal: { kind: "answer", sdp: "v=0" } })
      .success,
    true,
  );
  assert.equal(
    ServerCastSignalSchema.safeParse({ type: "cast_signal", protocolVersion: 1, sessionId: castSessionId, signal: { kind: "offer", sdp: "v=0" } })
      .success,
    false,
  );
  assert.equal(
    CastStopSchema.safeParse({ type: "cast_stop", protocolVersion: 1, sessionId: castSessionId, reason: "viewer_stopped" })
      .success,
    true,
  );
  assert.equal(
    CastStopSchema.safeParse({ type: "cast_stop", protocolVersion: 1, sessionId: castSessionId, reason: "whatever" })
      .success,
    false,
  );
});

test("viewer cast signal accepts answer and ICE but rejects an offer", () => {
  const base = { type: "cast_signal", protocolVersion: 1, sessionId: castSessionId };
  assert.equal(ViewerCastSignalSchema.safeParse({ ...base, signal: { kind: "answer", sdp: "v=0" } }).success, true);
  assert.equal(ViewerCastSignalSchema.safeParse({ ...base, signal: { kind: "ice", candidate: "candidate:1 1 udp 1 10.0.0.1 1 typ host" } }).success, true);
  assert.equal(ViewerCastSignalSchema.safeParse({ ...base, signal: { kind: "offer", sdp: "v=0" } }).success, false);
  assert.equal(ViewerCastOfferSchema.safeParse({ ...base, signal: { kind: "offer", sdp: "v=0" } }).success, true);
  assert.equal(ViewerCastOfferSchema.safeParse({ ...base, signal: { kind: "answer", sdp: "v=0" } }).success, false);
});

test("legacy launch and telemetry messages still parse unchanged", () => {
  const launch = {
    type: "command",
    protocolVersion: 1,
    commandId: castSessionId,
    command: "launch_app",
    payload: { gameId: "beat-saber", gameName: "Beat Saber", metaAppId: "1234" },
  };
  assert.equal(ServerCommandSchema.safeParse(launch).success, true);
  assert.equal(parseAgentMessage(JSON.stringify(telemetry)).ok, true);
});
