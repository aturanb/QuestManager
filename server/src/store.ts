import type { Db } from "./db.js";
import { nowIso, uuid } from "./db.js";
import type { DeviceRow, GameRow, SessionRow, CommandRow } from "./types.js";

export type NewDeviceInput = {
  id: string;
  name: string;
  model?: string | null;
  agentVersion?: string | null;
  firstSeenAt?: string | null;
};

// --- devices ---------------------------------------------------------------

export function upsertDevice(db: Db, input: NewDeviceInput): DeviceRow {
  const now = nowIso();
  db.prepare(
    `INSERT INTO devices (id, name, model, agent_version, first_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       model = excluded.model,
       agent_version = excluded.agent_version,
       updated_at = excluded.updated_at`
  ).run(
    input.id,
    input.name,
    input.model ?? null,
    input.agentVersion ?? null,
    input.firstSeenAt ?? now,
    now,
    now
  );
  return getDevice(db, input.id) as DeviceRow;
}

function mapDevice(r: any): DeviceRow {
  return {
    id: r.id,
    name: r.name,
    model: r.model,
    agentVersion: r.agent_version,
    lastSeenAt: r.last_seen_at,
    firstSeenAt: r.first_seen_at,
    batteryLevel: r.battery_level,
    charging: r.charging === null ? null : r.charging ? 1 : 0,
    expectedGameId: r.expected_game_id,
    expectedGameName: r.expected_game_name,
    expectedGameStartedAt: r.expected_game_started_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getDevice(db: Db, id: string): DeviceRow | null {
  const r = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as any;
  return r ? mapDevice(r) : null;
}

export function listDevices(db: Db): DeviceRow[] {
  return (db.prepare("SELECT * FROM devices ORDER BY created_at ASC").all() as any[]).map(mapDevice);
}

export function touchDevice(
  db: Db,
  id: string,
  fields: { batteryLevel?: number; charging?: boolean }
): void {
  const sets: string[] = ["last_seen_at = ?", "updated_at = ?"];
  const args: unknown[] = [nowIso(), nowIso()];
  if (fields.batteryLevel !== undefined) {
    sets.push("battery_level = ?");
    args.push(fields.batteryLevel);
  }
  if (fields.charging !== undefined) {
    sets.push("charging = ?");
    args.push(fields.charging ? 1 : 0);
  }
  args.push(id);
  db.prepare(`UPDATE devices SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}

export function setExpectedGame(
  db: Db,
  id: string,
  game: { gameId: string; name: string; launchedAt: string } | null
): void {
  db.prepare(
    `UPDATE devices SET expected_game_id = ?, expected_game_name = ?, expected_game_started_at = ?, updated_at = ? WHERE id = ?`
  ).run(game?.gameId ?? null, game?.name ?? null, game?.launchedAt ?? null, nowIso(), id);
}

export function renameDevice(db: Db, id: string, name: string): DeviceRow | null {
  db.prepare("UPDATE devices SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), id);
  return getDevice(db, id);
}

// --- games -----------------------------------------------------------------

function mapGame(r: any): GameRow {
  return {
    id: r.id,
    name: r.name,
    metaAppId: r.meta_app_id,
    enabled: r.enabled ? 1 : 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listGames(db: Db): GameRow[] {
  return (db.prepare("SELECT * FROM games ORDER BY name ASC").all() as any[]).map(mapGame);
}

export function getGame(db: Db, id: string): GameRow | null {
  const r = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as any;
  return r ? mapGame(r) : null;
}

export function upsertGame(db: Db, g: { id: string; name: string; metaAppId: string; enabled?: boolean }): GameRow {
  const now = nowIso();
  db.prepare(
    `INSERT INTO games (id, name, meta_app_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, meta_app_id = excluded.meta_app_id, enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).run(g.id, g.name, g.metaAppId, g.enabled === false ? 0 : 1, now, now);
  return getGame(db, g.id) as GameRow;
}

// --- sessions ----------------------------------------------------------------

function mapSession(r: any): SessionRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    startedAt: r.started_at,
    endsAt: r.ends_at,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createSession(db: Db, deviceId: string, minutes: number): SessionRow {
  const now = new Date();
  const ends = new Date(now.getTime() + minutes * 60_000);
  const row = {
    id: uuid(),
    device_id: deviceId,
    started_at: now.toISOString(),
    ends_at: ends.toISOString(),
    status: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  db.prepare(
    `INSERT INTO sessions (id, device_id, started_at, ends_at, status, created_at, updated_at)
     VALUES (@id, @device_id, @started_at, @ends_at, @status, @created_at, @updated_at)`
  ).run(row);
  return mapSession(row);
}

export function getSession(db: Db, id: string): SessionRow | null {
  const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  return r ? mapSession(r) : null;
}

export function activeSessionForDevice(db: Db, deviceId: string): SessionRow | null {
  const r = db
    .prepare(
      `SELECT * FROM sessions WHERE device_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`
    )
    .get(deviceId) as any;
  return r ? mapSession(r) : null;
}

export function extendSession(db: Db, id: string, minutes: number): SessionRow | null {
  const s = getSession(db, id);
  if (!s || s.status !== "active") return null;
  const newEnds = new Date(new Date(s.endsAt).getTime() + minutes * 60_000).toISOString();
  db.prepare("UPDATE sessions SET ends_at = ?, updated_at = ? WHERE id = ?").run(newEnds, nowIso(), id);
  return getSession(db, id);
}

export function stopSession(db: Db, id: string): SessionRow | null {
  const s = getSession(db, id);
  if (!s || s.status !== "active") return null;
  db.prepare("UPDATE sessions SET status = 'stopped', updated_at = ? WHERE id = ?").run(nowIso(), id);
  return getSession(db, id);
}

/** Mark active sessions whose time is up as expired; server clock authoritative (§26). */
export function sweepExpiredSessions(db: Db): number {
  const r = db
    .prepare(
      `UPDATE sessions SET status = 'expired', updated_at = ? WHERE status = 'active' AND ends_at <= ?`
    )
    .run(nowIso(), nowIso());
  return r.changes;
}

// --- commands -----------------------------------------------------------------

function mapCommand(r: any): CommandRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    receivedAt: r.received_at,
    completedAt: r.completed_at,
    error: r.error,
  };
}

export function createCommand(db: Db, deviceId: string, type: string): CommandRow {
  const row = {
    id: uuid(),
    device_id: deviceId,
    type,
    status: "queued",
    created_at: nowIso(),
    received_at: null,
    completed_at: null,
    error: null,
  };
  db.prepare(
    `INSERT INTO commands (id, device_id, type, status, created_at, received_at, completed_at, error)
     VALUES (@id, @device_id, @type, @status, @created_at, @received_at, @completed_at, @error)`
  ).run(row);
  return mapCommand(row);
}

export function getCommand(db: Db, id: string): CommandRow | null {
  const r = db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as any;
  return r ? mapCommand(r) : null;
}

export function markCommand(db: Db, id: string, status: CommandRow["status"], error?: string): CommandRow | null {
  const now = nowIso();
  const c = getCommand(db, id);
  if (!c) return null;
  if (status === "received") {
    db.prepare("UPDATE commands SET status = ?, received_at = ? WHERE id = ?").run(status, now, id);
  } else if (status === "success" || status === "failed" || status === "timeout") {
    db.prepare("UPDATE commands SET status = ?, completed_at = ?, error = ? WHERE id = ?").run(
      status,
      now,
      error ?? null,
      id
    );
  } else {
    db.prepare("UPDATE commands SET status = ? WHERE id = ?").run(status, id);
  }
  return getCommand(db, id);
}

/** Timed-out sweep: sent/received commands older than 10s become timeout (§21). */
export function sweepTimedOutCommands(db: Db, timeoutMs = 10_000): number {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const r = db
    .prepare(
      `UPDATE commands SET status = 'timeout', completed_at = ? WHERE status IN ('sent', 'received') AND created_at <= ?`
    )
    .run(nowIso(), cutoff);
  return r.changes;
}
