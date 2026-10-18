# Optional Touch-Controller Battery Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add globally switchable, best-effort left/right Touch-controller battery readings without making ADB a dependency of normal CafeQuest operation.

**Architecture:** A server-owned collector polls already-enabled wireless ADB endpoints by the IP of each live agent WebSocket, parses `OVRRemoteService`, and adds ephemeral controller readings to dashboard snapshots. SQLite stores only the global enabled flag; the Android agent and shared agent protocol remain unchanged.

**Tech Stack:** Node 22, TypeScript, Fastify, better-sqlite3, `node:child_process.execFile`, React 18, Vitest/Testing Library, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-09-controller-battery-monitoring-design.md`

## Global Constraints

- Monitoring defaults off and must never affect headset liveness, headset battery telemetry, sessions, or launch commands.
- Use no new npm dependency or companion process; use `ADB_PATH` or `adb` from `PATH` through `execFile`, never a shell string.
- Poll immediately after enable and every 60,000 ms thereafter; cycles must not overlap and each device gets at most one active ADB operation.
- Persist only the global flag; readings, failure state, remote IPs, and collector-owned connection state stay in memory.
- Turning the toggle off stops CafeQuest polling and disconnects only endpoints CafeQuest newly connected; it does not disable Horizon OS Wireless Debugging.
- Public responses expose stable reason codes only—never ADB stderr, controller serials, or raw diagnostics.
- All new dashboard copy must have typed English and Turkish entries and accessible switch/badge semantics.
- Preserve unrelated dirty screen-casting documents. Do not commit, push, install, or alter headset ADB state without explicit approval.

## Review Focus

- A malformed or hostile WebSocket remote address must never reach `execFile`; Task 1 pins normalization and Task 2 pins hub integration.
- `adb connect` returning `already connected` must not make CafeQuest disconnect another tool's session; Task 1 tests connection ownership.
- Changed, partial, duplicate, or out-of-range diagnostics must become `parse_failed` while retaining only a prior timestamped reading as stale; Task 1 tests all cases.
- Rapid toggle requests, shutdown during a poll, and a poll slower than 60 seconds must not overlap, leak timers, or publish after stop; Tasks 1 and 2 test lifecycle races.
- Missing ADB and per-device failures must leave online state, sessions, launches, and headset battery untouched; Task 2 exercises those paths through the real app boundary.

---

### Task 1: ADB reader and collector

**Files:**
- Create: `server/src/controller-battery.ts`
- Create: `server/tests/controller-battery.test.ts`

**Interfaces:**
- Produces `type ControllerBatterySide = { level: number; state: "active" | "inactive" }`.
- Produces `type DeviceControllerBattery = { left: ControllerBatterySide | null; right: ControllerBatterySide | null; observedAt: string | null; status: "available" | "stale" | "unavailable"; reason: null | "headset_offline" | "no_wireless_address" | "adb_connect_failed" | "dump_failed" | "parse_failed" }`.
- Produces `type ControllerBatteryMonitoringState = { enabled: boolean; availability: "disabled" | "ready" | "adb_unavailable" | "no_devices" }` and `type CollectorTarget = { deviceId: string; address: string | null }`.
- Produces `type AdbRunner = (executable: string, args: readonly string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>`.
- Produces `defaultAdbRunner`, `normalizeRemoteIpv4(address: string | undefined): string | null`, and `parseControllerBatteryDump(raw: string): { left: ControllerBatterySide; right: ControllerBatterySide } | null`.
- Produces `interface ControllerBatteryView { monitoringState(): ControllerBatteryMonitoringState; deviceState(deviceId: string): DeviceControllerBattery | null }`; `ControllerBatteryCollector` implements it.
- `ControllerBatteryCollector` constructor accepts `{ adbPath: string; runner: AdbRunner; targets: () => readonly CollectorTarget[]; now: () => Date; pollIntervalMs: number; onChange: () => void }`; public methods are `setEnabled(enabled: boolean): Promise<void>`, `pollNow(): Promise<void>`, and `stop(): Promise<void>`.

- [ ] **Step 1: Write failing parser and address tests**

Add tests named `parses left and right summaries`, `rejects incomplete duplicate malformed and out-of-range summaries`, and `accepts only direct non-loopback IPv4 addresses`. Assert the observed Quest fixture parses to left `100/inactive` and right `80/inactive`; reversed order also parses; `::ffff:192.168.1.20` normalizes; shell metacharacters, loopback, malformed input, and native IPv6 return null.

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/controller-battery.test.js`

Expected: FAIL because `server/src/controller-battery.ts` does not exist.

- [ ] **Step 3: Implement the parser, public types, address normalization, and bounded `execFile` runner**

Use a 0–100 integer guard, require exactly one Left and one Right summary, map only case-insensitive `Active` to `active`, and map all other controller statuses to `inactive`. Cap stdout/stderr and terminate timed-out children; reject with typed internal errors that are never serialized directly.

- [ ] **Step 4: Add failing collector lifecycle tests**

With a fake runner and clock, pin: immediate plus 60-second polling; no overlapping `pollNow`; one operation per target; `ADB_PATH` argv rather than a shell string; missing ADB → global `adb_unavailable`; no targets → `no_devices`; connect/dump/parse reason codes; stale retention after a prior success; retry recovery; `already connected` not owned; newly connected endpoint owned and disconnected on disable; repeated enable/disable idempotence; stop during a poll publishes nothing afterward.

- [ ] **Step 5: Implement `ControllerBatteryCollector` minimally to pass the lifecycle tests**

Use one timer, one in-flight cycle promise, a `Map<deviceId, DeviceControllerBattery>`, and a `Set<endpoint>` containing only endpoints whose first connect result says newly connected. Enabling awaits a bounded `adb version` capability check, schedules the first device poll without blocking the HTTP request on all devices, and starts the interval; disabling awaits owned-endpoint cleanup. `deviceState` returns immutable public data; failed reads preserve the old `observedAt` and values with `status: "stale"`, or return empty `unavailable` state when no success exists.

- [ ] **Step 6: Run focused verification**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/controller-battery.test.js`

Expected: all controller-battery parser and collector tests PASS.

- [ ] **Step 7: Review checkpoint**

Inspect `git diff --check` and the Task 1 diff. If the user explicitly approves commits, commit only these two files with `feat(server): collect controller battery over adb`.

---

### Task 2: Persisted setting, server lifecycle, API, and snapshots

**Files:**
- Modify: `server/src/db.ts:14-99`
- Modify: `server/src/store.ts`
- Modify: `server/src/types.ts`
- Modify: `server/src/hub.ts:28-347`
- Modify: `server/src/app.ts:26-393`
- Modify: `server/src/index.ts`
- Modify: `.env.example`
- Modify: `server/tests/store.test.ts`
- Modify: `server/tests/security.test.ts`
- Modify: `server/tests/ownership.test.ts`
- Create: `server/tests/controller-battery-api.test.ts`

**Interfaces:**
- Consumes all Task 1 types and `ControllerBatteryView`.
- Produces `getControllerBatteryMonitoringEnabled(db): boolean` and `setControllerBatteryMonitoringEnabled(db, enabled): void` in `store.ts`.
- Extends `Hub.addAgentSocket(deviceId, socket, capabilities, remoteAddress?)` and produces `Hub.controllerBatteryTargets(): readonly CollectorTarget[]`.
- Extends `AppConfig` with `controllerBattery?: { adbPath?: string; runner?: AdbRunner; now?: () => Date; pollIntervalMs?: number }` and returns `controllerBatteryCollector` from `buildApp` for deterministic tests.
- Produces `PUT /api/settings/controller-battery-monitoring` with strict `{ enabled: boolean }` input.

- [ ] **Step 1: Write failing setting-store tests**

Assert a fresh/in-memory DB reads false, true and false round-trip through `app_settings`, and an invalid stored value reads false.

- [ ] **Step 2: Add `app_settings` and the two focused store functions**

Create the table idempotently in `openDb`; keep all SQL in `store.ts` and store literal `true`/`false` strings under `controller_battery_monitoring`.

- [ ] **Step 3: Write failing hub snapshot and remote-address tests**

Assert newest socket wins with its newest normalized IP, malformed/loopback addresses never become collector targets, monitoring off produces `controllerBattery: null`, and monitoring on produces the exact available/stale/unavailable device shape plus global `disabled|ready|adb_unavailable|no_devices` state. Pin `headset_offline` when no live agent exists.

- [ ] **Step 4: Wire the collector view into `Hub` without changing existing device semantics**

Extend only the in-memory `DeviceConn`; add the top-level monitoring state and per-device controller state in `snapshot()`. Keep `online`, `batteryLevel`, sessions, commands, and installed apps sourced exactly as before.

- [ ] **Step 5: Write failing API/lifecycle tests**

Using an injected fake runner, assert: the admin route rejects missing/wrong auth; non-boolean and extra-key bodies return 400; repeated PUT is idempotent; enabled persists across app restart; `/api/devices` returns the full snapshot including monitoring state; close awaits collector cleanup; missing ADB returns 200 with enabled intent plus `adb_unavailable`; a collector failure leaves a pre-existing active session, launch route, headset battery, and online status working.

- [ ] **Step 6: Wire `buildApp`, the authenticated PUT route, startup restore, and close order**

Capture `req.socket.remoteAddress` only after a valid hello. Construct the collector with callbacks into the assigned hub, restore the persisted flag after both exist, change `GET /api/devices` to return the entire hub snapshot, persist before applying a toggle, and close in the order collector → hub → discovery → DB. Read `ADB_PATH` with fallback `adb`; add the commented optional variable to `.env.example`.

- [ ] **Step 7: Run server verification**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/controller-battery.test.js server/dist/tests/controller-battery-api.test.js server/dist/tests/store.test.js server/dist/tests/security.test.js server/dist/tests/ownership.test.js`

Expected: all focused server tests PASS; no real `adb` process is started by tests.

- [ ] **Step 8: Review checkpoint**

Run `git diff --check`; inspect only Task 2 files. If commits are explicitly approved, commit with `feat(server): expose optional controller batteries`.

---

### Task 3: Global dashboard toggle and per-card L/R readings

**Files:**
- Modify: `dashboard/src/types.ts`
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/api.test.ts`
- Create: `dashboard/src/components/ControllerBatteryToggle.tsx`
- Create: `dashboard/src/components/ControllerBatteryToggle.test.tsx`
- Modify: `dashboard/src/components/DeviceCard.tsx:122-285`
- Modify: `dashboard/src/components/DeviceCard.test.tsx`
- Modify: `dashboard/src/App.tsx:1-340`
- Modify: `dashboard/src/App.test.tsx`
- Modify: `dashboard/src/messages.tsx`
- Modify: `dashboard/src/styles.css:57-205`

**Interfaces:**
- Consumes the Task 2 snapshot and reason-code contract.
- Produces `setControllerBatteryMonitoring(key, enabled): Promise<ControllerBatteryMonitoringState>` in `api.ts`.
- Produces `ControllerBatteryToggle` props `{ state: ControllerBatteryMonitoringState; pending: boolean; error: string | null; onChange: (enabled: boolean) => void }` and keeps DeviceCard's existing action interface unchanged.

- [ ] **Step 1: Write failing API and switch-component tests**

Assert the client sends `PUT /api/settings/controller-battery-monitoring`, Bearer auth, JSON content type, and `{ enabled }`. Assert the component exposes `role="switch"`, correct `aria-checked`, EN/TR accessible names/help, a pending disabled state, and translated `adb_unavailable` without raw server detail.

- [ ] **Step 2: Implement the typed API contract and `ControllerBatteryToggle`**

Use server-confirmed state as the switch position. The component emits only the requested boolean; `App` owns pending/error and restores the prior state on failure.

- [ ] **Step 3: Write failing DeviceCard controller-reading tests**

Pin these cases in both languages: monitoring off omits L/R; active readings show `L 100%` and `R 80%`; inactive readings retain percentages with accessible `last known`; stale includes `Updated … ago`; unavailable reasons render translated `—`; the existing headset `82%`, session buttons, and launch button remain unchanged and enabled.

- [ ] **Step 4: Add the compact controller badges beside the existing `Battery` fact**

Keep the headset `Battery` component intact. Render L/R only from `device.controllerBattery`; use text/ARIA plus subdued styling for inactive/stale states so color is never the sole cue.

- [ ] **Step 5: Write failing App integration tests for toggle success and failure**

Extend the snapshot stubs with `controllerBatteryMonitoring`. Assert the top-bar switch reflects initial REST and live WebSocket snapshots, one click sends one PUT, rapid second clicks are blocked while pending, success waits for server confirmation, 401 opens the existing key prompt, and other errors show a global translated alert without disabling cards.

- [ ] **Step 6: Wire App state, live snapshots, responsive header layout, and translations**

Add the switch near the live indicator, maintain the existing language control and mobile layout, and update typed EN/TR messages. The toggle's help must state that Off stops CafeQuest monitoring but does not disable headset Wireless Debugging.

- [ ] **Step 7: Run dashboard verification**

Run: `npm test -w dashboard -- src/api.test.ts src/components/ControllerBatteryToggle.test.tsx src/components/DeviceCard.test.tsx src/App.test.tsx && npm run build -w dashboard`

Expected: focused tests PASS and Vite production build succeeds.

- [ ] **Step 8: Review checkpoint**

Run `git diff --check`; visually inspect the responsive top bar and card hierarchy if a dev server is already available. If commits are explicitly approved, commit with `feat(dashboard): show optional controller batteries`.

---

### Task 4: Operator documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/quest-setup.md`
- Modify: `docs/known-limitations.md`
- Modify: `docs/morning-test.md`
- Modify: `docs/poc-test-results.md`

**Interfaces:**
- Consumes the completed server/dashboard behavior.
- Produces the optional wireless-ADB setup, safety boundary, troubleshooting, and physical acceptance procedure; no product interface.

- [ ] **Step 1: Document optional setup and truthful limitations**

Add the USB authorization → `adb tcpip 5555` → unplug → `adb connect <ip>:5555` flow, firewall restriction to the café PC, `ADB_PATH`, reboot/IP/OS failure modes, last-known semantics for sleeping controllers, and the fact that the global toggle does not disable Wireless Debugging. Keep normal CafeQuest setup independent of these steps.

- [ ] **Step 2: Add physical acceptance rows before claiming hardware success**

Rows must compare L/R UI values to `dumpsys OVRRemoteService`, wake/sleep each controller, disconnect ADB during an active session, launch with ADB absent, toggle off, and restart the server. Leave them `NOT TESTED` until actually observed.

- [ ] **Step 3: Run complete automated verification**

Run: `npm run build && npm test && npx tsc -p tsconfig.json && git diff --check`

Expected: all workspaces build, all tests pass, root typecheck passes, and diff check is silent.

- [ ] **Step 4: Perform the physical Quest check only with explicit approval**

Use the connected café-owned Quest 3. Record headset OS, controller values/states, commands, times, and results. Do not enable TCP ADB, install software, alter firewall rules, or claim other headsets/models verified without direct evidence.

- [ ] **Step 5: Final scope audit and review checkpoint**

Confirm the Android agent/shared protocol are unchanged; search for raw ADB output/serial leakage; verify monitoring-off snapshots and all existing controls; report automated proof separately from physical proof. If a final commit is explicitly approved, stage only this feature's files and use `docs: explain optional controller battery monitoring` or squash under an approved feature commit.
