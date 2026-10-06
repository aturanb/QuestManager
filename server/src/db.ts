import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type Db = Database.Database;

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return randomUUID();
}

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT,
      agent_version TEXT,
      last_seen_at TEXT,
      first_seen_at TEXT,
      battery_level INTEGER,
      charging INTEGER,
      expected_game_id TEXT,
      expected_game_name TEXT,
      expected_game_started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      meta_app_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      started_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      received_at TEXT,
      completed_at TEXT,
      error TEXT
    );
  `);
  return db;
}

const SEED_GAMES: Array<[string, string, string]> = [
  ["beat-saber", "Beat Saber", "FILL_BEAT_SABER_APP_ID"],
  ["walkabout-mini-golf", "Walkabout Mini Golf", "FILL_WALKABOUT_APP_ID"],
  ["eleven-table-tennis", "Eleven Table Tennis", "FILL_ELEVEN_APP_ID"],
];

export function seedGames(db: Db): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO games (id, name, meta_app_id, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
  );
  for (const [id, name, metaAppId] of SEED_GAMES) {
    stmt.run(id, name, metaAppId, nowIso(), nowIso());
  }
}
