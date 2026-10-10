// The monitoring frame, the agent's wirelessDebugging report, and the actionable
// reasons, through the real app boundary. Fake sockets only; no real adb runs.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice } from "../src/store.js";
import type { AdbRunner } from "../src/controller-battery.js";

const ADMIN = "monitoring-frames-key-123";
const CAPABLE = ["launch_android_package", "controller_monitoring_v1"];

let connectFails = true;
const runner: AdbRunner = async (_executable, args) => {
  const [command] = args;
  if (command === "version") return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
  if (command === "connect") {
    if (connectFails) throw new Error("adb connect failed");
    return { stdout: `connected to ${args[1] ?? ""}\n`, stderr: "" };
  }
  return { stdout: "", stderr: "" };
};

const { app, db, hub, controllerBatteryCollector } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  adminApiKey: ADMIN,
  controllerBattery: { adbPath: "adb", runner, pollIntervalMs: 60_000 },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
after(() => app.close());

type FakeSocket = { sent: string[]; send: (d: string) => void; close: () => void; ping: () => void };
function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    send: (data) => {
      socket.sent.push(String(data));
    },
    close: () => {},
    ping: () => {},
  };
  return socket;
}

function frames(socket: FakeSocket): Array<{ type: string; enabled?: boolean }> {
  return socket.sent.map((raw) => JSON.parse(raw)).filter((f) => f.type === "controller_monitoring");
}

function putMonitoring(enabled: boolean) {
  return fetch(`${base}/api/settings/controller-battery-monitoring`, {
    method: "PUT",
    headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

function connect(capabilities: string[], ip = "192.168.1.60") {
  const id = randomUUID();
  upsertDevice(db, { id, name: `Quest ${id.slice(0, 4)}` });
  const socket = fakeSocket();
  hub.addAgentSocket(id, socket as never, capabilities, ip);
  return { id, socket };
}

/**
 * The switch (or a connect) may leave a cycle already running that started before
 * the latest change. The first await lets it finish; the second runs a cycle that
 * is guaranteed to start after it, so it sees every device and report made so far.
 */
async function freshCycle() {
  await controllerBatteryCollector.pollNow();
  await controllerBatteryCollector.pollNow();
}

function telemetry(deviceId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "telemetry",
    protocolVersion: 1,
    deviceId,
    timestamp: new Date().toISOString(),
    battery: { level: 77, charging: false },
    agent: { foreground: true },
    ...extra,
  });
}

test("a capable agent is told the current flag at hello; an agent without the capability gets nothing", async () => {
  await putMonitoring(false);
  const capable = connect(CAPABLE);
  const legacy = connect(["launch_android_package"]);
  assert.deepEqual(frames(capable.socket), [{ type: "controller_monitoring", protocolVersion: 1, enabled: false }]);
  assert.deepEqual(frames(legacy.socket), []);
});

test("an agent connecting while monitoring is already on is told immediately", async () => {
  await putMonitoring(true);
  const late = connect(CAPABLE);
  assert.equal(frames(late.socket)[0]?.enabled, true);
  await putMonitoring(false);
});

test("flipping the switch reaches every connected capable agent and no other", async () => {
  await putMonitoring(false);
  const a = connect(CAPABLE, "192.168.1.61");
  const b = connect(CAPABLE, "192.168.1.62");
  const legacy = connect(["launch_android_package"], "192.168.1.63");
  await putMonitoring(true);
  await putMonitoring(false);
  for (const agent of [a, b]) {
    assert.deepEqual(
      frames(agent.socket).map((f) => f.enabled),
      [false, true, false],
      "hello flag, then on, then off"
    );
  }
  assert.deepEqual(frames(legacy.socket), []);
});

test("the agent's wirelessDebugging report turns a failed connect into an actionable reason", async () => {
  connectFails = true;
  await putMonitoring(true);
  const { id, socket } = connect(CAPABLE, "192.168.1.70");
  const expectations: Array<[string, string]> = [
    ["off", "wireless_debugging_off"],
    ["not_permitted", "agent_permission_missing"],
    ["on", "adb_connect_failed"],
  ];
  for (const [reported, reason] of expectations) {
    hub.handleAgentMessage(id, socket as never, telemetry(id, { wirelessDebugging: reported }));
    await freshCycle();
    const device = hub.snapshot().devices.find((d: { id: string }) => d.id === id);
    assert.equal(device?.controllerBattery?.reason, reason, reported);
  }
  await putMonitoring(false);
});

test("a reachable headset shows no Wireless Debugging hint even while the agent reports off", async () => {
  connectFails = false;
  await putMonitoring(true);
  const { id, socket } = connect(CAPABLE, "192.168.1.71");
  hub.handleAgentMessage(id, socket as never, telemetry(id, { wirelessDebugging: "off" }));
  await freshCycle();
  const device = hub.snapshot().devices.find((d: { id: string }) => d.id === id);
  assert.notEqual(device?.controllerBattery?.reason, "wireless_debugging_off");
  assert.notEqual(device?.controllerBattery?.reason, "agent_permission_missing");
  connectFails = true;
  await putMonitoring(false);
});

test("an unknown wirelessDebugging value never blocks telemetry or liveness", async () => {
  const { id, socket } = connect(CAPABLE, "192.168.1.72");
  hub.handleAgentMessage(id, socket as never, telemetry(id, { wirelessDebugging: "from_the_future" }));
  const errors = socket.sent.map((raw) => JSON.parse(raw)).filter((f) => f.type === "error");
  assert.deepEqual(errors, [], "the frame was accepted");
  const device = hub.snapshot().devices.find((d: { id: string }) => d.id === id);
  assert.equal(device?.batteryLevel, 77, "battery telemetry still landed");
  assert.equal(device?.online, true);
  assert.ok(
    !hub.controllerBatteryTargets().find((t) => t.deviceId === id)?.wirelessDebugging,
    "the unknown value is dropped, not stored"
  );
});
