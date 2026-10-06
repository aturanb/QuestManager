import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HelloSchema,
  TelemetrySchema,
  CommandResultSchema,
  ServerCommandSchema,
} from "../src/protocol.js";
import { parseAgentMessage } from "../src/parse.js";

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

test("command_result requires success|failed status", () => {
  assert.equal(
    CommandResultSchema.safeParse({ type: "command_result", protocolVersion: 1, commandId: hello.deviceId, status: "success" }).success,
    true
  );
  assert.equal(
    CommandResultSchema.safeParse({ type: "command_result", protocolVersion: 1, commandId: hello.deviceId, status: "pending" }).success,
    false
  );
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

test("parseAgentMessage: non-object JSON rejected", () => {
  assert.equal(parseAgentMessage("42").ok, false);
  assert.equal(parseAgentMessage("null").ok, false);
});
