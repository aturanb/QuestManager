// Optional Touch-controller battery monitoring (spec 2026-10-09).
//
// Horizon OS knows the left/right controller levels but exposes them only
// through `dumpsys OVRRemoteService`, so this collector is best-effort
// diagnostics over wireless ADB. It is deliberately outside the agent
// liveness and command paths: nothing here can make a headset look offline,
// fail a session, or fail a launch. Raw ADB output, endpoints, and controller
// serial numbers never leave this module — callers only ever see the bounded
// status/reason values below.
import { execFile } from "node:child_process";

export type ControllerBatterySide = { level: number; state: "active" | "inactive" };

export type ControllerBatteryReason =
  | null
  | "headset_offline"
  | "no_wireless_address"
  | "adb_connect_failed"
  | "dump_failed"
  | "parse_failed";

export type DeviceControllerBattery = {
  left: ControllerBatterySide | null;
  right: ControllerBatterySide | null;
  observedAt: string | null;
  status: "available" | "stale" | "unavailable";
  reason: ControllerBatteryReason;
};

export type ControllerBatteryMonitoringState = {
  enabled: boolean;
  availability: "disabled" | "ready" | "adb_unavailable" | "no_devices";
};

/** One live agent connection: where its socket came from, if it is pollable. */
export type CollectorTarget = { deviceId: string; address: string | null };

export type AdbRunner = (
  executable: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<{ stdout: string; stderr: string }>;

/** Public view the hub reads; no ADB details cross this boundary. */
export interface ControllerBatteryView {
  monitoringState(): ControllerBatteryMonitoringState;
  deviceState(deviceId: string): DeviceControllerBattery | null;
}

/** Wireless ADB listens on 5555 after `adb tcpip 5555` (per-headset setup). */
const ADB_TCP_PORT = 5555;
const VERSION_TIMEOUT_MS = 2_000;
const CONNECT_TIMEOUT_MS = 5_000;
const DUMP_TIMEOUT_MS = 5_000;
/** dumpsys OVRRemoteService is ~20 KB; cap the pipe so one odd device cannot grow it. */
const MAX_OUTPUT_BYTES = 512 * 1024;

/** Never serialized: the reason codes above are the public contract. */
class AdbCommandError extends Error {}

/**
 * Bounded execFile runner. Arguments are always argv — the collector never
 * builds a shell string, so an address cannot inject a command.
 */
export const defaultAdbRunner: AdbRunner = (executable, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, shell: false, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new AdbCommandError("adb command failed"));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });

/**
 * The remote address of a live agent socket, as an IPv4 string usable as an ADB
 * endpoint. Loopback, IPv6, and anything malformed are not pollable: return null
 * rather than handing a suspicious string to a subprocess.
 */
export function normalizeRemoteIpv4(address: string | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  // Node reports IPv4-mapped IPv6 for a v4 socket on some platforms.
  const candidate = trimmed.toLowerCase().startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  if (candidate.startsWith("::")) return null;
  const parts = candidate.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  const [first] = octets as [number, ...number[]];
  if (first === 0 || first === 127) return null;
  return octets.join(".");
}

/** Comma-separated `Key: value` fields of one summary line, keys de-duplicated. */
function parseSummaryFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of line.split(",")) {
    const separator = part.indexOf(":");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

function parseBatteryPercent(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d{1,3})%$/.exec(value.trim());
  if (!match) return null;
  const level = Number(match[1]);
  return level >= 0 && level <= 100 ? level : null;
}

/**
 * Best-effort parse of `dumpsys OVRRemoteService`. Horizon OS may change this
 * text at any update, so anything unexpected returns null (a typed parse
 * failure) instead of guessing. Exactly one Left and one Right summary is
 * required; `Status` is only `active` when it says Active, and the separate
 * `ExternalStatus` field is never read as the controller status.
 */
export function parseControllerBatteryDump(
  raw: string
): { left: ControllerBatterySide; right: ControllerBatterySide } | null {
  let left: ControllerBatterySide | null = null;
  let right: ControllerBatterySide | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!/^\s*Paired device:/.test(line)) continue;
    const fields = parseSummaryFields(line);
    const type = (fields.get("Type") ?? "").toLowerCase();
    if (type !== "left" && type !== "right") continue;
    const level = parseBatteryPercent(fields.get("Battery"));
    if (level === null) return null;
    const side: ControllerBatterySide = {
      level,
      state: (fields.get("Status") ?? "").toLowerCase() === "active" ? "active" : "inactive",
    };
    if (type === "left") {
      if (left) return null;
      left = side;
    } else {
      if (right) return null;
      right = side;
    }
  }
  return left && right ? { left, right } : null;
}

export type ControllerBatteryCollectorOptions = {
  adbPath: string;
  runner: AdbRunner;
  /** Live agent connections; address null = not wirelessly reachable. */
  targets: () => readonly CollectorTarget[];
  now: () => Date;
  pollIntervalMs: number;
  onChange: () => void;
};

/**
 * One timer, one in-flight cycle, one reading map. Readings are ephemeral by
 * design: a server restart must not present yesterday's controller levels as
 * live data.
 */
export class ControllerBatteryCollector implements ControllerBatteryView {
  private enabled = false;
  private availability: ControllerBatteryMonitoringState["availability"] = "disabled";
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  /** Endpoints this collector newly connected and therefore may disconnect. */
  private owned = new Set<string>();
  private readings = new Map<string, DeviceControllerBattery>();
  /** Bumped by stop/disable so an in-flight cycle cannot publish afterwards. */
  private generation = 0;
  private stopped = false;

  constructor(private readonly options: ControllerBatteryCollectorOptions) {}

  monitoringState(): ControllerBatteryMonitoringState {
    return { enabled: this.enabled, availability: this.availability };
  }

  /**
   * Public per-device state. Off means null (the dashboard hides the feature);
   * a missing/addressless target is a connection fact, not an ADB failure.
   */
  deviceState(deviceId: string): DeviceControllerBattery | null {
    if (!this.enabled) return null;
    const target = this.options.targets().find((t) => t.deviceId === deviceId);
    if (!target) return emptyState("headset_offline");
    if (!target.address) return emptyState("no_wireless_address");
    return this.readings.get(deviceId) ?? emptyState(null);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled || this.stopped) return;
    if (enabled) {
      this.enabled = true;
      this.generation += 1;
      const adbReady = await this.adbAvailable();
      if (!this.enabled || this.stopped) return; // toggled off while checking
      this.availability = adbReady ? (this.options.targets().length > 0 ? "ready" : "no_devices") : "adb_unavailable";
      this.timer = setInterval(() => {
        void this.pollNow();
      }, this.options.pollIntervalMs);
      // Started, not awaited: the toggle's HTTP response must not wait for
      // eight headsets' worth of ADB round-trips.
      void this.pollNow();
      this.options.onChange();
    } else {
      this.enabled = false;
      this.generation += 1;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.readings.clear();
      const pending = this.inFlight;
      await this.disconnectOwned();
      await pending?.catch(() => undefined);
      // A cycle that finished after the generation bump published nothing, but it
      // may have connected an endpoint in the meantime.
      await this.disconnectOwned();
      this.availability = "disabled";
      this.options.onChange();
    }
  }

  /** One cycle at a time; concurrent callers join the cycle already running. */
  pollNow(): Promise<void> {
    if (this.stopped || !this.enabled) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const cycle = this.runCycle(generation).finally(() => {
      if (this.inFlight === cycle) this.inFlight = null;
    });
    this.inFlight = cycle;
    return cycle;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.enabled = false;
    this.generation += 1;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.readings.clear();
    const pending = this.inFlight;
    await pending?.catch(() => undefined);
    await this.disconnectOwned();
    this.availability = "disabled";
  }

  private async runCycle(generation: number): Promise<void> {
    const targets = this.targetsOnce();
    const adbReady = await this.adbAvailable();
    if (generation !== this.generation) return;
    if (!adbReady) {
      this.availability = "adb_unavailable";
      this.options.onChange();
      return;
    }
    this.availability = targets.length > 0 ? "ready" : "no_devices";
    if (targets.length === 0) {
      this.options.onChange();
      return;
    }
    // Headsets are polled concurrently; each device still runs one operation at
    // a time because a cycle is single-flight.
    await Promise.all(targets.map((target) => this.collectDevice(target, generation)));
    if (generation !== this.generation) return;
    this.options.onChange();
  }

  private targetsOnce(): CollectorTarget[] {
    const seen = new Set<string>();
    const unique: CollectorTarget[] = [];
    for (const target of this.options.targets()) {
      if (seen.has(target.deviceId)) continue;
      seen.add(target.deviceId);
      unique.push(target);
    }
    return unique;
  }

  private async collectDevice(target: CollectorTarget, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (!target.address) {
      this.recordFailure(target.deviceId, "no_wireless_address", generation);
      return;
    }
    const endpoint = `${target.address}:${ADB_TCP_PORT}`;
    try {
      const connected = await this.options.runner(
        this.options.adbPath,
        ["connect", endpoint],
        CONNECT_TIMEOUT_MS
      );
      const text = `${connected.stdout}\n${connected.stderr}`.toLowerCase();
      if (!text.includes("connected to") || /\b(failed|cannot|unable|refused)\b/.test(text)) {
        this.recordFailure(target.deviceId, "adb_connect_failed", generation);
        return;
      }
      // "already connected to X" belongs to whoever connected it (another tool,
      // an earlier session, USB): CafeQuest must not disconnect that.
      if (!text.includes("already connected")) this.owned.add(endpoint);
    } catch {
      this.recordFailure(target.deviceId, "adb_connect_failed", generation);
      return;
    }

    let stdout: string;
    try {
      const dump = await this.options.runner(
        this.options.adbPath,
        ["-s", endpoint, "shell", "dumpsys", "OVRRemoteService"],
        DUMP_TIMEOUT_MS
      );
      stdout = dump.stdout;
    } catch {
      this.recordFailure(target.deviceId, "dump_failed", generation);
      return;
    }
    if (generation !== this.generation) return;
    const parsed = parseControllerBatteryDump(stdout);
    if (!parsed) {
      this.recordFailure(target.deviceId, "parse_failed", generation);
      return;
    }
    this.readings.set(target.deviceId, {
      left: parsed.left,
      right: parsed.right,
      observedAt: this.options.now().toISOString(),
      status: "available",
      reason: null,
    });
  }

  /** A failed cycle keeps the last good values with their old time, as stale. */
  private recordFailure(deviceId: string, reason: ControllerBatteryReason, generation: number): void {
    if (generation !== this.generation) return;
    const previous = this.readings.get(deviceId);
    if (previous?.observedAt && (previous.status === "available" || previous.status === "stale")) {
      this.readings.set(deviceId, { ...previous, status: "stale", reason });
      return;
    }
    this.readings.set(deviceId, emptyState(reason));
  }

  private async adbAvailable(): Promise<boolean> {
    try {
      await this.options.runner(this.options.adbPath, ["version"], VERSION_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  private async disconnectOwned(): Promise<void> {
    const endpoints = [...this.owned];
    this.owned.clear();
    for (const endpoint of endpoints) {
      try {
        await this.options.runner(this.options.adbPath, ["disconnect", endpoint], CONNECT_TIMEOUT_MS);
      } catch {
        // Best effort: a failed disconnect never fails the toggle.
      }
    }
  }
}

function emptyState(reason: ControllerBatteryReason): DeviceControllerBattery {
  return { left: null, right: null, observedAt: null, status: "unavailable", reason };
}
