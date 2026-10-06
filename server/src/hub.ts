import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Db } from "./db.js";
import {
  upsertDevice,
  touchDevice,
  setExpectedGame,
  createCommand,
  markCommand,
  getCommand,
  getDevice,
  activeSessionForDevice,
  sweepExpiredSessions,
  sweepTimedOutCommands,
} from "./store.js";
import {
  parseAgentMessage,
  type ServerCommand,
} from "@cafequest/shared";

export const OFFLINE_MS = 15_000;
export const COMMAND_TIMEOUT_MS = 10_000;
const SWEEP_INTERVAL_MS = 5_000;
const DASHBOARD_PUSH_MS = 1_000;
export const AGENT_WS_PATH = "/agent-ws";
export const DASHBOARD_WS_PATH = "/dashboard-ws";

type DeviceConn = { socket: WebSocket; deviceId: string };

export class Hub {
  private devices = new Map<string, DeviceConn>();
  private dashboards = new Set<WebSocket>();
  private timers: NodeJS.Timeout[] = [];
  private log: FastifyInstance["log"];

  constructor(
    private fastify: FastifyInstance,
    private db: Db,
    private onDeviceChanged: () => void = () => {}
  ) {
    this.log = fastify.log;
  }

  start(): void {
    this.timers.push(setInterval(() => this.sweep(), SWEEP_INTERVAL_MS));
    this.timers.push(setInterval(() => this.pushDashboardState(), DASHBOARD_PUSH_MS));
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
    // Heartbeat/telemetry drives liveness; other messages also refresh lastSeen.
    if (msg.type === "telemetry") {
      touchDevice(this.db, deviceId, {
        batteryLevel: msg.battery.level,
        charging: msg.battery.charging,
      });
      setExpectedGame(this.db, deviceId, msg.expectedCurrentGame);
      this.log.debug({ device: deviceId, battery: msg.battery.level }, "telemetry");
    } else if (msg.type === "command_ack") {
      markCommand(this.db, msg.commandId, "received");
      this.log.info({ device: deviceId, commandId: msg.commandId }, "command acknowledged (received)");
      this.pushDashboardState();
    } else if (msg.type === "command_result") {
      markCommand(this.db, msg.commandId, msg.status === "success" ? "success" : "failed", msg.error);
      this.log.info(
        { device: deviceId, commandId: msg.commandId, result: msg.status, error: msg.error ?? null },
        "command result"
      );
      this.pushDashboardState();
    } else {
      // hello or anything else: just refresh liveness
      touchDevice(this.db, deviceId, {});
    }
  }

  /**
   * Queue a launch command. If the device is connected we deliver immediately;
   * otherwise it stays 'queued' and is delivered on the device's next connect.
   * Returns the command id.
   */
  queueLaunch(deviceId: string, game: { gameId: string; name: string; metaAppId: string }): string {
    const cmd = createCommand(this.db, deviceId, "launch_app");
    const deliver = this.devices.has(deviceId);
    if (deliver) {
      this.deliver(cmd.id, deviceId, game);
    }
    this.pushDashboardState();
    return cmd.id;
  }

  /** Send all queued commands for a freshly connected device. */
  deliverQueuedCommands(deviceId: string): void {
    const rows = this.db
      .prepare(`SELECT id FROM commands WHERE device_id = ? AND status = 'queued' ORDER BY created_at ASC`)
      .all(deviceId) as Array<{ id: string }>;
    for (const r of rows) {
      const cmd = getCommand(this.db, r.id);
      if (!cmd) continue;
      // We only persist launch commands today; payload is reconstructed from games.
      const game = this.db
        .prepare(`SELECT id, name, meta_app_id FROM games WHERE id = (SELECT expected_game_id FROM devices WHERE id = ?)`)
        .get(deviceId) as any;
      const meta = game ?? { id: "unknown", name: "unknown", meta_app_id: "unknown" };
      this.deliver(cmd.id, deviceId, { gameId: meta.id, name: meta.name, metaAppId: meta.meta_app_id });
    }
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
        const session = activeSessionForDevice(this.db, d.id);
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
          online: !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() <= OFFLINE_MS,
          session: session
            ? { id: session.id, startedAt: session.startedAt, endsAt: session.endsAt, status: session.status }
            : null,
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
