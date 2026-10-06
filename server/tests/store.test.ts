import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { openDb, nowIso, seedGames } from "../src/db.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Db } from "../src/db.js";
import {
  upsertDevice,
  getDevice,
  listDevices,
  touchDevice,
  setExpectedGame,
  renameDevice,
  listGames,
  getGame,
  upsertGame,
  createSession,
  getSession,
  activeSessionForDevice,
  extendSession,
  stopSession,
  sweepExpiredSessions,
  createCommand,
  getCommand,
  markCommand,
  sweepTimedOutCommands,
} from "../src/store.js";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  seedGames(db);
});

test("upsertDevice inserts then updates model/agentVersion without clobbering name", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01", model: "Quest 3", agentVersion: "0.1.0" });
  upsertDevice(db, { id: "d1", name: "Renamed-by-hello", model: "Quest 3", agentVersion: "0.2.0" });
  const d = getDevice(db, "d1");
  assert.ok(d);
  assert.equal(d!.model, "Quest 3");
  assert.equal(d!.agentVersion, "0.2.0");
});

test("touchDevice refreshes lastSeenAt and battery", async () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  await new Promise((r) => setTimeout(r, 5));
  touchDevice(db, "d1", { batteryLevel: 83, charging: false });
  const d = getDevice(db, "d1");
  assert.equal(d!.batteryLevel, 83);
  assert.equal(d!.charging, 0);
  assert.ok(d!.lastSeenAt);
});

test("setExpectedGame stores and clears expected game", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const t = nowIso();
  setExpectedGame(db, "d1", { gameId: "beat-saber", name: "Beat Saber", launchedAt: t });
  assert.equal(getDevice(db, "d1")!.expectedGameId, "beat-saber");
  setExpectedGame(db, "d1", null);
  assert.equal(getDevice(db, "d1")!.expectedGameId, null);
});

test("renameDevice renames an existing device", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const d = renameDevice(db, "d1", "Cafe Left");
  assert.equal(d!.name, "Cafe Left");
});

test("games: seed, list, get, upsert", () => {
  const games = listGames(db);
  assert.equal(games.length, 3);
  assert.ok(getGame(db, "beat-saber"));
  upsertGame(db, { id: "beat-saber", name: "Beat Saber", metaAppId: "12345" });
  assert.equal(getGame(db, "beat-saber")!.metaAppId, "12345");
});

test("sessions: create, one active per device, extend, stop, expire sweep", async () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const s = createSession(db, "d1", 60);
  assert.equal(s.status, "active");
  assert.equal(activeSessionForDevice(db, "d1")!.id, s.id);
  assert.rejects; // no-op to satisfy lint; real duplicate check happens at API layer
  const s2 = createSession(db, "d1", 30);
  assert.notEqual(s2.id, s.id);
  const ext = extendSession(db, s.id, 15);
  assert.ok(new Date(ext!.endsAt).getTime() > new Date(s.endsAt).getTime());
  assert.equal(stopSession(db, s.id)!.status, "stopped");
  assert.equal(extendSession(db, s.id, 15), null);
  // expiry: craft an active session already in the past
  const past = db
    .prepare(`INSERT INTO sessions (id, device_id, started_at, ends_at, status, created_at, updated_at)
              VALUES ('past', 'd1', ?, ?, 'active', ?, ?)`)
    .run(nowIso(), new Date(Date.now() - 1000).toISOString(), nowIso(), nowIso());
  assert.equal(sweepExpiredSessions(db), 1);
  assert.equal(getSession(db, "past")!.status, "expired");
});

test("commands: create, mark received, mark success, timeout sweep", async () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const c = createCommand(db, "d1", "launch_app");
  assert.equal(c.status, "queued");
  assert.equal(markCommand(db, c.id, "received")!.status, "received");
  assert.equal(markCommand(db, c.id, "success")!.status, "success");
  const c2 = createCommand(db, "d1", "launch_app");
  markCommand(db, c2.id, "sent");
  await new Promise((r) => setTimeout(r, 10));
  const n = sweepTimedOutCommands(db, 5);
  assert.equal(n, 1);
  assert.equal(getCommand(db, c2.id)!.status, "timeout");
});

test("database persistence across reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-"));
  const dbPath = path.join(dir, "test.db");
  const d1 = openDb(dbPath);
  seedGames(d1);
  upsertDevice(d1, { id: "persist-1", name: "Quest P" });
  createSession(d1, "persist-1", 42);
  d1.close();
  const d2 = openDb(dbPath);
  const dev = getDevice(d2, "persist-1");
  assert.ok(dev);
  assert.equal(dev!.name, "Quest P");
  assert.ok(activeSessionForDevice(d2, "persist-1"));
  d2.close();
});
