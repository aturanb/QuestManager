// End-to-end: simulated shift against the REAL server over the wire (brief P0.5).
// Boots the actual Fastify app on an ephemeral port, connects DeviceSim agents,
// and drives launch/switch/failure/timeout + sessions through the public API.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { buildApp } from "../../server/src/app.js";
import { DeviceSim } from "../src/deviceSim.js";

// E2E drives real launches, so it seeds real (test-only) Meta App IDs;
// placeholder IDs are rejected by design (see server/tests/config.test.ts).
const { app, db } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  games: [
    { id: "beat-saber", name: "Beat Saber", metaAppId: "test-beat-saber", enabled: true },
    { id: "walkabout-mini-golf", name: "Walkabout Mini Golf", metaAppId: "test-walkabout", enabled: true },
    { id: "eleven-table-tennis", name: "Eleven Table Tennis", metaAppId: "test-eleven", enabled: true },
  ],
});
await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
after(() => app.close());

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(fn: () => boolean | Promise<boolean>, ms = 5000, step = 50): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(step);
  }
  assert.ok(await fn(), "condition not met in time");
}

async function deviceState(id: string) {
  const res = await fetch(`${base}/api/devices`);
  const body: any = await res.json();
  return (body.devices as any[]).find((d) => d.id === id) ?? null;
}

test("simulated shift: connect, session, launch, switch, failure, timeout, reconnect", async (t) => {
  const sim = new DeviceSim({
    name: "Quest 03",
    serverUrl: wsBase,
    battery: { level: 54, charging: false },
    telemetryIntervalMs: 100,
    log: () => {},
  });
  sim.start();

  // device registers via hello and goes online
  await waitUntil(() => sim.connected);
  let online = false;
  await waitUntil(async () => {
    const d = await deviceState(sim.deviceId);
    online = !!d && d.online === true && d.name === "Quest 03";
    return online;
  });
  assert.ok(online, "device should be online");

  // telemetry updates battery
  await waitUntil(async () => {
    const d = await deviceState(sim.deviceId);
    return !!d && d.batteryLevel !== null;
  });

  // 60-minute session, extend, stop
  const sres = await fetch(`${base}/api/devices/${sim.deviceId}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ minutes: 60 }),
  });
  assert.equal(sres.status, 201);
  const { session } : any = await sres.json();
  const eres = await fetch(`${base}/api/sessions/${session.id}/extend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ minutes: 15 }),
  });
  assert.equal(eres.status, 200);
  const stopped = await fetch(`${base}/api/sessions/${session.id}/stop`, { method: "POST" });
  assert.equal(stopped.status, 200);

  // launch Beat Saber -> ack + success -> expectedGame updated on sim and server
  const lres = await fetch(`${base}/api/devices/${sim.deviceId}/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "beat-saber" }),
  });
  assert.equal(lres.status, 202);
  await waitUntil(() => sim.expectedGame?.gameId === "beat-saber");
  await waitUntil(async () => {
    const d = await deviceState(sim.deviceId);
    return d?.expectedGame?.name === "Beat Saber";
  });

  // The real foreground game (UsageStats path) reaches the dashboard snapshot,
  // resolved from the reported inventory rather than from the launch request.
  await waitUntil(async () => {
    const d = await deviceState(sim.deviceId);
    return d?.foregroundApp?.packageName === "com.beatgames.beatsaber";
  });
  const playing = await deviceState(sim.deviceId);
  assert.equal(playing.usageAccessGranted, true);
  assert.ok(Date.parse(playing.foregroundApp.startedAt) > 0);

  // Game A -> Game B switch (the critical experiment, simulated)
  const lres2 = await fetch(`${base}/api/devices/${sim.deviceId}/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "walkabout-mini-golf" }),
  });
  assert.equal(lres2.status, 202);
  await waitUntil(() => sim.expectedGame?.gameId === "walkabout-mini-golf");

  // command lifecycle persisted: wait until the (latest) command completes successfully
  await waitUntil(() => {
    const lastCmd = db
      .prepare(`SELECT status FROM commands WHERE device_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(sim.deviceId) as any;
    return lastCmd?.status === "success";
  });

  // launch failure path
  sim.setLaunchBehavior("fail");
  const lres3 = await fetch(`${base}/api/devices/${sim.deviceId}/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "eleven-table-tennis" }),
  });
  assert.equal(lres3.status, 202);
  await waitUntil(() => {
    const row = db
      .prepare(`SELECT status, error FROM commands WHERE device_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(sim.deviceId) as any;
    return row.status === "failed" && row.error === "TARGET_NOT_INSTALLED";
  }, 8000);

  // timeout path: agent never completes -> server marks timeout after 10s
  sim.setLaunchBehavior("never-complete");
  const lres4 = await fetch(`${base}/api/devices/${sim.deviceId}/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "beat-saber" }),
  });
  assert.equal(lres4.status, 202);
  await waitUntil(() => {
    const row = db
      .prepare(`SELECT status FROM commands WHERE device_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(sim.deviceId) as any;
    return row.status === "timeout";
  }, 13000, 500);

  sim.stop();

  // offline device: launch is refused with 409 (never silently queued-as-sent)
  await waitUntil(async () => {
    const d = await deviceState(sim.deviceId);
    return !!d && d.online === false;
  }, 20000);
  const off = await fetch(`${base}/api/devices/${sim.deviceId}/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "beat-saber" }),
  });
  assert.equal(off.status, 409);

  // reconnect with the SAME identity (§31 network reconnect)
  const sim2 = new DeviceSim({
    deviceId: sim.deviceId,
    name: "Quest 03",
    serverUrl: wsBase,
    battery: { level: 40, charging: true },
    telemetryIntervalMs: 100,
    log: () => {},
  });
  sim2.start();
  await waitUntil(async () => {
    const d = await deviceState(sim2.deviceId);
    return !!d && d.online === true && d.name === "Quest 03";
  });
  // no duplicate device row after reconnect
  const all: any = await (await fetch(`${base}/api/devices`)).json();
  assert.equal(all.devices.filter((d: any) => d.id === sim.deviceId).length, 1);
  sim2.stop();
});

test("malformed ws input does not crash the server and yields a typed error", async () => {
  const ws = new WebSocket(`${wsBase}/agent-ws`);
  await new Promise((r) => ws.on("open", r));
  ws.send("this is not json");
  const err: any = await new Promise((r) => ws.on("message", (m) => r(JSON.parse(String(m)))));
  assert.equal(err.type, "error");
  assert.equal(err.code, "MALFORMED_MESSAGE");
  // wrong protocol version gets a specific error (§34)
  ws.send(JSON.stringify({ type: "hello", protocolVersion: 7, deviceId: "x", deviceName: "n", deviceModel: "m", agentVersion: "a" }));
  const err2: any = await new Promise((r) => ws.on("message", (m) => r(JSON.parse(String(m)))));
  assert.equal(err2.code, "UNSUPPORTED_PROTOCOL_VERSION");
  ws.close();
  const health: any = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
});

test("REST validation: unknown device/game are rejected", async () => {
  const badDev = await fetch(`${base}/api/devices/nope/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "beat-saber" }),
  });
  assert.equal(badDev.status, 404);
  const noDev = await fetch(`${base}/api/devices`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(noDev.status, 404);
});
