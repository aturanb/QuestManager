import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Db } from "./db.js";
import {
  touchDevice,
  setExpectedGame,
  createCommand,
  markCommand,
  getCommand,
  getDevice,
  dashboardSessionForDevice,
  latestCommandForDevice,
  sweepExpiredSessions,
  sweepTimedOutCommands,
  replaceDeviceApps,
  listDeviceApps,
} from "./store.js";
import {
  parseAgentMessage,
  type ServerCommand,
  type ServerError,
} from "@cafequest/shared";
import type { AppCatalog } from "./catalog.js";
import { isIgnoredPackage, resolveInstalledApp } from "./installed-apps.js";

export const OFFLINE_MS = 15_000;
export const COMMAND_TIMEOUT_MS = 10_000;
const SWEEP_INTERVAL_MS = 1_000;
const DASHBOARD_PUSH_MS = 1_000;
const AGENT_PING_MS = 5_000;
export const AGENT_WS_PATH = "/agent-ws";
export const DASHBOARD_WS_PATH = "/dashboard-ws";

type DeviceConn = { socket: WebSocket; deviceId: string };

/** Typed protocol error back to an agent; never includes secrets. */
export function sendAgentError(socket: WebSocket, code: ServerError["code"], message: string): void {
  try {
    const err: ServerError = { type: "error", protocolVersion: 1, code, message };
    socket.send(JSON.stringify(err));
  } catch {
    /* socket already gone */
  }
}

export class Hub {
  private devices = new Map<string, DeviceConn>();
  private dashboards = new Set<WebSocket>();
  private timers: NodeJS.Timeout[] = [];
  private log: FastifyInstance["log"];

  constructor(
    private fastify: FastifyInstance,
    private db: Db,
    /** Read live: POST /api/catalog/refresh swaps the catalog without a restart. */
    private catalog: () => AppCatalog,
    private onDeviceChanged: () => void = () => {}
  ) {
    this.log = fastify.log;
  }

  start(): void {
    this.timers.push(setInterval(() => this.sweep(), SWEEP_INTERVAL_MS));
    this.timers.push(setInterval(() => this.pushDashboardState(), DASHBOARD_PUSH_MS));
    this.timers.push(setInterval(() => this.pingAgents(), AGENT_PING_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const c of this.devices.values()) c.socket.close(1001, "server-stopping");
    this.devices.clear();
    for (const d of this.dashboards) d.close(1001, "server-stopping");
    this.dashboards.clear();
  }

  isDeviceConnected(id: string): boolean {
    return this.devices.has(id);
  }

  addAgentSocket(deviceId: string, socket: WebSocket): void {
    const prev = this.devices.get(deviceId);
    if (prev && prev.socket !== socket) {
      // Newest hello wins; the stale socket is told why so it stops retrying blindly.
      sendAgentError(prev.socket, "DUPLICATE_DEVICE", "replaced by a newer connection for this device");
      try {
        prev.socket.close(4001, "duplicate-connection");
      } catch {
        /* already gone */
      }
      this.log.warn({ device: deviceId }, "duplicate connection replaced");
    }
    this.devices.set(deviceId, { socket, deviceId });
    this.onDeviceChanged();
    this.pushDashboardState();
  }

  removeAgentSocket(deviceId: string, socket: WebSocket): void {
    const conn = this.devices.get(deviceId);
    if (conn && conn.socket === socket) {
      this.devices.delete(deviceId);
      this.log.info({ device: deviceId }, "device disconnected");
      this.onDeviceChanged();
      this.pushDashboardState();
    }
  }

  addDashboardSocket(socket: WebSocket): void {
    this.dashboards.add(socket);
    this.sendToDashboard(socket, this.snapshot());
  }

  removeDashboardSocket(socket: WebSocket): void {
    this.dashboards.delete(socket);
  }

  handleAgentMessage(deviceId: string, socket: WebSocket, raw: string): void {
    const parsed = parseAgentMessage(raw);
    if (!parsed.ok) {
      this.log.warn({ device: deviceId, code: parsed.code, detail: parsed.message }, "rejected agent message");
      socket.send(
        JSON.stringify({
          type: "error",
          protocolVersion: 1,
          code: parsed.code,
          message: parsed.message,
        })
      );
      return;
    }
    const msg = parsed.value;
    // A connection may only speak for the device its hello claimed.
    if (msg.type !== "hello" && msg.deviceId !== deviceId) {
      sendAgentError(socket, "DEVICE_MISMATCH", "message deviceId does not match this connection");
      this.log.warn({ device: deviceId }, "rejected mismatched deviceId");
      return;
    }
    // Heartbeat/telemetry drives liveness; other messages also refresh lastSeen.
    if (msg.type === "telemetry") {
      touchDevice(this.db, deviceId, {
        batteryLevel: msg.battery.level,
        charging: msg.battery.charging,
        ...(msg.usage
          ? {
              usageAccessGranted: msg.usage.accessGranted,
              foregroundApp: msg.usage.accessGranted ? msg.usage.foregroundApp : null,
            }
          : {}),
      });
      setExpectedGame(this.db, deviceId, msg.expectedCurrentGame);
      this.log.debug({ device: deviceId, battery: msg.battery.level }, "telemetry");
    } else if (msg.type === "installed_apps") {
      const apps = msg.apps.filter((app) => !isIgnoredPackage(app.packageName));
      try {
        replaceDeviceApps(this.db, deviceId, apps, msg.scannedAt);
      } catch (error) {
        this.log.error({ device: deviceId, err: error }, "failed to persist installed app inventory");
        sendAgentError(socket, "INTERNAL", "failed to persist installed app inventory");
        return;
      }
      touchDevice(this.db, deviceId, {});
      this.log.info({ device: deviceId, count: apps.length }, "installed app inventory updated");
      this.pushDashboardState();
    } else if (msg.type === "command_ack" || msg.type === "command_result") {
      this.handleCommandMessage(deviceId, socket, msg);
    } else {
      // hello or anything else: just refresh liveness
      touchDevice(this.db, deviceId, {});
    }
  }

  /** Ownership + idempotency guard shared by acks and results. */
  private handleCommandMessage(
    deviceId: string,
    socket: WebSocket,
    msg: { commandId: string; type: string; status: string; error?: string }
  ): void {
    const cmd = getCommand(this.db, msg.commandId);
    if (!cmd) {
      sendAgentError(socket, "UNKNOWN_COMMAND", "no such command");
      return;
    }
    if (cmd.deviceId !== deviceId) {
      sendAgentError(socket, "FOREIGN_COMMAND", "command belongs to another device");
      this.log.warn({ device: deviceId, commandId: msg.commandId }, "rejected foreign command message");
      return;
    }
    if (cmd.status === "success" || cmd.status === "failed" || cmd.status === "timeout") {
      // Late/duplicate delivery (retries, timeouts racing results): ignore, never regress.
      this.log.debug({ device: deviceId, commandId: msg.commandId }, "late/duplicate result ignored");
      return;
    }
    if (msg.type === "command_ack") {
      markCommand(this.db, msg.commandId, "received");
      this.log.info({ device: deviceId, commandId: msg.commandId }, "command acknowledged (received)");
      this.pushDashboardState();
    } else {
      markCommand(this.db, msg.commandId, msg.status === "success" ? "success" : "failed", msg.error);
      this.log.info(
        { device: deviceId, commandId: msg.commandId, result: msg.status, error: msg.error ?? null },
        "command result"
      );
      this.pushDashboardState();
    }
  }

  /**
   * Create and immediately deliver a launch command. Returns null when the
   * device is not connected (the REST layer answers 409 offline); there is no
   * store-and-forward queue, so HTTP 202 always means "sent to the socket".
   */
  queueLaunch(deviceId: string, game: { gameId: string; name: string; metaAppId: string }): string | null {
    if (!this.devices.has(deviceId)) return null;
    const cmd = createCommand(this.db, deviceId, "launch_app");
    this.deliver(cmd.id, deviceId, game);
    this.pushDashboardState();
    return cmd.id;
  }

  private deliver(commandId: string, deviceId: string, game: { gameId: string; name: string; metaAppId: string }): void {
    const conn = this.devices.get(deviceId);
    if (!conn) return;
    const command: ServerCommand = {
      type: "command",
      protocolVersion: 1,
      commandId,
      command: "launch_app",
      payload: { gameId: game.gameId, gameName: game.name, metaAppId: game.metaAppId },
    };
    markCommand(this.db, commandId, "sent");
    conn.socket.send(JSON.stringify(command));
    this.log.info({ device: deviceId, game: game.name, commandId }, "launch command sent");
  }

  /**
   * A headset can stop sending telemetry (suspected: asleep) while its
   * WebSocket stack still answers pings; the pong refreshes liveness (see the
   * agent route). Without it the sweep dropped such a socket every ~16s and the
   * agent reconnected 1s later: the Online flicker.
   */
  private pingAgents(): void {
    for (const conn of this.devices.values()) {
      try {
        conn.socket.ping();
      } catch {
        /* already gone; the sweep drops it */
      }
    }
  }

  private sweep(): void {
    sweepExpiredSessions(this.db);
    sweepTimedOutCommands(this.db, COMMAND_TIMEOUT_MS);
    const now = Date.now();
    for (const [id, conn] of [...this.devices.entries()]) {
      const d = getDevice(this.db, id);
      if (!d?.lastSeenAt) continue;
      if (now - new Date(d.lastSeenAt).getTime() > OFFLINE_MS) {
        this.log.warn({ device: id }, "device stale; dropping socket");
        try {
          conn.socket.close(4000, "offline-sweep");
        } catch {
          /* already gone */
        }
        this.devices.delete(id);
        this.onDeviceChanged();
        this.pushDashboardState();
      }
    }
  }

  snapshot() {
    const devices = this.db
      .prepare(`SELECT * FROM devices ORDER BY created_at ASC`)
      .all() as any[];
    const now = Date.now();
    return {
      serverTime: new Date(now).toISOString(),
      devices: devices.map((d) => {
        const session = dashboardSessionForDevice(this.db, d.id);
        const lastCommand = latestCommandForDevice(this.db, d.id);
        const installedApps = listDeviceApps(this.db, d.id).map((app) => resolveInstalledApp(this.db, this.catalog(), app));
        const foregroundInstalled = d.foreground_package_name
          ? installedApps.find((app) => app.packageName === d.foreground_package_name)
          : null;
        return {
          id: d.id,
          name: d.name,
          model: d.model,
          agentVersion: d.agent_version,
          lastSeenAt: d.last_seen_at,
          batteryLevel: d.battery_level,
          charging: d.charging === null ? null : !!d.charging,
          expectedGame:
            d.expected_game_id && d.expected_game_name
              ? { gameId: d.expected_game_id, name: d.expected_game_name, launchedAt: d.expected_game_started_at }
              : null,
          usageAccessGranted: d.usage_access_granted === null ? null : !!d.usage_access_granted,
          foregroundApp:
            foregroundInstalled && d.foreground_started_at
              ? {
                  packageName: foregroundInstalled.packageName,
                  name: foregroundInstalled.name,
                  startedAt: d.foreground_started_at,
                }
              : null,
          online: !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() <= OFFLINE_MS,
          session: session
            ? { id: session.id, startedAt: session.startedAt, endsAt: session.endsAt, status: session.status }
            : null,
          lastCommand: lastCommand ? { id: lastCommand.id, status: lastCommand.status, error: lastCommand.error } : null,
          installedApps,
        };
      }),
    };
  }

  pushDashboardState(): void {
    const snap = this.snapshot();
    for (const socket of [...this.dashboards]) {
      this.sendToDashboard(socket, snap);
    }
  }

  private sendToDashboard(socket: WebSocket, payload: unknown): void {
    try {
      socket.send(JSON.stringify({ type: "state", payload }));
    } catch {
      /* dropped; close handler will clean up */
    }
  }
}
