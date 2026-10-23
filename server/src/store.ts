import type { Db } from "./db.js";
import { nowIso, uuid } from "./db.js";
import type { DeviceRow, GameRow, SessionRow, CommandRow, DeviceAppRow, NoteRow } from "./types.js";
import type { InstalledApp } from "@cafequest/shared";

export type NewDeviceInput = {
  id: string;
  name: string;
  model?: string | null;
  agentVersion?: string | null;
  firstSeenAt?: string | null;
};

// --- app settings ------------------------------------------------------------
// Only the enabled intent is persisted. Controller readings, remote addresses,
// and ADB connection ownership stay in memory so a restart cannot present old
// data as fresh.

const CONTROLLER_BATTERY_MONITORING_KEY = "controller_battery_monitoring";

/** Missing or unrecognized values read as false: monitoring is opt-in. */
export function getControllerBatteryMonitoringEnabled(db: Db): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(CONTROLLER_BATTERY_MONITORING_KEY) as
    | { value: string }
    | undefined;
  return row?.value === "true";
}

export function setControllerBatteryMonitoringEnabled(db: Db, enabled: boolean): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(CONTROLLER_BATTERY_MONITORING_KEY, enabled ? "true" : "false");
}

// --- shared café notes ------------------------------------------------------

const NOTE_COLUMNS = "id, content, revision, created_at AS createdAt, updated_at AS updatedAt";

export function listNotes(db: Db): NoteRow[] {
  return db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes ORDER BY updated_at DESC, rowid DESC`).all() as NoteRow[];
}

export function getNote(db: Db, id: string): NoteRow | null {
  return (db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`).get(id) as NoteRow | undefined) ?? null;
}

export function createNote(db: Db, content: string, id = uuid()): NoteRow {
  const now = nowIso();
  db.prepare("INSERT INTO notes (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, content, now, now);
  return getNote(db, id)!;
}

/** Revision predicates make stale writes fail atomically, even across DB connections. */
export function updateNote(db: Db, id: string, content: string, revision: number): NoteRow | null {
  const result = db.prepare(
    "UPDATE notes SET content = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?"
  ).run(content, nowIso(), id, revision);
  return result.changes ? getNote(db, id) : null;
}

export function deleteNote(db: Db, id: string, revision: number): boolean {
  return db.prepare("DELETE FROM notes WHERE id = ? AND revision = ?").run(id, revision).changes > 0;
}

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

/**
 * Move a legacy install-scoped device row to its stable Android-scoped id.
 * If an older server already inserted the stable row, combine the two records
 * so server-first and agent-first rollouts both converge without a stale card.
 */
export function rekeyDevice(db: Db, previousId: string, stableId: string): boolean {
  if (previousId === stableId || !getDevice(db, previousId)) return false;

  return db.transaction(() => {
    if (getDevice(db, stableId)) {
      // The new agent may have reached an older server first. Keep that row's
      // recent telemetry but restore the legacy row's staff-assigned name and
      // original enrollment dates before combining their history.
      db.prepare(
        `UPDATE devices SET
           name = (SELECT name FROM devices WHERE id = ?),
           first_seen_at = COALESCE((SELECT first_seen_at FROM devices WHERE id = ?), first_seen_at),
           created_at = (SELECT created_at FROM devices WHERE id = ?)
         WHERE id = ?`
      ).run(previousId, previousId, previousId, stableId);
      db.prepare(
        `DELETE FROM device_apps
         WHERE device_id = ? AND package_name IN (
           SELECT package_name FROM device_apps WHERE device_id = ?
         )`
      ).run(previousId, stableId);

      // Agent-first rollout can leave both rows with an active session. Prefer
      // the session already attached to the stable row and retain the legacy
      // one as stopped history so one headset never has two active sessions.
      const stableHasActiveSession = db
        .prepare("SELECT 1 FROM sessions WHERE device_id = ? AND status = 'active' LIMIT 1")
        .get(stableId);
      if (stableHasActiveSession) {
        const stoppedAt = nowIso();
        db.prepare(
          `UPDATE sessions
           SET status = 'stopped',
               ends_at = CASE WHEN open_ended = 1 THEN ? ELSE ends_at END,
               updated_at = ?
           WHERE device_id = ? AND status = 'active'`
        ).run(stoppedAt, stoppedAt, previousId);
      }
    } else {
      db.prepare(
        `INSERT INTO devices (
           id, name, model, agent_version, last_seen_at, first_seen_at,
           battery_level, charging, expected_game_id, expected_game_name,
           expected_game_started_at, usage_access_granted, foreground_package_name,
           foreground_started_at, created_at, updated_at
         )
         SELECT ?, name, model, agent_version, last_seen_at, first_seen_at,
           battery_level, charging, expected_game_id, expected_game_name,
           expected_game_started_at, usage_access_granted, foreground_package_name,
           foreground_started_at, created_at, updated_at
         FROM devices WHERE id = ?`
      ).run(stableId, previousId);
    }
    db.prepare("UPDATE sessions SET device_id = ? WHERE device_id = ?").run(stableId, previousId);
    db.prepare("UPDATE commands SET device_id = ? WHERE device_id = ?").run(stableId, previousId);
    db.prepare("UPDATE device_apps SET device_id = ? WHERE device_id = ?").run(stableId, previousId);
    db.prepare("DELETE FROM devices WHERE id = ?").run(previousId);
    return true;
  })();
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
    usageAccessGranted: r.usage_access_granted === null ? null : r.usage_access_granted ? 1 : 0,
    foregroundPackageName: r.foreground_package_name,
    foregroundStartedAt: r.foreground_started_at,
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
  fields: {
    batteryLevel?: number;
    charging?: boolean;
    usageAccessGranted?: boolean;
    foregroundApp?: { packageName: string; startedAt: string } | null;
  }
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
  if (fields.usageAccessGranted !== undefined) {
    sets.push("usage_access_granted = ?");
    args.push(fields.usageAccessGranted ? 1 : 0);
  }
  if (fields.foregroundApp !== undefined) {
    sets.push("foreground_package_name = ?", "foreground_started_at = ?");
    args.push(fields.foregroundApp?.packageName ?? null, fields.foregroundApp?.startedAt ?? null);
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

/**
 * Removes a headset and everything recorded against it. sessions/commands
 * reference devices without ON DELETE CASCADE (SQLite cannot add it to an
 * existing table), so children go first, in one transaction.
 */
export function deleteDevice(db: Db, id: string): boolean {
  const remove = db.transaction((deviceId: string) => {
    db.prepare("DELETE FROM commands WHERE device_id = ?").run(deviceId);
    db.prepare("DELETE FROM sessions WHERE device_id = ?").run(deviceId);
    db.prepare("DELETE FROM device_apps WHERE device_id = ?").run(deviceId);
    return db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId).changes > 0;
  });
  return remove(id);
}

// --- games -----------------------------------------------------------------

function mapGame(r: any): GameRow {
  return {
    id: r.id,
    name: r.name,
    metaAppId: r.meta_app_id,
    packageName: r.package_name,
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

export function getGameByPackage(db: Db, packageName: string): GameRow | null {
  const r = db.prepare("SELECT * FROM games WHERE package_name = ?").get(packageName) as any;
  return r ? mapGame(r) : null;
}

export function upsertGame(
  db: Db,
  g: { id: string; name: string; metaAppId: string; packageName?: string | null; enabled?: boolean }
): GameRow {
  const now = nowIso();
  const packageName = g.packageName === undefined ? getGame(db, g.id)?.packageName ?? null : g.packageName;
  db.prepare(
    `INSERT INTO games (id, name, meta_app_id, package_name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, meta_app_id = excluded.meta_app_id,
       package_name = excluded.package_name, enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).run(g.id, g.name, g.metaAppId, packageName, g.enabled === false ? 0 : 1, now, now);
  return getGame(db, g.id) as GameRow;
}

// --- device application inventory -----------------------------------------

function mapDeviceApp(r: any): DeviceAppRow {
  return {
    deviceId: r.device_id,
    packageName: r.package_name,
    label: r.label,
    versionName: r.version_name,
    versionCode: r.version_code,
    scannedAt: r.scanned_at,
  };
}

/** Replace one headset's inventory atomically so removed apps disappear. */
export function replaceDeviceApps(db: Db, deviceId: string, apps: InstalledApp[], scannedAt = nowIso()): void {
  const uniqueApps = new Map<string, InstalledApp>();
  for (const app of apps) uniqueApps.set(app.packageName, app);
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM device_apps WHERE device_id = ?").run(deviceId);
    const insert = db.prepare(
      `INSERT INTO device_apps (device_id, package_name, label, version_name, version_code, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const app of uniqueApps.values()) {
      insert.run(deviceId, app.packageName, app.label, app.versionName, app.versionCode, scannedAt);
    }
  });
  replace();
}

export function listDeviceApps(db: Db, deviceId: string): DeviceAppRow[] {
  return (db
    .prepare("SELECT * FROM device_apps WHERE device_id = ? ORDER BY label COLLATE NOCASE, package_name")
    .all(deviceId) as any[]).map(mapDeviceApp);
}

export function getDeviceApp(db: Db, deviceId: string, packageName: string): DeviceAppRow | null {
  const row = db
    .prepare("SELECT * FROM device_apps WHERE device_id = ? AND package_name = ?")
    .get(deviceId, packageName) as any;
  return row ? mapDeviceApp(row) : null;
}

// --- sessions ----------------------------------------------------------------

function mapSession(r: any): SessionRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    startedAt: r.started_at,
    // ends_at is NOT NULL, so a running unlimited session keeps its start there.
    endsAt: r.open_ended && r.status === "active" ? null : r.ends_at,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** `minutes: null` starts an unlimited session: it never expires and only staff stop it. */
export function createSession(db: Db, deviceId: string, minutes: number | null): SessionRow {
  const now = new Date();
  const ends = new Date(now.getTime() + (minutes ?? 0) * 60_000);
  const row = {
    id: uuid(),
    device_id: deviceId,
    started_at: now.toISOString(),
    ends_at: ends.toISOString(),
    status: "active",
    open_ended: minutes === null ? 1 : 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  db.prepare(
    `INSERT INTO sessions (id, device_id, started_at, ends_at, status, open_ended, created_at, updated_at)
     VALUES (@id, @device_id, @started_at, @ends_at, @status, @open_ended, @created_at, @updated_at)`
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

/**
 * Latest session shown on the dashboard. If migrated stopped history is newer
 * than a surviving active session, show the active one; otherwise stopped timed
 * sessions clear the card and stopped unlimited sessions keep their played time.
 */
export function dashboardSessionForDevice(db: Db, deviceId: string): SessionRow | null {
  const r = db
    .prepare(`SELECT * FROM sessions WHERE device_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
    .get(deviceId) as any;
  if (r?.status === "stopped") {
    const active = db
      .prepare(
        `SELECT * FROM sessions WHERE device_id = ? AND status = 'active' ORDER BY started_at DESC, rowid DESC LIMIT 1`
      )
      .get(deviceId) as any;
    if (active) return mapSession(active);
  }
  const shown = r && (r.status === "active" || r.status === "expired" || (r.status === "stopped" && r.open_ended));
  return shown ? mapSession(r) : null;
}

export function extendSession(db: Db, id: string, minutes: number): SessionRow | null {
  const s = getSession(db, id);
  if (!s || s.status !== "active" || s.endsAt === null) return null;
  const newEnds = new Date(new Date(s.endsAt).getTime() + minutes * 60_000).toISOString();
  db.prepare("UPDATE sessions SET ends_at = ?, updated_at = ? WHERE id = ?").run(newEnds, nowIso(), id);
  return getSession(db, id);
}

export function stopSession(db: Db, id: string): SessionRow | null {
  const s = getSession(db, id);
  if (!s || s.status !== "active") return null;
  // An unlimited session ends when staff stop it; a timed one keeps its paid end.
  db.prepare(
    `UPDATE sessions SET status = 'stopped', updated_at = @now,
       ends_at = CASE WHEN open_ended = 1 THEN @now ELSE ends_at END
     WHERE id = @id`
  ).run({ now: nowIso(), id });
  return getSession(db, id);
}

/** Mark active sessions whose time is up as expired; server clock authoritative (§26). */
export function sweepExpiredSessions(db: Db): number {
  const r = db
    .prepare(
      `UPDATE sessions SET status = 'expired', updated_at = ?
       WHERE status = 'active' AND open_ended = 0 AND ends_at <= ?`
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

/** Newest command for a device (drives the dashboard launch-state badge). */
export function latestCommandForDevice(db: Db, deviceId: string): CommandRow | null {
  const r = db
    .prepare(`SELECT * FROM commands WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(deviceId) as any;
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

/** Timed-out sweep: sent/received/queued commands older than 10s become timeout (§21). */
export function sweepTimedOutCommands(db: Db, timeoutMs = 10_000): number {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const r = db
    .prepare(
      `UPDATE commands SET status = 'timeout', completed_at = ? WHERE status IN ('sent', 'received', 'queued') AND created_at <= ?`
    )
    .run(nowIso(), cutoff);
  return r.changes;
}
