import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { makeHello, makeTelemetry } from "./protocolClient.js";
import { stepBattery, type BatteryState } from "./battery.js";
import type { ExpectedGame } from "@cafequest/shared";

export type DeviceSimOptions = {
  deviceId?: string;
  name: string;
  model?: string;
  serverUrl: string; // ws://host:port
  battery: BatteryState;
  telemetryIntervalMs?: number;
  launchBehavior?: "succeed" | "fail" | "never-complete";
  reconnect?: boolean;
  log?: (msg: string) => void;
};

export type DeviceStats = {
  commandsReceived: number;
  acksSent: number;
  resultsSent: number;
  reconnects: number;
};

/**
 * Simulated Quest agent: connects to the server, says hello, sends telemetry
 * every 5s, and handles launch commands exactly like the real agent protocol.
 */
export class DeviceSim {
  readonly deviceId: string;
  private ws: WebSocket | null = null;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private closedByUser = false;
  battery: BatteryState;
  expectedGame: ExpectedGame | null = null;
  stats: DeviceStats = { commandsReceived: 0, acksSent: 0, resultsSent: 0, reconnects: 0 };
  connected = false;

  constructor(private opts: DeviceSimOptions) {
    this.deviceId = opts.deviceId ?? randomUUID();
    this.battery = { ...opts.battery };
  }

  get name(): string {
    return this.opts.name;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closedByUser = true;
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }

  setLaunchBehavior(b: NonNullable<DeviceSimOptions["launchBehavior"]>): void {
    this.opts.launchBehavior = b;
  }

  setCharging(charging: boolean): void {
    this.battery.charging = charging;
  }

  private clearTimers(): void {
    if (this.telemetryTimer) { clearInterval(this.telemetryTimer); this.telemetryTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private scheduleReconnect(): void {
    if (!this.opts.reconnect || this.closedByUser) return;
    const delays = [1000, 2000, 5000, 10000, 30000];
    const d = delays[Math.min(this.attempt, delays.length - 1)]!;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), d);
  }

  private connect(): void {
    const url = `${this.opts.serverUrl.replace(/\/$/, "")}/agent-ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
      this.connected = true;
      const hello = makeHello({
        deviceId: this.deviceId,
        deviceName: this.opts.name,
        deviceModel: this.opts.model ?? "Quest 3",
        agentVersion: "0.1.0-sim",
      });
      ws.send(JSON.stringify(hello));
      this.opts.log?.(`${this.opts.name} connected`);
      const interval = this.opts.telemetryIntervalMs ?? 5000;
      this.telemetryTimer = setInterval(() => this.sendTelemetry(), interval);
    });

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : String(raw);
      let msg: any;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg?.type === "command" && msg?.command === "launch_app") {
        this.stats.commandsReceived += 1;
        ws.send(JSON.stringify({ type: "command_ack", protocolVersion: 1, commandId: msg.commandId, status: "received" }));
        this.stats.acksSent += 1;
        const game: ExpectedGame = {
          gameId: msg.payload.gameId,
          name: msg.payload.gameName,
          launchedAt: new Date().toISOString(),
        };
        const behavior = this.opts.launchBehavior ?? "succeed";
        if (behavior === "succeed") {
          this.expectedGame = game;
          setTimeout(() => {
            try {
              ws.send(JSON.stringify({ type: "command_result", protocolVersion: 1, commandId: msg.commandId, status: "success" }));
              this.stats.resultsSent += 1;
            } catch { /* socket gone */ }
          }, 300);
        } else if (behavior === "fail") {
          setTimeout(() => {
            try {
              ws.send(JSON.stringify({ type: "command_result", protocolVersion: 1, commandId: msg.commandId, status: "failed", error: "TARGET_NOT_INSTALLED" }));
              this.stats.resultsSent += 1;
            } catch { /* socket gone */ }
          }, 300);
        } else {
          // never-complete: command_result never arrives (timeout scenario)
        }
      }
    });

    ws.on("close", () => {
      this.connected = false;
      this.clearTimers();
      this.ws = null;
      if (!this.closedByUser) {
        this.stats.reconnects += 1;
        this.opts.log?.(`${this.opts.name} disconnected; will reconnect`);
        this.scheduleReconnect();
      }
    });

    ws.on("error", () => {
      // Swallow; close handler schedules reconnect. Network loss must not crash (§25).
    });
  }

  private sendTelemetry(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.battery = stepBattery(this.battery, 1);
    const tel = makeTelemetry({
      deviceId: this.deviceId,
      timestamp: new Date().toISOString(),
      battery: { level: this.battery.level, charging: this.battery.charging },
      agent: { foreground: true },
      expectedCurrentGame: this.expectedGame,
    });
    try { this.ws.send(JSON.stringify(tel)); } catch { /* ignore */ }
  }
}
