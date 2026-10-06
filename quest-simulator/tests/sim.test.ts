import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelayMs } from "../src/backoff.js";
import { normalizeBattery, stepBattery } from "../src/battery.js";
import { makeHello, makeTelemetry } from "../src/protocolClient.js";
import { TelemetrySchema, HelloSchema } from "@cafequest/shared";
import { DeviceSim } from "../src/deviceSim.js";

test("backoff schedule matches brief §25", () => {
  assert.equal(backoffDelayMs(0), 1000);
  assert.equal(backoffDelayMs(1), 2000);
  assert.equal(backoffDelayMs(2), 5000);
  assert.equal(backoffDelayMs(3), 10000);
  assert.equal(backoffDelayMs(4), 30000);
  assert.equal(backoffDelayMs(9), 30000);
});

test("battery normalization clamps invalid values (§33)", () => {
  assert.equal(normalizeBattery(-50), 0);
  assert.equal(normalizeBattery(900), 100);
  assert.equal(normalizeBattery(83.4), 83);
  assert.equal(normalizeBattery(Number.NaN), 0);
});

test("battery steps drain on discharge and charge up", () => {
  const drained = stepBattery({ level: 50, charging: false });
  const charged = stepBattery({ level: 50, charging: true });
  assert.equal(drained.level, 49);
  assert.equal(charged.level, 51);
});

test("sim-built hello and telemetry pass shared schemas", () => {
  const id = "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f";
  const hello = makeHello({ deviceId: id, deviceName: "Quest 03", deviceModel: "Quest 3", agentVersion: "0.1.0" });
  const tel = makeTelemetry({
    deviceId: id,
    timestamp: new Date().toISOString(),
    battery: { level: 83, charging: false },
    agent: { foreground: false },
    expectedCurrentGame: null,
  });
  assert.equal(HelloSchema.safeParse(hello).success, true);
  assert.equal(TelemetrySchema.safeParse(tel).success, true);
});

test("launch behavior switch mutates sim without hardware", () => {
  const sim = new DeviceSim({ name: "T", serverUrl: "ws://localhost:1", battery: { level: 50, charging: false } });
  assert.equal(sim.expectedGame, null);
  sim.setLaunchBehavior("fail");
  sim.setCharging(true);
  assert.equal(sim.battery.charging, true);
});
