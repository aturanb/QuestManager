// Controller battery collection is optional diagnostics: best-effort ADB reads
// that must never leak ADB output, serials, or addresses into public state.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ControllerBatteryCollector,
  normalizeRemoteIpv4,
  parseControllerBatteryDump,
  type AdbRunner,
  type CollectorTarget,
} from "../src/controller-battery.js";

// Verbatim `adb shell dumpsys OVRRemoteService` lines from the café Quest 3
// (Horizon OS on Android 14). The parser is best-effort against this shape.
const RIGHT_LINE =
  "  Paired device: c064a7beb7813010, Type:  Right, Model: RUBYPRQ, HardwareRev: 0x9a, Firmware: 207.5.0, ImuModel: ICM42686, Battery:  80%, isAttached: 0, Serial Number: 2L0YNB2G7Z041D, Status: Disabled, ExternalStatus: DISABLED, TrackingStatus: POSITION, BrightnessLevel: GOOD";
const LEFT_LINE =
  "  Paired device: 89e1939fc347db94, Type:   Left, Model: RUBYPRQ, HardwareRev: 0x9a, Firmware: 207.5.0, ImuModel: ICM42686, Battery: 100%, isAttached: 0, Serial Number: 2L0YMB4G7Z0CQG, Status: Disabled, ExternalStatus: DISABLED, TrackingStatus: NONE, BrightnessLevel: GOOD";
const ACTIVE_LEFT_LINE = LEFT_LINE.replace("Status: Disabled", "Status: Active");

const FIXTURE = `
ControllerGlue Status
${RIGHT_LINE}
        Disabled: 31 times, current from 38240.521 (999.863s)
      Active: 24 times,    last from 37991.210 to 38240.518 (249.309s)

    Disconnect history (c064a7beb7813010):
      19:12:35.852 (999.867s ago) - from=Active exitingStream=1 battery=80 activeFor=249.309s

${LEFT_LINE}
  Prev #1 Tracking Metrics:
    session duration         : 249.309s
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- parser and address normalization --------------------------------------

test("parses left and right summaries", () => {
  const parsed = parseControllerBatteryDump(FIXTURE);
  assert.ok(parsed, "the observed fixture must parse");
  assert.deepEqual(parsed.left, { level: 100, state: "inactive" });
  assert.deepEqual(parsed.right, { level: 80, state: "inactive" });
});

test("parses reversed order and an active controller", () => {
  const reversed = parseControllerBatteryDump(`${LEFT_LINE.replace("Status: Disabled", "Status: Active")}\n${RIGHT_LINE}\n`);
  assert.ok(reversed);
  assert.deepEqual(reversed.left, { level: 100, state: "active" });
  assert.deepEqual(reversed.right, { level: 80, state: "inactive" });
});

test("treats any non-active status as inactive", () => {
  for (const status of ["Disabled", "Searching", "Connecting", "Blocked", "Sleeping"]) {
    const parsed = parseControllerBatteryDump(`${ACTIVE_LEFT_LINE.replace("Status: Active", `Status: ${status}`)}\n${RIGHT_LINE}\n`);
    assert.ok(parsed, `status ${status} must still parse`);
    assert.equal(parsed.left.state, "inactive", `status ${status}`);
  }
});

test("rejects incomplete duplicate malformed and out-of-range summaries", () => {
  const cases: Array<[string, string]> = [
    ["only one hand", `${RIGHT_LINE}\n`],
    ["no paired lines", "ControllerGlue Status\n  nothing to see here\n"],
    ["empty output", ""],
    ["duplicate right", `${RIGHT_LINE}\n${RIGHT_LINE}\n`],
    ["non-integer battery", FIXTURE.replace("Battery: 100%", "Battery: full")],
    ["missing percent", FIXTURE.replace("Battery: 100%", "Battery: 100")],
    ["out-of-range battery", FIXTURE.replace("Battery: 100%", "Battery: 120%")],
    ["negative battery", FIXTURE.replace("Battery: 100%", "Battery: -5%")],
    ["missing type", FIXTURE.replace("Type:   Left, ", "")],
    ["renamed field", FIXTURE.replace("Battery:", "Charge:")],
    ["changed output shape", "Paired device: {left: 100, right: 80}\n"],
  ];
  for (const [name, raw] of cases) {
    assert.equal(parseControllerBatteryDump(raw), null, name);
  }
});

test("never matches the external status field as the controller status", () => {
  const parsed = parseControllerBatteryDump(
    `${LEFT_LINE.replace("Status: Disabled", "Status: Active")}\n${RIGHT_LINE.replace("Status: Disabled", "ExternalStatus: ACTIVE")}\n`
  );
  assert.ok(parsed);
  assert.equal(parsed.right.state, "inactive", "ExternalStatus must not be read as Status");
});

test("accepts only direct non-loopback IPv4 addresses", () => {
  assert.equal(normalizeRemoteIpv4("192.168.1.20"), "192.168.1.20");
  assert.equal(normalizeRemoteIpv4("10.0.0.7"), "10.0.0.7");
  assert.equal(normalizeRemoteIpv4("::ffff:192.168.1.20"), "192.168.1.20");
  assert.equal(normalizeRemoteIpv4(" 192.168.1.20 "), "192.168.1.20");
  for (const bad of [
    undefined,
    "",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "fe80::1234",
    "localhost",
    "192.168.1",
    "192.168.1.256",
    "192.168.1.20:5555",
    "192.168.1.20; rm -rf /",
    "$(reboot)",
    "192.168.1.20 && adb",
    "not-an-ip",
  ]) {
    assert.equal(normalizeRemoteIpv4(bad), null, String(bad));
  }
});

// --- collector lifecycle ---------------------------------------------------

class FakeAdb {
  calls: string[][] = [];
  versionOk = true;
  connectImpl: (endpoint: string) => string = (endpoint) => `connected to ${endpoint}`;
  connectThrows = false;
  dumpImpl: (endpoint: string) => string = () => FIXTURE;
  dumpThrows = false;
  /** When set, every dump waits for it, letting tests observe overlapping cycles. */
  gate: Promise<void> | null = null;
  private activeDumps = 0;
  maxConcurrentDumps = 0;

  runner: AdbRunner = async (executable, args) => {
    this.calls.push([executable, ...args]);
    const [command] = args;
    if (command === "version") {
      if (!this.versionOk) throw new Error("spawn adb ENOENT");
      return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
    }
    if (command === "connect") {
      if (this.connectThrows) throw new Error("adb connect failed: Connection refused");
      const endpoint = args[1] ?? "";
      const stdout = this.connectImpl(endpoint);
      if (stdout.toLowerCase().includes("failed")) throw new Error("adb connect failed");
      return { stdout: `${stdout}\n`, stderr: "" };
    }
    if (command === "-s") {
      const endpoint = args[1] ?? "";
      this.activeDumps += 1;
      this.maxConcurrentDumps = Math.max(this.maxConcurrentDumps, this.activeDumps);
      try {
        if (this.gate) await this.gate;
        if (this.dumpThrows) throw new Error("adb: device offline");
        return { stdout: this.dumpImpl(endpoint), stderr: "" };
      } finally {
        this.activeDumps -= 1;
      }
    }
    if (command === "disconnect") {
      return { stdout: `disconnected ${args[1] ?? ""}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };

  argv(): string[] {
    return this.calls.map((call) => call.join(" "));
  }

  count(command: string): number {
    return this.calls.filter((call) => call[1] === command).length;
  }
}

function harness(overrides: Partial<{ targets: () => readonly CollectorTarget[]; pollIntervalMs: number }> = {}) {
  const adb = new FakeAdb();
  let clockMs = Date.parse("2026-10-09T12:00:00.000Z");
  const changes = { count: 0 };
  const targets = overrides.targets ?? (() => [{ deviceId: "dev-1", address: "192.168.1.109" }]);
  const collector = new ControllerBatteryCollector({
    adbPath: "/opt/platform-tools/adb",
    runner: adb.runner,
    targets,
    now: () => new Date(clockMs),
    pollIntervalMs: overrides.pollIntervalMs ?? 60_000,
    onChange: () => {
      changes.count += 1;
    },
  });
  return {
    adb,
    collector,
    changes,
    advance(ms: number) {
      clockMs += ms;
    },
  };
}

test("enabling polls once immediately and then once per interval", async () => {
  const h = harness({ pollIntervalMs: 30 });
  assert.equal(h.collector.monitoringState().enabled, false);
  await h.collector.setEnabled(true);
  // Disabling must not be needed for the first cycle; await it explicitly.
  await h.collector.pollNow();

  assert.equal(h.collector.monitoringState().enabled, true);
  assert.equal(h.collector.monitoringState().availability, "ready");
  assert.ok(h.adb.argv().some((line) => line.includes("shell dumpsys OVRRemoteService")), "one dump per cycle");
  assert.ok(h.adb.argv().includes("/opt/platform-tools/adb connect 192.168.1.109:5555"), "argv, never a shell string");
  assert.ok(!h.adb.argv().some((line) => line.includes("sh -c")), "no shell wrapper");

  const firstCycleDumps = h.adb.count("-s");
  await wait(80);
  assert.ok(h.adb.count("-s") >= firstCycleDumps + 1, "the interval keeps polling");
  await h.collector.setEnabled(false);
});

test("does nothing at all while disabled", async () => {
  const h = harness();
  await h.collector.pollNow();
  assert.deepEqual(h.adb.calls, []);
  assert.equal(h.collector.deviceState("dev-1"), null);
  assert.deepEqual(h.collector.monitoringState(), { enabled: false, availability: "disabled" });
});

test("reports no_devices when monitoring is on but no headset is connected", async () => {
  const h = harness({ targets: () => [] });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.deepEqual(h.collector.monitoringState(), { enabled: true, availability: "no_devices" });
  await h.collector.setEnabled(false);
});

test("a headset without a wireless address is reported without any adb device work", async () => {
  const h = harness({ targets: () => [{ deviceId: "dev-1", address: null }] });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.equal(h.adb.count("connect"), 0);
  assert.deepEqual(h.collector.deviceState("dev-1"), {
    left: null,
    right: null,
    observedAt: null,
    status: "unavailable",
    reason: "no_wireless_address",
  });
  await h.collector.setEnabled(false);
});

test("a headset that is no longer connected reports headset_offline", async () => {
  const connected = new Set(["dev-1"]);
  const h = harness({
    targets: () => (connected.has("dev-1") ? [{ deviceId: "dev-1", address: "192.168.1.109" }] : []),
  });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.equal(h.collector.deviceState("dev-1")?.status, "available");
  connected.delete("dev-1");
  assert.equal(h.collector.deviceState("dev-1")?.reason, "headset_offline");
  assert.equal(h.collector.deviceState("dev-1")?.status, "unavailable");
  await h.collector.setEnabled(false);
});

test("missing adb reports adb_unavailable and recovers without toggling", async () => {
  const h = harness();
  h.adb.versionOk = false;
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.deepEqual(h.collector.monitoringState(), { enabled: true, availability: "adb_unavailable" });
  assert.equal(h.adb.count("connect"), 0, "no device work while adb is missing");

  h.adb.versionOk = true;
  await h.collector.pollNow();
  assert.equal(h.collector.monitoringState().availability, "ready");
  assert.equal(h.collector.deviceState("dev-1")?.status, "available");
  await h.collector.setEnabled(false);
});

test("connect, dump, and parse failures become bounded reasons", async () => {
  const cases: Array<[string, (adb: FakeAdb) => void, string]> = [
    ["connect failed", (adb) => { adb.connectThrows = true; }, "adb_connect_failed"],
    ["connect refused in output", (adb) => { adb.connectImpl = () => "failed to connect to 192.168.1.109:5555"; }, "adb_connect_failed"],
    ["dump failed", (adb) => { adb.dumpThrows = true; }, "dump_failed"],
    ["parse failed", (adb) => { adb.dumpImpl = () => "ControllerGlue Status\n"; }, "parse_failed"],
  ];
  for (const [name, breakIt, reason] of cases) {
    const h = harness();
    await h.collector.setEnabled(true);
    breakIt(h.adb);
    await h.collector.pollNow();
    const state = h.collector.deviceState("dev-1");
    assert.equal(state?.status, "unavailable", name);
    assert.equal(state?.reason, reason, name);
    assert.equal(state?.observedAt, null, name);
    // Public state must never carry ADB output, endpoints, or serial numbers.
    const wire = JSON.stringify(state);
    assert.ok(!wire.includes("192.168.1.109"), `${name}: endpoint leaked`);
    assert.ok(!wire.includes("c064a7beb7813010"), `${name}: serial leaked`);
    assert.ok(!wire.includes("offline"), `${name}: raw stderr leaked`);
    await h.collector.setEnabled(false);
  }
});

test("a successful poll replaces the reading and a later failure keeps it as stale", async () => {
  const h = harness();
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  const first = h.collector.deviceState("dev-1");
  assert.deepEqual(first, {
    left: { level: 100, state: "inactive" },
    right: { level: 80, state: "inactive" },
    observedAt: "2026-10-09T12:00:00.000Z",
    status: "available",
    reason: null,
  });

  h.advance(60_000);
  h.adb.dumpImpl = () => `${LEFT_LINE.replace("Battery: 100%", "Battery: 90%").replace("Status: Disabled", "Status: Active")}\n${RIGHT_LINE}\n`;
  await h.collector.pollNow();
  const second = h.collector.deviceState("dev-1");
  assert.deepEqual(second?.left, { level: 90, state: "active" });
  assert.equal(second?.observedAt, "2026-10-09T12:01:00.000Z");

  h.adb.dumpThrows = true;
  await h.collector.pollNow();
  const stale = h.collector.deviceState("dev-1");
  assert.equal(stale?.status, "stale");
  assert.equal(stale?.reason, "dump_failed");
  assert.deepEqual(stale?.left, { level: 90, state: "active" }, "stale keeps the last known values");
  assert.equal(stale?.observedAt, "2026-10-09T12:01:00.000Z", "stale keeps the old observation time");

  // Retry recovery: the next good cycle is available again.
  h.adb.dumpThrows = false;
  await h.collector.pollNow();
  assert.equal(h.collector.deviceState("dev-1")?.status, "available");
  await h.collector.setEnabled(false);
});

test("already-connected endpoints are not owned, newly connected ones are disconnected on disable", async () => {
  const already = harness();
  already.adb.connectImpl = (endpoint) => `already connected to ${endpoint}`;
  await already.collector.setEnabled(true);
  await already.collector.pollNow();
  assert.equal(already.collector.deviceState("dev-1")?.status, "available", "an already-connected endpoint is still readable");
  await already.collector.setEnabled(false);
  assert.equal(already.adb.count("disconnect"), 0, "another tool's session must survive");

  const fresh = harness();
  await fresh.collector.setEnabled(true);
  await fresh.collector.pollNow();
  await fresh.collector.setEnabled(false);
  assert.deepEqual(
    fresh.adb.calls.filter((call) => call[1] === "disconnect").map((call) => call[2]),
    ["192.168.1.109:5555"]
  );
});

test("cycles never overlap and each device runs one adb operation at a time", async () => {
  const h = harness();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();

  h.adb.gate = gate;
  const first = h.collector.pollNow();
  const second = h.collector.pollNow();
  release();
  await Promise.all([first, second]);
  h.adb.gate = null;
  assert.equal(h.adb.maxConcurrentDumps, 1);
  await h.collector.setEnabled(false);
});

test("enable and disable are idempotent", async () => {
  const h = harness({ pollIntervalMs: 20 });
  await h.collector.setEnabled(true);
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  await wait(60);
  const dumpsPerCycle = 1;
  const cycles = h.adb.count("-s");
  assert.ok(cycles >= 2 && cycles <= 6, `one timer, not two (saw ${cycles} dumps, ${dumpsPerCycle} per cycle)`);

  h.adb.calls.length = 0;
  await h.collector.setEnabled(false);
  await h.collector.setEnabled(false);
  assert.equal(h.adb.count("disconnect"), 1);
  assert.deepEqual(h.collector.deviceState("dev-1"), null);
});

test("stopping during a poll publishes nothing afterwards", async () => {
  const h = harness();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await h.collector.setEnabled(true);
  h.adb.gate = gate;
  const pending = h.collector.pollNow();
  const before = h.changes.count;
  await h.collector.stop();
  release();
  await pending;

  assert.deepEqual(h.collector.monitoringState(), { enabled: false, availability: "disabled" });
  assert.equal(h.collector.deviceState("dev-1"), null);
  assert.equal(h.changes.count, before, "no dashboard push after stop");
});
