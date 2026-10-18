import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import {
  createCommand,
  createSession,
  dashboardSessionForDevice,
  getDevice,
  getSession,
  listDeviceApps,
  renameDevice,
  replaceDeviceApps,
  upsertDevice,
} from "../src/store.js";

const { app, db } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  logger: { level: "silent" },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const port = typeof address === "object" && address ? address.port : 0;
after(() => app.close());

async function connect(deviceId: string, deviceName: string, previousDeviceId?: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/agent-ws`);
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  socket.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    deviceId,
    deviceName,
    deviceModel: "Quest 3",
    agentVersion: "0.6.0",
    ...(previousDeviceId ? { previousDeviceId } : {}),
  }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  return socket;
}

test("a stable reinstall id replaces the legacy id while preserving the headset record", async () => {
  const previousDeviceId = randomUUID();
  const stableDeviceId = randomUUID();
  upsertDevice(db, { id: previousDeviceId, name: "Quest ABCD" });
  renameDevice(db, previousDeviceId, "Headset 01");
  const session = createSession(db, previousDeviceId, 30);
  const command = createCommand(db, previousDeviceId, "launch_app");
  replaceDeviceApps(db, previousDeviceId, [
    { packageName: "com.example.game", label: "Example", versionName: "1", versionCode: 1 },
  ]);

  const upgraded = await connect(stableDeviceId, "Quest EFGH", previousDeviceId);

  assert.equal(getDevice(db, previousDeviceId), null);
  assert.equal(getDevice(db, stableDeviceId)?.name, "Headset 01");
  assert.equal(
    db.prepare("SELECT device_id FROM sessions WHERE id = ?").pluck().get(session.id),
    stableDeviceId,
  );
  assert.equal(
    db.prepare("SELECT device_id FROM commands WHERE id = ?").pluck().get(command.id),
    stableDeviceId,
  );
  assert.deepEqual(listDeviceApps(db, stableDeviceId).map((app) => app.packageName), ["com.example.game"]);
  upgraded.close();
  await new Promise((resolve) => upgraded.once("close", resolve));

  const reinstalled = await connect(stableDeviceId, "Quest EFGH");
  assert.equal(getDevice(db, stableDeviceId)?.name, "Headset 01");
  assert.equal((db.prepare("SELECT COUNT(*) FROM devices").pluck().get() as number), 1);
  reinstalled.close();
});

test("migration also absorbs a stable row created when the agent was updated before the server", async () => {
  const previousDeviceId = randomUUID();
  const stableDeviceId = randomUUID();
  upsertDevice(db, { id: previousDeviceId, name: "Quest IJKL" });
  renameDevice(db, previousDeviceId, "Headset 02");
  const legacySession = createSession(db, previousDeviceId, 45);
  upsertDevice(db, { id: stableDeviceId, name: "Quest MNOP" });
  const stableSession = createSession(db, stableDeviceId, 60);
  db.prepare("UPDATE sessions SET started_at = ? WHERE id = ?").run("2026-10-10T10:00:00.000Z", stableSession.id);
  db.prepare("UPDATE sessions SET started_at = ? WHERE id = ?").run("2026-10-10T10:01:00.000Z", legacySession.id);
  const stableCommand = createCommand(db, stableDeviceId, "launch_app");

  const connected = await connect(stableDeviceId, "Quest MNOP", previousDeviceId);

  assert.equal(getDevice(db, previousDeviceId), null);
  assert.equal(getDevice(db, stableDeviceId)?.name, "Headset 02");
  assert.equal(
    db.prepare("SELECT device_id FROM sessions WHERE id = ?").pluck().get(legacySession.id),
    stableDeviceId,
  );
  assert.equal(getSession(db, legacySession.id)?.status, "stopped");
  assert.equal(getSession(db, stableSession.id)?.status, "active");
  assert.equal(dashboardSessionForDevice(db, stableDeviceId)?.id, stableSession.id);
  assert.equal(
    db.prepare("SELECT COUNT(*) FROM sessions WHERE device_id = ? AND status = 'active'").pluck().get(stableDeviceId),
    1,
  );
  assert.equal(
    db.prepare("SELECT device_id FROM commands WHERE id = ?").pluck().get(stableCommand.id),
    stableDeviceId,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) FROM devices WHERE id IN (?, ?)").pluck().get(previousDeviceId, stableDeviceId),
    1,
  );
  connected.close();
});
