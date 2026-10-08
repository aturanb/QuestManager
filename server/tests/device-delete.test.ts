// Removing stale headsets from the board: DELETE /api/devices/:id takes the
// device and its history, refuses while the headset is connected, and a removed
// headset that later reconnects simply enrolls again.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice, createSession, createCommand, replaceDeviceApps, getDevice } from "../src/store.js";

const { app, db } = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1", logger: { level: "silent" } });
await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const base = `http://127.0.0.1:${port}`;
after(() => app.close());

function count(table: string, deviceId: string): number {
  return db.prepare(`SELECT COUNT(*) FROM ${table} WHERE device_id = ?`).pluck().get(deviceId) as number;
}

async function connect(id: string, name: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/agent-ws`);
  await new Promise<void>((resolve, reject) => { ws.on("open", () => resolve()); ws.on("error", reject); });
  ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, deviceId: id, deviceName: name, deviceModel: "Quest 3", agentVersion: "0.2.0" }));
  await new Promise((r) => setTimeout(r, 150));
  return ws;
}

test("deleting an offline headset removes it with its sessions, commands and app inventory", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Stale Quest" });
  createSession(db, id, 30);
  createCommand(db, id, "launch_app");
  replaceDeviceApps(db, id, [{ packageName: "com.example.game", label: "Example", versionName: "1", versionCode: 1 }]);

  const res = await fetch(`${base}/api/devices/${id}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: id });

  assert.equal(getDevice(db, id), null);
  assert.equal(count("sessions", id), 0);
  assert.equal(count("commands", id), 0);
  assert.equal(count("device_apps", id), 0);
  const snap = await (await fetch(`${base}/api/devices`)).json() as { devices: Array<{ id: string }> };
  assert.ok(!snap.devices.some((d) => d.id === id));
});

test("deleting an unknown headset is 404", async () => {
  const res = await fetch(`${base}/api/devices/${randomUUID()}`, { method: "DELETE" });
  assert.equal(res.status, 404);
  assert.equal((await res.json() as { error: string }).error, "device_not_found");
});

test("a connected headset cannot be deleted; once it disconnects it can", async () => {
  const id = randomUUID();
  const ws = await connect(id, "Live Quest");

  const refused = await fetch(`${base}/api/devices/${id}`, { method: "DELETE" });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json() as { error: string }).error, "headset_online");
  assert.ok(getDevice(db, id));

  ws.close();
  await new Promise((r) => setTimeout(r, 150));
  const res = await fetch(`${base}/api/devices/${id}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(getDevice(db, id), null);
});

test("a deleted headset that reconnects enrolls again", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Returning Quest" });
  assert.equal((await fetch(`${base}/api/devices/${id}`, { method: "DELETE" })).status, 200);

  const ws = await connect(id, "Returning Quest");
  assert.equal(getDevice(db, id)?.name, "Returning Quest");
  ws.close();
});

test("deleting a headset needs the admin key when one is configured", async () => {
  const locked = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1", adminApiKey: "k-123", logger: { level: "silent" } });
  await locked.app.listen({ port: 0, host: "127.0.0.1" });
  const laddr = locked.app.server.address();
  const lport = typeof laddr === "object" && laddr ? laddr.port : 0;
  const id = randomUUID();
  upsertDevice(locked.db, { id, name: "Locked Quest" });
  try {
    const denied = await fetch(`http://127.0.0.1:${lport}/api/devices/${id}`, { method: "DELETE" });
    assert.equal(denied.status, 401);
    assert.ok(getDevice(locked.db, id));
    const ok = await fetch(`http://127.0.0.1:${lport}/api/devices/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer k-123" },
    });
    assert.equal(ok.status, 200);
  } finally {
    await locked.app.close();
  }
});
