// Config contract (P0-C): cafequest.config.json loads, validates, seeds games
// without clobbering DB edits, and placeholder App IDs block real launches.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildApp } from "../src/app.js";
import { openDb, seedGames } from "../src/db.js";
import {
  loadCafeQuestConfig, isPlaceholderAppId, seedConfiguredGames, DEFAULT_GAMES,
} from "../src/config.js";

test("missing config file falls back to built-in defaults", () => {
  const { config, found } = loadCafeQuestConfig(path.join(os.tmpdir(), "cq-nope", "missing.json"));
  assert.equal(found, false);
  assert.equal(config.games.length, 3);
  assert.ok(config.games.every((g) => isPlaceholderAppId(g.metaAppId)));
});

test("invalid JSON and schema violations throw with a clear message", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-cfg-"));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.throws(() => loadCafeQuestConfig(bad), /not valid JSON/);
  const wrong = path.join(dir, "wrong.json");
  fs.writeFileSync(wrong, JSON.stringify({ metaAppId: 42 }));
  assert.throws(() => loadCafeQuestConfig(wrong), /invalid/i);
});

test("valid config file parses; placeholder detector table", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-cfg-"));
  const p = path.join(dir, "cafequest.config.json");
  fs.writeFileSync(p, JSON.stringify({ metaAppId: "123456", questServerUrl: "http://192.168.1.50:3000", games: DEFAULT_GAMES }));
  const { config, found } = loadCafeQuestConfig(p);
  assert.equal(found, true);
  assert.equal(config.metaAppId, "123456");
  assert.equal(isPlaceholderAppId("FILL_BEAT_SABER_APP_ID"), true);
  assert.equal(isPlaceholderAppId("FILL_IN_YOUR_META_DASHBOARD_APP_ID"), true);
  assert.equal(isPlaceholderAppId("UNCONFIGURED"), true);
  assert.equal(isPlaceholderAppId(""), true);
  assert.equal(isPlaceholderAppId("987654321"), false);
});

test("seedConfiguredGames inserts missing, upgrades placeholders, never clobbers real IDs", () => {
  const db = openDb(":memory:");
  seedGames(db);
  // staff edits a real App ID via dashboard PUT; a later boot must not clobber it
  db.prepare("UPDATE games SET meta_app_id = ? WHERE id = ?").run("real-111", "beat-saber");
  const n = seedConfiguredGames(db, [
    { id: "beat-saber", name: "Beat Saber", metaAppId: "FILL_BEAT_SABER_APP_ID", enabled: true },
    { id: "new-game", name: "New Game", metaAppId: "real-222", enabled: true },
  ]);
  assert.equal(n.inserted, 1);
  const meta = (id: string) => (db.prepare("SELECT meta_app_id AS m FROM games WHERE id = ?").get(id) as any).m;
  assert.equal(meta("beat-saber"), "real-111");
  assert.equal(meta("new-game"), "real-222");
  db.close();
});

test("launch refuses placeholder metaAppId instead of sending a doomed command", async () => {
  const { app } = await buildApp({
    dbPath: ":memory:", port: 0, host: "127.0.0.1",
    games: [{ id: "ghost-game", name: "Ghost", metaAppId: "FILL_GHOST_APP_ID", enabled: true }],
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  const port = typeof a === "object" && a ? a.port : 0;
  after(() => app.close());
  // connect a real device so the launch reaches the placeholder guard
  const { default: WebSocket } = await import("ws");
  const id = "11111111-2222-4333-8444-555555555555";
  const ws = new WebSocket(`ws://127.0.0.1:${port}/agent-ws`);
  await new Promise<void>((r) => ws.on("open", () => r()));
  ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, deviceId: id, deviceName: "Q", deviceModel: "M", agentVersion: "1" }));
  await new Promise((r) => setTimeout(r, 200));
  const r = await fetch(`http://127.0.0.1:${port}/api/devices/${id}/launch`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId: "ghost-game" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json() as any).error, "game_meta_app_id_not_configured");
  ws.close();
});
