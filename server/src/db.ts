import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return randomUUID();
}

export function openDb(path: string): Db {
  // Fresh checkouts have no data dir (it is gitignored); create it so the
  // server boots out of the box, including for custom DB_PATH values.
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
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
      usage_access_granted INTEGER,
      foreground_package_name TEXT,
      foreground_started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      meta_app_id TEXT NOT NULL,
      package_name TEXT,
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
      open_ended INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS device_apps (
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      package_name TEXT NOT NULL,
      label TEXT NOT NULL,
      version_name TEXT,
      version_code INTEGER,
      scanned_at TEXT NOT NULL,
      PRIMARY KEY (device_id, package_name)
    );
  `);
  // Existing POC databases predate Android package mappings.
  const gameColumns = db.prepare("PRAGMA table_info(games)").all() as Array<{ name: string }>;
  if (!gameColumns.some((column) => column.name === "package_name")) {
    db.exec("ALTER TABLE games ADD COLUMN package_name TEXT");
  }
  const deviceColumns = db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>;
  if (!deviceColumns.some((column) => column.name === "usage_access_granted")) {
    db.exec("ALTER TABLE devices ADD COLUMN usage_access_granted INTEGER");
  }
  if (!deviceColumns.some((column) => column.name === "foreground_package_name")) {
    db.exec("ALTER TABLE devices ADD COLUMN foreground_package_name TEXT");
  }
  if (!deviceColumns.some((column) => column.name === "foreground_started_at")) {
    db.exec("ALTER TABLE devices ADD COLUMN foreground_started_at TEXT");
  }
  // Sessions recorded before unlimited ones existed stay timed.
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === "open_ended")) {
    db.exec("ALTER TABLE sessions ADD COLUMN open_ended INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_games_package_name ON games(package_name) WHERE package_name IS NOT NULL");
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
