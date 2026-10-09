// Controller battery monitoring through the real app boundary: the setting
// persists, the snapshot carries bounded fields, IP matching picks only
// pollable sockets, and nothing here can disturb liveness, sessions, or launches.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import {
  getControllerBatteryMonitoringEnabled,
  setControllerBatteryMonitoringEnabled,
  touchDevice,
  upsertDevice,
} from "../src/store.js";
import type { AdbRunner } from "../src/controller-battery.js";

const ADMIN = "controller-admin-key-789";

const RIGHT_LINE =
  "  Paired device: c064a7beb7813010, Type:  Right, Model: RUBYPRQ, HardwareRev: 0x9a, Firmware: 207.5.0, ImuModel: ICM42686, Battery:  80%, isAttached: 0, Serial Number: 2L0YNB2G7Z041D, Status: Disabled, ExternalStatus: DISABLED, TrackingStatus: POSITION, BrightnessLevel: GOOD";
const LEFT_LINE =
  "  Paired device: 89e1939fc347db94, Type:   Left, Model: RUBYPRQ, HardwareRev: 0x9a, Firmware: 207.5.0, ImuModel: ICM42686, Battery: 100%, isAttached: 0, Serial Number: 2L0YMB4G7Z0CQG, Status: Disabled, ExternalStatus: DISABLED, TrackingStatus: NONE, BrightnessLevel: GOOD";
const FIXTURE = `ControllerGlue Status\n${RIGHT_LINE}\n${LEFT_LINE}\n`;

class FakeAdb {
  calls: string[][] = [];
  versionOk = true;
  connectThrows = false;
  dumpThrows = false;
  connectText = (endpoint: string) => `connected to ${endpoint}`;
  dumpText = () => FIXTURE;

  runner: AdbRunner = async (executable, args) => {
    this.calls.push([executable, ...args]);
    const [command] = args;
    if (command === "version") {
      if (!this.versionOk) throw new Error("spawn adb ENOENT");
      return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
    }
    if (command === "connect") {
      if (this.connectThrows) throw new Error("adb connect failed");
      const endpoint = args[1] ?? "";
      const stdout = this.connectText(endpoint);
      if (stdout.toLowerCase().includes("failed")) throw new Error("adb connect failed");
      return { stdout: `${stdout}\n`, stderr: "" };
    }
    if (command === "-s") {
      if (this.dumpThrows) throw new Error("adb: device offline");
      return { stdout: this.dumpText(), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };

  count(command: string): number {
    return this.calls.filter((call) => call[1] === command).length;
  }
}

type FakeSocket = {
  sent: string[];
  closed: Array<[number, string]>;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  ping: () => void;
};

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    closed: [],
    send: (data) => {
      socket.sent.push(String(data));
    },
    close: (code, reason) => {
      socket.closed.push([code ?? 0, reason ?? ""]);
    },
    ping: () => {},
  };
  return socket;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const adb = new FakeAdb();
const { app, db, hub, controllerBatteryCollector } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  adminApiKey: ADMIN,
  controllerBattery: { adbPath: "/opt/platform-tools/adb", runner: adb.runner, pollIntervalMs: 60_000 },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const port = typeof address === "object" && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
const auth = { authorization: `Bearer ${ADMIN}` };
after(() => app.close());

function putSetting(body: unknown, key: string | null = ADMIN) {
  return fetch(`${base}/api/settings/controller-battery-monitoring`, {
    method: "PUT",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function snapshot(): Promise<any> {
  const res = await fetch(`${base}/api/devices`, { headers: auth });
  return res.json();
}

function deviceIn(snap: any, id: string) {
  return snap.devices.find((d: any) => d.id === id);
}

test("monitoring is off by default and the snapshot says so", async () => {
  const snap = await snapshot();
  assert.deepEqual(snap.controllerBatteryMonitoring, { enabled: false, availability: "disabled" });
  assert.equal(getControllerBatteryMonitoringEnabled(db), false);
  assert.equal(adb.calls.length, 0, "no adb process while monitoring is off");
  for (const device of snap.devices) assert.equal(device.controllerBattery, null);
  assert.equal(controllerBatteryCollector.deviceState("anything"), null);
});

test("the setting endpoint requires the admin key and an exact boolean body", async () => {
  assert.equal((await putSetting({ enabled: true }, null)).status, 401);
  assert.equal((await putSetting({ enabled: true }, "wrong")).status, 401);
  for (const body of [{}, { enabled: "true" }, { enabled: 1 }, { enabled: true, extra: true }, { enabled: null }]) {
    const res = await putSetting(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(getControllerBatteryMonitoringEnabled(db), false, "a rejected body never changes the setting");
});

test("enabling starts collection, is idempotent, and reaches the dashboard socket", async () => {
  const dashboard = new WebSocket(`${wsBase}/dashboard-ws?key=${ADMIN}`);
  const pushes: any[] = [];
  dashboard.on("message", (m) => {
    try {
      pushes.push(JSON.parse(String(m)));
    } catch {
      /* ignore */
    }
  });
  await new Promise<void>((resolve, reject) => {
    dashboard.on("open", () => resolve());
    dashboard.on("error", reject);
  });

  const enabled = await putSetting({ enabled: true });
  assert.equal(enabled.status, 200);
  const body = (await enabled.json()) as any;
  assert.equal(body.controllerBatteryMonitoring.enabled, true);
  assert.equal(body.controllerBatteryMonitoring.availability, "no_devices", "no headset is connected yet");
  assert.equal(getControllerBatteryMonitoringEnabled(db), true, "the intent is persisted");

  const again = await putSetting({ enabled: true });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as any).controllerBatteryMonitoring.enabled, true);
  assert.equal(adb.calls.length > 0, true, "enabling checks adb availability without touching a headset");
  assert.equal(adb.count("-s"), 0);

  const pushed = pushes.find((m) => m.type === "state" && m.payload?.controllerBatteryMonitoring?.enabled === true);
  assert.ok(pushed, "a live dashboard socket must see the monitoring state");
  assert.equal(pushed.payload.devices.length, 0);
  dashboard.close();
});

test("a live socket's LAN address becomes the ADB endpoint, and impossible ones never do", async () => {
  const lanId = randomUUID();
  upsertDevice(db, { id: lanId, name: "Quest LAN" });
  const socket = fakeSocket();
  hub.addAgentSocket(lanId, socket as never, ["launch_android_package"], "192.168.1.55");
  assert.deepEqual(hub.controllerBatteryTargets(), [{ deviceId: lanId, address: "192.168.1.55" }]);

  const loopbackId = randomUUID();
  upsertDevice(db, { id: loopbackId, name: "Quest Loopback" });
  hub.addAgentSocket(loopbackId, fakeSocket() as never, [], "127.0.0.1");
  const targets = hub.controllerBatteryTargets();
  assert.deepEqual(
    targets.find((t) => t.deviceId === loopbackId),
    { deviceId: loopbackId, address: null },
    "loopback is not a pollable endpoint"
  );
  assert.equal(controllerBatteryCollector.deviceState(loopbackId)?.reason, "no_wireless_address");

  const hostileId = randomUUID();
  upsertDevice(db, { id: hostileId, name: "Quest Hostile" });
  hub.addAgentSocket(hostileId, fakeSocket() as never, [], "192.168.1.20; reboot");
  assert.equal(hub.controllerBatteryTargets().find((t) => t.deviceId === hostileId)?.address, null);
  assert.equal(hub.controllerBatteryTargets().length, 3);
  assert.ok(!adb.calls.some((call) => call.includes("192.168.1.20; reboot")), "a hostile address never reaches execFile");

  // Newest hello wins, including its address; the replaced socket is told why.
  hub.addAgentSocket(lanId, fakeSocket() as never, [], "192.168.1.56");
  assert.equal(hub.controllerBatteryTargets().find((t) => t.deviceId === lanId)?.address, "192.168.1.56");
  assert.equal(socket.closed[0]?.[0], 4001);

  const snap = await snapshot();
  assert.equal(deviceIn(snap, lanId).controllerBattery.status, "unavailable", "no reading before a cycle runs");
  assert.equal(deviceIn(snap, lanId).controllerBattery.reason, null);
});

test("a successful cycle publishes left and right readings for a matched headset", async () => {
  const deviceId = randomUUID();
  upsertDevice(db, { id: deviceId, name: "Quest Readings" });
  const socket = fakeSocket();
  hub.addAgentSocket(deviceId, socket as never, [], "192.168.1.57");

  await controllerBatteryCollector.pollNow();
  const snap = await snapshot();
  assert.deepEqual(snap.controllerBatteryMonitoring, { enabled: true, availability: "ready" });
  const battery = deviceIn(snap, deviceId).controllerBattery;
  assert.deepEqual(battery.left, { level: 100, state: "inactive" });
  assert.deepEqual(battery.right, { level: 80, state: "inactive" });
  assert.equal(battery.status, "available");
  assert.equal(battery.reason, null);
  assert.equal(typeof battery.observedAt, "string");
  assert.ok(
    adb.calls.some((call) => call.join(" ") === "/opt/platform-tools/adb connect 192.168.1.57:5555"),
    "the endpoint comes from the socket, as argv"
  );

  // A device that is no longer connected reports headset_offline, without ADB work.
  hub.removeAgentSocket(deviceId, socket as never);
  assert.equal(controllerBatteryCollector.deviceState(deviceId)?.reason, "headset_offline");
  assert.equal(socket.closed.length, 0, "the owning socket was removed, not replaced");
});

test("a failed cycle keeps the last reading as stale and leaves the rest of the device alone", async () => {
  const deviceId = randomUUID();
  upsertDevice(db, { id: deviceId, name: "Quest Stale" });
  // Real agent telemetry: the ADB failure must not touch any of it.
  touchDevice(db, deviceId, { batteryLevel: 55, charging: false });
  hub.addAgentSocket(deviceId, fakeSocket() as never, [], "192.168.1.61");
  await controllerBatteryCollector.pollNow();
  const good = controllerBatteryCollector.deviceState(deviceId);
  assert.equal(good?.status, "available");

  adb.dumpThrows = true;
  await controllerBatteryCollector.pollNow();
  adb.dumpThrows = false;
  const stale = controllerBatteryCollector.deviceState(deviceId);
  assert.equal(stale?.status, "stale");
  assert.equal(stale?.reason, "dump_failed");

  const snap = await snapshot();
  const device = deviceIn(snap, deviceId);
  assert.equal(device.online, true, "ADB failures never change online state");
  assert.equal(device.batteryLevel, 55, "headset battery telemetry is untouched");
  assert.equal(device.charging, false);
  assert.deepEqual(device.controllerBattery.left, { level: 100, state: "inactive" });
  assert.deepEqual(device.controllerBattery.right, { level: 80, state: "inactive" });
  assert.equal(device.controllerBattery.observedAt, good?.observedAt);
});

test("disabling clears readings and disconnects only endpoints CafeQuest connected", async () => {
  const disabled = await putSetting({ enabled: false });
  assert.equal(disabled.status, 200);
  assert.deepEqual(((await disabled.json()) as any).controllerBatteryMonitoring, {
    enabled: false,
    availability: "disabled",
  });
  assert.equal(getControllerBatteryMonitoringEnabled(db), false);
  const snap = await snapshot();
  for (const device of snap.devices) assert.equal(device.controllerBattery, null);
  assert.ok(adb.count("connect") >= 3, "reachable headsets were connected at least once");
  assert.equal(adb.count("disconnect"), 3, "each endpoint CafeQuest newly connected is released exactly once");
});

test("an already-connected endpoint is never disconnected by CafeQuest", async () => {
  const already = new FakeAdb();
  already.connectText = (endpoint) => `already connected to ${endpoint}`;
  const second = await buildApp({
    dbPath: ":memory:",
    port: 0,
    host: "127.0.0.1",
    adminApiKey: ADMIN,
    controllerBattery: { runner: already.runner, pollIntervalMs: 60_000 },
  });
  await second.app.listen({ port: 0, host: "127.0.0.1" });
  const deviceId = randomUUID();
  upsertDevice(second.db, { id: deviceId, name: "Quest Already" });
  second.hub.addAgentSocket(deviceId, fakeSocket() as never, [], "192.168.1.58");

  await second.controllerBatteryCollector.setEnabled(true);
  await second.controllerBatteryCollector.pollNow();
  assert.equal(second.controllerBatteryCollector.deviceState(deviceId)?.status, "available");
  await second.controllerBatteryCollector.setEnabled(false);
  assert.equal(already.count("disconnect"), 0);
  await second.app.close();
});

test("a failed ADB cycle leaves sessions, online state, and launches untouched", async () => {
  const broken = new FakeAdb();
  broken.connectThrows = true;
  const third = await buildApp({
    dbPath: ":memory:",
    port: 0,
    host: "127.0.0.1",
    adminApiKey: ADMIN,
    controllerBattery: { runner: broken.runner, pollIntervalMs: 60_000 },
  });
  await third.app.listen({ port: 0, host: "127.0.0.1" });
  const address3 = third.app.server.address();
  const port3 = typeof address3 === "object" && address3 ? address3.port : 0;
  const deviceId = randomUUID();
  upsertDevice(third.db, { id: deviceId, name: "Quest Broken ADB" });
  touchDevice(third.db, deviceId, { batteryLevel: 42, charging: false });
  third.hub.addAgentSocket(deviceId, fakeSocket() as never, [], "192.168.1.59");
  const now = new Date().toISOString();
  third.db
    .prepare(
      `INSERT INTO sessions (id, device_id, started_at, ends_at, status, open_ended, created_at, updated_at)
       VALUES ('s1', ?, ?, ?, 'active', 0, ?, ?)`
    )
    .run(deviceId, now, new Date(Date.now() + 600_000).toISOString(), now, now);

  await third.controllerBatteryCollector.setEnabled(true);
  await third.controllerBatteryCollector.pollNow();
  assert.equal(third.controllerBatteryCollector.deviceState(deviceId)?.reason, "adb_connect_failed");

  const res = await fetch(`http://127.0.0.1:${port3}/api/devices`, { headers: auth });
  const snap = (await res.json()) as any;
  const device = snap.devices.find((d: any) => d.id === deviceId);
  assert.equal(device.controllerBattery.reason, "adb_connect_failed");
  assert.equal(device.session?.id, "s1", "sessions are untouched by ADB failures");
  assert.equal(device.online, true, "a failed ADB cycle never marks the headset offline");
  assert.equal(device.batteryLevel, 42, "headset battery telemetry is untouched");
  assert.equal(third.hub.isDeviceConnected(deviceId), true, "the launch path still sees the headset");
  assert.equal(broken.count("-s"), 0, "a failed connect never proceeds to a dump");
  await third.app.close();
});

test("the enabled intent survives a restart while readings do not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cafequest-setting-"));
  const dbPath = join(dir, "settings.db");
  const first = new FakeAdb();
  const firstApp = await buildApp({
    dbPath,
    port: 0,
    host: "127.0.0.1",
    adminApiKey: ADMIN,
    controllerBattery: { runner: first.runner, pollIntervalMs: 60_000 },
  });
  setControllerBatteryMonitoringEnabled(firstApp.db, true);
  await firstApp.app.close();

  const restarted = new FakeAdb();
  const secondApp = await buildApp({
    dbPath,
    port: 0,
    host: "127.0.0.1",
    adminApiKey: ADMIN,
    controllerBattery: { runner: restarted.runner, pollIntervalMs: 60_000 },
  });
  await secondApp.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = secondApp.app.server.address();
  const port2 = typeof addr === "object" && addr ? addr.port : 0;

  const deviceId = randomUUID();
  upsertDevice(secondApp.db, { id: deviceId, name: "Quest Restarted" });
  const res = await fetch(`http://127.0.0.1:${port2}/api/devices`, { headers: auth });
  const snap = (await res.json()) as any;
  assert.equal(snap.controllerBatteryMonitoring.enabled, true, "the flag is restored at boot");
  assert.equal(
    snap.devices.find((d: any) => d.id === deviceId)?.controllerBattery?.observedAt ?? null,
    null,
    "a restart presents no stale reading as fresh"
  );
  await secondApp.app.close();
});

test("closing the app stops the timer and releases owned endpoints", async () => {
  const owned = new FakeAdb();
  const scoped = await buildApp({
    dbPath: ":memory:",
    port: 0,
    host: "127.0.0.1",
    adminApiKey: ADMIN,
    controllerBattery: { runner: owned.runner, pollIntervalMs: 20 },
  });
  await scoped.app.listen({ port: 0, host: "127.0.0.1" });
  const deviceId = randomUUID();
  upsertDevice(scoped.db, { id: deviceId, name: "Quest Closing" });
  scoped.hub.addAgentSocket(deviceId, fakeSocket() as never, [], "192.168.1.60");
  await scoped.controllerBatteryCollector.setEnabled(true);
  await scoped.controllerBatteryCollector.pollNow();
  assert.ok(owned.count("-s") >= 1);

  await scoped.app.close();
  assert.ok(owned.count("disconnect") >= 1, "owned endpoints are disconnected on close");
  const afterClose = owned.calls.length;
  await wait(60);
  assert.equal(owned.calls.length, afterClose, "no polling continues after close");
});
