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
import type { WirelessDebuggingState } from "@cafequest/shared";

export type ControllerBatterySide = { level: number; state: "active" | "inactive" };

export type ControllerBatteryReason =
  | null
  | "headset_offline"
  | "no_wireless_address"
  | "adb_connect_failed"
  | "wireless_debugging_off"
  | "agent_permission_missing"
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

/**
 * One live agent connection: where its socket came from, if it is pollable, and
 * what its Horizon OS Wireless Debugging looked like at the last telemetry.
 */
export type CollectorTarget = {
  deviceId: string;
  address: string | null;
  wirelessDebugging?: WirelessDebuggingState;
};

export type AdbRunner = (
  executable: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<{ stdout: string; stderr: string }>;

/** Public view the hub reads; no ADB details cross this boundary. */
export interface ControllerBatteryView {
  monitoringState(): ControllerBatteryMonitoringState;
  deviceState(deviceId: string): DeviceControllerBattery | null;
  /** Re-poll shortly (no-op while monitoring is off); see ControllerBatteryCollector.pollSoon. */
  pollSoon(): void;
}

/** Wireless ADB listens on 5555 after `adb tcpip 5555` (per-headset setup). */
const ADB_TCP_PORT = 5555;
const VERSION_TIMEOUT_MS = 2_000;
const CONNECT_TIMEOUT_MS = 5_000;
const DUMP_TIMEOUT_MS = 5_000;
/** dumpsys OVRRemoteService is ~20 KB; cap the pipe so one odd device cannot grow it. */
const MAX_OUTPUT_BYTES = 512 * 1024;
const MDNS_TIMEOUT_MS = 3_000;
/** The headset needs a moment after Wireless Debugging turns on before it advertises its port. */
const DEFAULT_SETTLE_MS = 2_000;
const MDNS_TLS_SERVICE = "_adb-tls-connect._tcp";
const MDNS_LEGACY_SERVICE = "_adb._tcp";

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

/** Wireless ADB endpoints a headset advertises over mDNS, keyed by its IPv4. */
export type MdnsEndpoints = Map<string, { tls?: string; legacy?: string }>;

/**
 * Parse `adb mdns services`. Only the two connectable ADB service types are
 * kept, and only when the endpoint is a plain IPv4 with a numeric port, so
 * nothing else in the output can ever become an argument to `adb`.
 */
export function parseMdnsServices(raw: string): MdnsEndpoints {
  const found: MdnsEndpoints = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const service = parts[1];
    const endpoint = parts[2] ?? "";
    if (service !== MDNS_TLS_SERVICE && service !== MDNS_LEGACY_SERVICE) continue;
    const split = endpoint.lastIndexOf(":");
    if (split === -1) continue;
    const ip = normalizeRemoteIpv4(endpoint.slice(0, split));
    const portText = endpoint.slice(split + 1);
    if (!ip || !/^\d{1,5}$/.test(portText)) continue;
    const port = Number(portText);
    if (port < 1 || port > 65_535) continue;
    const entry = found.get(ip) ?? {};
    if (service === MDNS_TLS_SERVICE) {
      if (!entry.tls) entry.tls = `${ip}:${port}`;
    } else if (!entry.legacy) {
      entry.legacy = `${ip}:${port}`;
    }
    found.set(ip, entry);
  }
  return found;
}

/** TLS Wireless Debugging first, then a legacy tcpip service, then the 5555 guess. */
function endpointFor(address: string, endpoints: MdnsEndpoints): string {
  const found = endpoints.get(address);
  return found?.tls ?? found?.legacy ?? `${address}:${ADB_TCP_PORT}`;
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
  /** Delay before an early re-poll; tests shorten it. */
  settleMs?: number;
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
  /** A pending early re-poll (see pollSoon); at most one. */
  private soonTimer: NodeJS.Timeout | null = null;

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
      this.clearSoon();
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

  /**
   * Poll once more shortly: an agent just reported Wireless Debugging as on, but
   * the headset needs a moment to advertise its port, and waiting out the poll
   * interval leaves a failure hint on the card for up to a minute. Repeated calls
   * coalesce, it never runs while monitoring is off, and it queues behind a cycle
   * already running (that one may have started before the port existed).
   */
  pollSoon(): void {
    if (this.stopped || !this.enabled || this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.pollAfterRunning().catch(() => undefined);
    }, this.options.settleMs ?? DEFAULT_SETTLE_MS);
  }

  private async pollAfterRunning(): Promise<void> {
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    await this.pollNow();
  }

  private clearSoon(): void {
    if (this.soonTimer) {
      clearTimeout(this.soonTimer);
      this.soonTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.enabled = false;
    this.generation += 1;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearSoon();
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
    // One mDNS listing serves every headset; skipped when nobody is pollable.
    const endpoints: MdnsEndpoints = targets.some((target) => target.address)
      ? await this.discoverEndpoints()
      : new Map();
    if (generation !== this.generation) return;
    // Headsets are polled concurrently; each device still runs one operation at
    // a time because a cycle is single-flight.
    await Promise.all(targets.map((target) => this.collectDevice(target, generation, endpoints)));
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

  private async collectDevice(target: CollectorTarget, generation: number, endpoints: MdnsEndpoints): Promise<void> {
    if (generation !== this.generation) return;
    if (!target.address) {
      this.recordFailure(target.deviceId, "no_wireless_address", generation);
      return;
    }
    const endpoint = endpointFor(target.address, endpoints);
    try {
      const connected = await this.options.runner(
        this.options.adbPath,
        ["connect", endpoint],
        CONNECT_TIMEOUT_MS
      );
      const text = `${connected.stdout}\n${connected.stderr}`.toLowerCase();
      if (!text.includes("connected to") || /\b(failed|cannot|unable|refused)\b/.test(text)) {
        this.recordFailure(target.deviceId, this.connectFailureReason(target), generation);
        return;
      }
      // "already connected to X" belongs to whoever connected it (another tool,
      // an earlier session, USB): CafeQuest must not disconnect that.
      if (!text.includes("already connected")) this.owned.add(endpoint);
    } catch {
      this.recordFailure(target.deviceId, this.connectFailureReason(target), generation);
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

  /**
   * Why a connect failed, in the words the agent's own report allows. Only
   * consulted after a real failure, so a headset readable through legacy tcpip
   * never earns a Wireless Debugging hint merely because the setting is off.
   */
  private connectFailureReason(target: CollectorTarget): ControllerBatteryReason {
    if (target.wirelessDebugging === "not_permitted") return "agent_permission_missing";
    if (target.wirelessDebugging === "off") return "wireless_debugging_off";
    return "adb_connect_failed";
  }

  /** mDNS is a discovery aid only: without it the legacy 5555 guess still works. */
  private async discoverEndpoints(): Promise<MdnsEndpoints> {
    try {
      const listing = await this.options.runner(this.options.adbPath, ["mdns", "services"], MDNS_TIMEOUT_MS);
      return parseMdnsServices(listing.stdout);
    } catch {
      return new Map();
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
