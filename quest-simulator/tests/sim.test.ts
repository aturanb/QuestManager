import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelayMs } from "../src/backoff.js";
import { normalizeBattery, stepBattery } from "../src/battery.js";
import { makeHello, makeTelemetry } from "../src/protocolClient.js";
import { TelemetrySchema, HelloSchema } from "@cafequest/shared";
import { DeviceSim, SIM_INSTALLED_APPS, resolveSimPackage, stableDeviceId } from "../src/deviceSim.js";

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

test("stableDeviceId yields deterministic valid UUIDs (P0-D)", () => {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(stableDeviceId(1), uuidRe);
  assert.equal(stableDeviceId(3), stableDeviceId(3));
  assert.notEqual(stableDeviceId(1), stableDeviceId(2));
  assert.match(stableDeviceId(8), uuidRe);
});

test("launch behavior switch mutates sim without hardware", () => {
  const sim = new DeviceSim({ name: "T", serverUrl: "ws://localhost:1", battery: { level: 50, charging: false } });
  assert.equal(sim.expectedGame, null);
  sim.setLaunchBehavior("fail");
  sim.setCharging(true);
  assert.equal(sim.battery.charging, true);
});

test("sim resolves a launch command to one of its own installed packages", () => {
  const beatSaber = SIM_INSTALLED_APPS.find((a) => a.label === "Beat Saber");
  assert.ok(beatSaber, "fixture should include Beat Saber");

  // Dashboard installed-app launches carry the package in the game id.
  assert.equal(
    resolveSimPackage("installed:com.beatgames.beatsaber", "Beat Saber"),
    "com.beatgames.beatsaber"
  );
  // Configured-game launches only carry a display name.
  assert.equal(resolveSimPackage("beat-saber", "Beat Saber"), beatSaber.packageName);
  // A game the sim does not have installed reports no foreground package.
  assert.equal(resolveSimPackage("some-other-game", "Some Other Game"), null);
});

test("sim telemetry reports usage access and the current foreground app", () => {
  const sim = new DeviceSim({ name: "T", serverUrl: "ws://localhost:1", battery: { level: 50, charging: false } });
  assert.equal(sim.foregroundApp, null);

  const first = sim.buildTelemetry();
  assert.equal(TelemetrySchema.safeParse(first).success, true);
  assert.equal(first.usage?.accessGranted, true);
  assert.equal(first.usage?.foregroundApp, null);

  sim.setForegroundPackage("com.beatgames.beatsaber");
  const second = sim.buildTelemetry();
  assert.equal(TelemetrySchema.safeParse(second).success, true);
  assert.equal(second.usage?.foregroundApp?.packageName, "com.beatgames.beatsaber");
  const startedAt = second.usage?.foregroundApp?.startedAt;

  // Re-reporting the same package keeps the original start time, as the agent does.
  sim.setForegroundPackage("com.beatgames.beatsaber");
  assert.equal(sim.buildTelemetry().usage?.foregroundApp?.startedAt, startedAt);
});
