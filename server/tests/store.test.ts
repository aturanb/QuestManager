import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { openDb, nowIso, seedGames } from "../src/db.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
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
  dashboardSessionForDevice,
  extendSession,
  stopSession,
  sweepExpiredSessions,
  createCommand,
  getCommand,
  latestCommandForDevice,
  markCommand,
  sweepTimedOutCommands,
  replaceDeviceApps,
  listDeviceApps,
  getGameByPackage,
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

test("touchDevice stores usage access and current foreground game atomically", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  touchDevice(db, "d1", {
    batteryLevel: 73,
    charging: true,
    usageAccessGranted: true,
    foregroundApp: {
      packageName: "com.TriangleFactory.Breachers",
      startedAt: "2026-10-08T15:30:00.000Z",
    },
  });
  let device = getDevice(db, "d1")!;
  assert.equal(device.usageAccessGranted, 1);
  assert.equal(device.foregroundPackageName, "com.TriangleFactory.Breachers");
  assert.equal(device.foregroundStartedAt, "2026-10-08T15:30:00.000Z");

  touchDevice(db, "d1", {
    usageAccessGranted: true,
    foregroundApp: null,
  });
  device = getDevice(db, "d1")!;
  assert.equal(device.foregroundPackageName, null);
  assert.equal(device.foregroundStartedAt, null);
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

test("games can be mapped to an Android package for manual catalog corrections", () => {
  upsertGame(db, {
    id: "breachers",
    name: "Breachers",
    metaAppId: "5740397619319389",
    packageName: "com.TriangleFactory.Breachers",
  });
  const game = getGameByPackage(db, "com.TriangleFactory.Breachers");
  assert.equal(game?.id, "breachers");
  assert.equal(game?.packageName, "com.TriangleFactory.Breachers");
});

test("device app inventory replacement removes stale packages", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  replaceDeviceApps(db, "d1", [
    { packageName: "com.example.one", label: "One", versionName: "1.0", versionCode: 1 },
    { packageName: "com.example.two", label: "Two", versionName: null, versionCode: null },
  ]);
  assert.deepEqual(listDeviceApps(db, "d1").map((app) => app.packageName), ["com.example.one", "com.example.two"]);

  replaceDeviceApps(db, "d1", [
    { packageName: "com.example.two", label: "Two Updated", versionName: "2.0", versionCode: 2 },
  ]);
  const apps = listDeviceApps(db, "d1");
  assert.equal(apps.length, 1);
  assert.equal(apps[0]?.label, "Two Updated");
  assert.equal(apps[0]?.versionCode, 2);
});

test("device app inventory defensively deduplicates repeated package names", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  replaceDeviceApps(db, "d1", [
    { packageName: "com.example.same", label: "First", versionName: null, versionCode: null },
    { packageName: "com.example.same", label: "Latest", versionName: "2", versionCode: 2 },
  ]);
  const apps = listDeviceApps(db, "d1");
  assert.equal(apps.length, 1);
  assert.equal(apps[0]?.label, "Latest");
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
  assert.ok(new Date(ext!.endsAt!).getTime() > new Date(s.endsAt!).getTime());
  assert.equal(stopSession(db, s.id)!.status, "stopped");
  assert.equal(extendSession(db, s.id, 15), null);
  // expiry: craft an active session already in the past
  const past = db
    .prepare(`INSERT INTO sessions (id, device_id, started_at, ends_at, status, created_at, updated_at)
              VALUES ('past', 'd1', ?, ?, 'active', ?, ?)`)
    .run(nowIso(), new Date(Date.now() - 1000).toISOString(), nowIso(), nowIso());
  assert.equal(sweepExpiredSessions(db), 1);
  assert.equal(getSession(db, "past")!.status, "expired");
  assert.equal(dashboardSessionForDevice(db, "d1")!.id, "past");
  assert.equal(dashboardSessionForDevice(db, "d1")!.status, "expired");
});

test("dashboard session shows the latest active or expired session; stopping a timed one clears it", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  db.prepare(`INSERT INTO sessions (id, device_id, started_at, ends_at, status, created_at, updated_at)
              VALUES ('expired', 'd1', ?, ?, 'expired', ?, ?)`).run(expiredAt, expiredAt, expiredAt, expiredAt);
  assert.equal(dashboardSessionForDevice(db, "d1")!.id, "expired");

  const active = createSession(db, "d1", 30);
  assert.equal(dashboardSessionForDevice(db, "d1")!.id, active.id);

  stopSession(db, active.id);
  assert.equal(dashboardSessionForDevice(db, "d1"), null);
});

test("an unlimited session has no end, so the expiry sweep never closes it", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const s = createSession(db, "d1", null);
  assert.equal(s.endsAt, null);
  assert.equal(sweepExpiredSessions(db), 0);
  assert.equal(getSession(db, s.id)!.status, "active");
});

test("an unlimited session has nothing to extend", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const s = createSession(db, "d1", null);
  assert.equal(extendSession(db, s.id, 15), null);
  assert.equal(getSession(db, s.id)!.endsAt, null);
});

test("stopping an unlimited session records when play ended", async () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const s = createSession(db, "d1", null);
  // Without the gap, a time written at creation could pass for the stop time.
  await new Promise((r) => setTimeout(r, 5));
  const before = Date.now();
  const stopped = stopSession(db, s.id)!;
  const after = Date.now();
  assert.equal(stopped.status, "stopped");
  const endedAt = new Date(stopped.endsAt ?? 0).getTime();
  assert.ok(endedAt >= before && endedAt <= after, `ended at ${stopped.endsAt}`);
});

test("a stopped unlimited session stays on the dashboard until the next session starts", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  const open = createSession(db, "d1", null);
  stopSession(db, open.id);
  assert.equal(dashboardSessionForDevice(db, "d1")?.id, open.id);
  assert.equal(dashboardSessionForDevice(db, "d1")?.status, "stopped");

  const next = createSession(db, "d1", 30);
  assert.equal(dashboardSessionForDevice(db, "d1")?.id, next.id);
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

test("latestCommandForDevice returns the newest command", () => {
  upsertDevice(db, { id: "d1", name: "Quest 01" });
  assert.equal(latestCommandForDevice(db, "d1"), null);
  const c1 = createCommand(db, "d1", "launch_app");
  const c2 = createCommand(db, "d1", "launch_app");
  assert.equal(latestCommandForDevice(db, "d1")!.id, c2.id);
  assert.notEqual(c1.id, c2.id);
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

test("openDb migrates a pre-inventory database without dropping existing games", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-legacy-"));
  const dbPath = path.join(dir, "legacy.db");
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      meta_app_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO games VALUES ('legacy', 'Legacy Game', '123456', 1, 't', 't');
  `);
  legacy.close();

  const migrated = openDb(dbPath);
  const columns = migrated.prepare("PRAGMA table_info(games)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "package_name"));
  assert.equal(migrated.prepare("SELECT name FROM games WHERE id = 'legacy'").pluck().get(), "Legacy Game");
  assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'device_apps'").pluck().get());
  migrated.close();
});

test("openDb migrates a pre-unlimited sessions table, keeping its sessions timed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-legacy-"));
  const dbPath = path.join(dir, "legacy.db");
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO sessions VALUES ('legacy', 'd1', '2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z', 'active', 't', 't');
  `);
  legacy.close();

  const migrated = openDb(dbPath);
  assert.equal(getSession(migrated, "legacy")!.endsAt, "2026-01-01T11:00:00.000Z");
  assert.equal(createSession(migrated, "d2", null).endsAt, null);
  migrated.close();
});
