# Server Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quest headsets find the CafeQuest server on the café Wi-Fi by themselves (and follow it when the PC's IP changes), with a Manual mode for typing an IP, and with the enrollment key and the baked-in server address removed.

**Architecture:** The headset broadcasts a tiny JSON probe to UDP 3000; a new `dgram` responder in the server answers the sender with its hostname and live HTTP port, and the headset dials the reply's source address. On the agent, pure Kotlin rules (`chooseServer`, `shouldSearch`, `mergeSetup`, `ServerLocator`) decide when to search and which answer to trust, a `ServerDiscovery` class does the UDP I/O, and the setup screen gains an `Auto | Manual` switch plus **Find server**. The enrollment key and `CAFE_PC_LAN_HOST` disappear from every layer.

**Tech Stack:** Node 22 ESM + TypeScript strict, Zod, Fastify 4, `node:dgram`, `node:test`; Kotlin 2.0 / Android (minSdk 29), kotlinx.serialization, OkHttp, Jetpack Compose, DataStore, JUnit4.

**Spec:** `docs/superpowers/specs/2026-10-09-server-discovery-design.md`

## Global Constraints

- No new npm or Gradle dependencies. Node uses `node:dgram`/`node:os`; Kotlin uses `java.net`.
- Discovery port: UDP `3000`, a constant in `shared/src/discovery.ts` and `Discovery.kt`, independent of `PORT`.
- Datagrams: at most `512` bytes. Probe is exactly `{"type":"cafequest_discover"}`. Reply is `{"type":"cafequest_server","name":<1–64 chars>,"port":<int 1–65535>}`.
- The server answers only valid probes, sends the reply straight back to the probe's source, never announces itself, and binds the same `host` as HTTP (`0.0.0.0` in production).
- Reply `name` = hostname with a trailing `.local` removed, capped at 64 characters, falling back to `CafeQuest`. Reply `port` = the live HTTP port.
- Agent search: 3 probes 400 ms apart to `255.255.255.255` plus the Wi-Fi subnet broadcast; listen until 1.5 s after the first send; dedupe by `host:port`; keep arrival order; never throw.
- When to search: Auto mode only, when the saved host is blank or after `3` failed connects in a row. Manual never searches. A search result never overwrites a Manual setup.
- Choosing: the remembered PC name only; with no remembered name, the first answer.
- OkHttp `connectTimeout(3, SECONDS)`.
- Agent version `0.3.0`, versionCode `3`.
- Every new UI string goes into `AgentStrings` in English and Turkish. Turkish never suffixes a name, address or number ("UDP 3000 portu", not "UDP 3000'e").
- `ADMIN_API_KEY` behavior is unchanged. Request logging stays disabled.
- Backend tests: `node:test` + `node:assert/strict`. Agent tests: JUnit4 on the JVM. Code exercised by JVM tests must not call `android.*` (including `android.util.Log`): the unit-test android.jar throws "not mocked".
- Gradle needs JDK 21: prefix with `JAVA_HOME=$(/usr/libexec/java_home -v 21)`.
- `@cafequest/shared` resolves to `shared/dist`: rebuild `shared` before building or testing `server` or `quest-simulator`.
- `docs/decisions.md` is append-only.

## Review Focus

1. **A second CafeQuest server on the café Wi-Fi** (Turan's laptop running `npm run dev`) while the café PC is down: a headset that remembers the café PC must stay put and keep retrying, never move to the laptop. Pinned in Task 7 (`another server never takes over a headset that remembers the cafe PC`) and Task 4 (`a remembered PC is the only one accepted`).
2. **Staff switch a headset to Manual while its Auto search is in flight**: the result must neither overwrite the typed IP nor be dialed. Pinned in Task 6 (`a search result never overwrites a manual address`) and Task 7 (`a result that could not be saved is not dialed`).
3. **A headset upgraded from agent 0.2.0** (saved host, no mode or name, an orphaned `enrollment_key` preference): it reads as Auto, dials its saved host first without searching, and searches only after 3 failures. Pinned in Task 6 (`a headset upgraded from the old agent keeps its saved address and reads as auto`) and Task 7 (`a saved address is dialed without searching until three connects fail`).
4. **A probe before the server listens, or junk/oversize datagrams from other LAN software on UDP 3000**: silence, never a crash or a reply without a port. Pinned in Task 3 (`junk and oversize datagrams get no answer`, `before the server listens ... no answer`).
5. **A 0.2.0 APK still sending `enrollmentKey` during the rollout**: accepted and registered. Pinned in Task 2 (shared `a hello from a 0.2.0 agent still carrying enrollmentKey parses without it`, server `agents need no key; a leftover enrollmentKey from a 0.2.0 APK is ignored`).

## File Structure

| File | Responsibility |
|---|---|
| `shared/src/discovery.ts` (new) | Port, size cap, Zod schemas, never-throwing parsers for probe/reply |
| `shared/src/protocol.ts` | Hello without `enrollmentKey`; error codes without `ENROLLMENT_REJECTED` |
| `server/src/discovery.ts` (new) | `serverDisplayName`, `startDiscoveryResponder` (dgram) |
| `server/src/app.ts` | `discoveryPort` option, responder lifecycle, no enrollment check |
| `server/src/auth.ts` | Admin key only |
| `server/src/index.ts` | Passes `DISCOVERY_PORT`, no enrollment env |
| `quest-simulator/src/cli.ts`, `deviceSim.ts` | No `--enrollment-key` |
| `quest-agent/.../Discovery.kt` (new) | Agent mirror of the messages, pure choose/when/broadcast rules, `ServerDiscovery` UDP search, `wifiBroadcastTargets` |
| `quest-agent/.../ServerLocator.kt` (new) | Pure-ish "where do I dial next" state machine used by the connection loop |
| `quest-agent/.../SetupValues.kt` | `ServerMode`, stored/input shapes, `resolveIdentity`, `mergeSetup`, `withDiscovered` |
| `quest-agent/.../Identity.kt` | `AgentIdentity` with mode + remembered name; DataStore persistence, `saveDiscovered` |
| `quest-agent/.../AgentDiagnostics.kt` | `ServerTarget` + the server the agent dials, for the screen |
| `quest-agent/.../AgentConnection.kt` | `SEARCHING` state, locator-driven loop, 3 s connect timeout, hello without key |
| `quest-agent/.../HeadsetStatus.kt` | `SEARCHING` link status, `serverSummary` line |
| `quest-agent/.../AgentStrings.kt` | New EN/TR words; key label gone |
| `quest-agent/.../MainActivity.kt` | `TwoWaySwitch`, Auto/Manual setup, Find server, server line |
| `quest-agent/app/build.gradle.kts` | Only Meta App ID baked; version 0.3.0 |
| Docs, `.env`, `.env.example` | Match the new behavior |

## Baseline

At commit `f89bcb7` everything passes: shared 17, server 67, simulator 11, dashboard 121, agent JVM 54.

---

### Task 1: Shared discovery messages

**Files:**
- Create: `shared/src/discovery.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/tests/discovery.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `@cafequest/shared`): `DISCOVERY_PORT = 3000`, `MAX_DISCOVERY_BYTES = 512`, `DiscoveryProbeSchema`, `DiscoveryReplySchema`, `type DiscoveryProbe = { type: "cafequest_discover" }`, `type DiscoveryReply = { type: "cafequest_server"; name: string; port: number }`, `parseDiscoveryProbe(raw: string): DiscoveryProbe | null`, `parseDiscoveryReply(raw: string): DiscoveryReply | null`.

- [ ] **Step 1: Write the failing test**

Create `shared/tests/discovery.test.ts`:

```ts
// LAN discovery messages (docs/superpowers/specs/2026-10-09-server-discovery-design.md §1).
// The agent's Discovery.kt mirrors these by hand: keep the shapes, port and cap in sync.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCOVERY_PORT, MAX_DISCOVERY_BYTES, parseDiscoveryProbe, parseDiscoveryReply } from "../src/discovery.js";

test("discovery uses UDP 3000 and datagrams of at most 512 bytes", () => {
  assert.equal(DISCOVERY_PORT, 3000);
  assert.equal(MAX_DISCOVERY_BYTES, 512);
});

test("a probe parses; anything else is null, never a throw", () => {
  assert.deepEqual(parseDiscoveryProbe('{"type":"cafequest_discover"}'), { type: "cafequest_discover" });
  const notProbes = ["", "hello", "null", "[]", "42", '{"type":"discover"}', '{"type":"cafequest_server","name":"PC","port":3000}'];
  for (const raw of notProbes) assert.equal(parseDiscoveryProbe(raw), null, raw);
});

test("a reply carries a 1-64 character name and a port from 1 to 65535", () => {
  assert.deepEqual(
    parseDiscoveryReply('{"type":"cafequest_server","name":"CAFE-PC","port":3000}'),
    { type: "cafequest_server", name: "CAFE-PC", port: 3000 },
  );
  assert.equal(parseDiscoveryReply(JSON.stringify({ type: "cafequest_server", name: "x".repeat(64), port: 65535 }))?.port, 65535);
  const notReplies = [
    { type: "cafequest_server", name: "", port: 3000 },
    { type: "cafequest_server", name: "x".repeat(65), port: 3000 },
    { type: "cafequest_server", name: "PC", port: 0 },
    { type: "cafequest_server", name: "PC", port: 65536 },
    { type: "cafequest_server", name: "PC", port: 3000.5 },
    { type: "cafequest_server", name: "PC" },
    { type: "cafequest_discover" },
  ];
  for (const reply of notReplies) assert.equal(parseDiscoveryReply(JSON.stringify(reply)), null, JSON.stringify(reply));
  assert.equal(parseDiscoveryReply("not json"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w shared`
Expected: FAIL with `error TS2307: Cannot find module '../src/discovery.js'`.

- [ ] **Step 3: Write the implementation**

Create `shared/src/discovery.ts`:

```ts
import { z } from "zod";

/*
 * LAN discovery (docs/superpowers/specs/2026-10-09-server-discovery-design.md).
 * A headset broadcasts a probe to DISCOVERY_PORT; the server answers the sender
 * directly with its name and live HTTP port, and the headset dials the reply's
 * source address. Mirrored by hand in quest-agent/.../Discovery.kt.
 */

/** Fixed in both code bases and independent of PORT: the APK cannot learn it. */
export const DISCOVERY_PORT = 3000;

/** Largest datagram either side sends or reads. */
export const MAX_DISCOVERY_BYTES = 512;

export const DiscoveryProbeSchema = z.object({
  type: z.literal("cafequest_discover"),
});

export const DiscoveryReplySchema = z.object({
  type: z.literal("cafequest_server"),
  /** The PC's hostname without ".local"; headsets show it and stay with it. */
  name: z.string().min(1).max(64),
  /** The HTTP/WebSocket port the server is listening on. */
  port: z.number().int().min(1).max(65535),
});

export type DiscoveryProbe = z.infer<typeof DiscoveryProbeSchema>;
export type DiscoveryReply = z.infer<typeof DiscoveryReplySchema>;

function parseWith<S extends z.ZodTypeAny>(schema: S, raw: string): z.infer<S> | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

/** An untrusted datagram as a probe, or null. Never throws. */
export function parseDiscoveryProbe(raw: string): DiscoveryProbe | null {
  return parseWith(DiscoveryProbeSchema, raw);
}

/** An untrusted datagram as a reply, or null. Never throws. */
export function parseDiscoveryReply(raw: string): DiscoveryReply | null {
  return parseWith(DiscoveryReplySchema, raw);
}
```

Replace the whole of `shared/src/index.ts` with:

```ts
export * from "./protocol.js";
export * from "./parse.js";
export * from "./discovery.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build -w shared && node --test shared/dist/tests/discovery.test.js`
Expected: PASS, `# tests 3`, `# pass 3`.

Run: `npm test -w shared`
Expected: PASS, `# tests 20`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add shared/src/discovery.ts shared/src/index.ts shared/tests/discovery.test.ts
git commit -F - <<'EOF'
feat(shared): discovery probe and reply messages

UDP 3000, at most 512 bytes: a headset broadcasts {"type":"cafequest_discover"}
and the server answers with {"type":"cafequest_server", name, port}. Parsers
never throw; the agent's Discovery.kt mirrors the shapes by hand.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Remove the enrollment key (shared, server, simulator, `.env`)

**Files:**
- Modify: `server/tests/security.test.ts` (rewrite)
- Modify: `server/src/auth.ts` (rewrite), `server/src/app.ts`, `server/src/index.ts`
- Modify: `shared/tests/protocol.test.ts`, `shared/src/protocol.ts`
- Modify: `quest-simulator/src/cli.ts`, `quest-simulator/src/deviceSim.ts`
- Modify: `.env`, `.env.example`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `HelloSchema` without `enrollmentKey` (Zod strips the unknown key); `ServerErrorSchema.code` without `"ENROLLMENT_REJECTED"`; `type AuthConfig = { adminApiKey?: string }`; `AppConfig` without `deviceEnrollmentKey`; `DeviceSimOptions` without `enrollmentKey`.

Order matters: the server stops using the key before `shared` drops the field, otherwise `server` stops compiling halfway.

- [ ] **Step 1: Rewrite the server security test for the keyless contract**

Replace the whole of `server/tests/security.test.ts` with:

```ts
// Auth contract (P0-A/C, brief §35): ADMIN_API_KEY guards dashboard REST+WS and
// never hits logs. Agents need no key: the enrollment key was removed on
// 2026-10-09 (LAN-only café, docs/decisions.md "No enrollment key").
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";

const ADMIN = "test-admin-key-123";

function streamLogger() {
  let text = "";
  const stream = { write: (s: string) => { text += s; } };
  return { stream, text: () => text };
}

// --- locked-down server -------------------------------------------------------
const logs = streamLogger();
const locked = await buildApp({
  dbPath: ":memory:", port: 0, host: "127.0.0.1",
  adminApiKey: ADMIN, logger: { level: "info", stream: logs.stream as any },
});
await locked.app.listen({ port: 0, host: "127.0.0.1" });
const laddr = locked.app.server.address();
const lport = typeof laddr === "object" && laddr ? laddr.port : 0;
const lbase = `http://127.0.0.1:${lport}`;
const lws = `ws://127.0.0.1:${lport}`;
after(() => locked.app.close());

const auth = { authorization: `Bearer ${ADMIN}` };

test("REST without/wrong admin key is 401; health stays open", async () => {
  const cases: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }];
  for (const headers of cases) {
    const r = await fetch(`${lbase}/api/devices`, { headers });
    assert.equal(r.status, 401);
    assert.equal((await r.json() as any).error, "unauthorized");
  }
  const ok = await fetch(`${lbase}/api/devices`, { headers: auth });
  assert.equal(ok.status, 200);
  const health = await fetch(`${lbase}/api/health`);
  assert.equal(health.status, 200);
});

test("dashboard WS without key is refused; with key connects and gets state", async () => {
  const bad = new WebSocket(`${lws}/dashboard-ws`);
  const badClose = new Promise<number>((r) => bad.on("close", (c) => r(Number(c))));
  assert.equal(await badClose, 4401);
  const good = new WebSocket(`${lws}/dashboard-ws?key=${ADMIN}`);
  const state: any = await new Promise((r, j) => {
    good.on("message", (m) => r(JSON.parse(String(m))));
    good.on("error", j);
  });
  assert.equal(state.type, "state");
  assert.ok(Array.isArray(state.payload.devices));
  good.close();
});

test("agents need no key; a leftover enrollmentKey from a 0.2.0 APK is ignored", async () => {
  for (const extra of [{}, { enrollmentKey: "left-over-from-0.2.0" }]) {
    const id = randomUUID();
    const agent = new WebSocket(`${lws}/agent-ws`);
    await new Promise<void>((r) => agent.on("open", () => r()));
    agent.send(JSON.stringify({ type: "hello", protocolVersion: 1, deviceId: id, deviceName: "Q", deviceModel: "M", agentVersion: "1", ...extra }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(agent.readyState, WebSocket.OPEN, JSON.stringify(extra));
    const dev = await (await fetch(`${lbase}/api/devices`, { headers: auth })).json() as any;
    assert.ok(dev.devices.some((d: any) => d.id === id), JSON.stringify(extra));
    agent.close();
  }
});

test("the server no longer mentions an enrollment key at boot", () => {
  assert.ok(!logs.text().includes("DEVICE_ENROLLMENT_KEY"), "boot log still mentions DEVICE_ENROLLMENT_KEY");
});

test("secrets never appear in server logs", async () => {
  // exercise authed REST + the dashboard websocket, then grep the captured log stream
  await fetch(`${lbase}/api/devices`, { headers: auth });
  const ws = new WebSocket(`${lws}/dashboard-ws?key=${ADMIN}`);
  await new Promise((r) => ws.on("message", () => r(null)));
  ws.close();
  assert.ok(!logs.text().includes(ADMIN), "admin key leaked into logs");
});

// --- open (unconfigured) server ----------------------------------------------
const open = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1" });
await open.app.listen({ port: 0, host: "127.0.0.1" });
const oaddr = open.app.server.address();
const oport = typeof oaddr === "object" && oaddr ? oaddr.port : 0;
after(() => open.app.close());

test("an unset admin key leaves the LAN-POC dashboard open (documented, warned)", async () => {
  const r = await fetch(`http://127.0.0.1:${oport}/api/devices`);
  assert.equal(r.status, 200);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/security.test.js`
Expected: FAIL. `✖ the server no longer mentions an enrollment key at boot` (the boot log still says `DEVICE_ENROLLMENT_KEY not set: agent enrollment is open`). The other 5 tests pass.

- [ ] **Step 3: Remove the key from the server**

Replace the whole of `server/src/auth.ts` with:

```ts
// Key checks for brief §35. The admin key comes from the environment; when it is
// unset the dashboard runs open on the LAN and the server warns at boot. Agents
// need no key (enrollment key removed 2026-10-09, docs/decisions.md).
export type AuthConfig = {
  adminApiKey?: string;
};

/** Empty/whitespace-only env values count as unset. */
export function normKey(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t ? t : undefined;
}

/** Dashboard REST (Authorization: Bearer) and dashboard WS (?key=). */
export function isAdminAuthorized(auth: AuthConfig, authorizationHeader: unknown): boolean {
  if (!auth.adminApiKey) return true;
  return authorizationHeader === `Bearer ${auth.adminApiKey}`;
}

export function isDashboardSocketAuthorized(auth: AuthConfig, keyParam: unknown): boolean {
  if (!auth.adminApiKey) return true;
  return keyParam === auth.adminApiKey;
}
```

In `server/src/app.ts` make these six edits:

1. Replace
   ```ts
   import { isAdminAuthorized, isDashboardSocketAuthorized, isEnrolled, type AuthConfig } from "./auth.js";
   ```
   with
   ```ts
   import { isAdminAuthorized, isDashboardSocketAuthorized, type AuthConfig } from "./auth.js";
   ```
2. Delete these two lines from `AppConfig`:
   ```ts
     /** When set, agent hello must carry DEVICE_ENROLLMENT_KEY; else open enrollment. */
     deviceEnrollmentKey?: string;
   ```
3. Replace
   ```ts
     const auth: AuthConfig = { adminApiKey: cfg.adminApiKey, deviceEnrollmentKey: cfg.deviceEnrollmentKey };
   ```
   with
   ```ts
     const auth: AuthConfig = { adminApiKey: cfg.adminApiKey };
   ```
4. Delete this block:
   ```ts
     if (!auth.deviceEnrollmentKey) {
       app.log.warn("DEVICE_ENROLLMENT_KEY not set: agent enrollment is open (LAN POC mode)");
     }
   ```
5. Delete this block from the `/agent-ws` hello handler:
   ```ts
           if (!isEnrolled(auth, hello.data.enrollmentKey)) {
             sendAgentError(socket, "ENROLLMENT_REJECTED", "invalid or missing enrollment key");
             socket.close(4401, "enrollment-rejected");
             app.log.warn("agent enrollment rejected");
             return;
           }
   ```
6. That block was the file's only `sendAgentError` call, so replace
   ```ts
   import { Hub, AGENT_WS_PATH, DASHBOARD_WS_PATH, sendAgentError } from "./hub.js";
   ```
   with
   ```ts
   import { Hub, AGENT_WS_PATH, DASHBOARD_WS_PATH } from "./hub.js";
   ```

In `server/src/index.ts`:

1. Delete the line
   ```ts
   const deviceEnrollmentKey = normKey(process.env.DEVICE_ENROLLMENT_KEY);
   ```
2. Replace
   ```ts
     dbPath, port, host, adminApiKey, deviceEnrollmentKey, games: config.games,
   ```
   with
   ```ts
     dbPath, port, host, adminApiKey, games: config.games,
   ```

- [ ] **Step 4: Run the server tests to verify they pass**

Run: `npm run build -w server && node --test server/dist/tests/security.test.js`
Expected: PASS, `# tests 6`, `# fail 0`.

- [ ] **Step 5: Update the shared protocol tests**

In `shared/tests/protocol.test.ts`, replace the test

```ts
test("hello accepts optional enrollmentKey", () => {
  assert.equal(HelloSchema.safeParse({ ...hello, enrollmentKey: "cafe-secret" }).success, true);
  assert.equal(HelloSchema.safeParse(hello).success, true);
  assert.equal(HelloSchema.safeParse({ ...hello, enrollmentKey: "" }).success, false);
});
```

with

```ts
test("a hello from a 0.2.0 agent still carrying enrollmentKey parses without it", () => {
  const parsed = HelloSchema.safeParse({ ...hello, enrollmentKey: "cafe-secret" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal("enrollmentKey" in parsed.data, false);
});
```

and replace the test

```ts
test("server error schema carries ownership/auth codes", () => {
  for (const code of ["ENROLLMENT_REJECTED", "DEVICE_MISMATCH", "UNKNOWN_COMMAND", "FOREIGN_COMMAND", "DUPLICATE_DEVICE"]) {
```

opening lines with

```ts
test("server error schema carries ownership codes, and no enrollment code", () => {
  assert.equal(
    ServerErrorSchema.safeParse({ type: "error", protocolVersion: 1, code: "ENROLLMENT_REJECTED", message: "x" }).success,
    false,
  );
  for (const code of ["DEVICE_MISMATCH", "UNKNOWN_COMMAND", "FOREIGN_COMMAND", "DUPLICATE_DEVICE"]) {
```

(the loop body and the closing `});` stay as they are).

- [ ] **Step 6: Run them to verify they fail**

Run: `npm run build -w shared && node --test shared/dist/tests/protocol.test.js`
Expected: FAIL in exactly the two edited tests (`enrollmentKey` is still kept, `ENROLLMENT_REJECTED` is still accepted).

- [ ] **Step 7: Remove the key from the protocol**

In `shared/src/protocol.ts`, delete these two lines from `HelloSchema`:

```ts
  // Presented at enrollment; required only when the server sets DEVICE_ENROLLMENT_KEY (§35).
  enrollmentKey: z.string().min(1).max(128).optional(),
```

and delete the line `    "ENROLLMENT_REJECTED",` from the `ServerErrorSchema` `code` enum.

- [ ] **Step 8: Run the shared tests to verify they pass**

Run: `npm run build -w shared && node --test shared/dist/tests/protocol.test.js`
Expected: PASS, `# tests 17`, `# fail 0`.

- [ ] **Step 9: Remove the key from the simulator**

In `quest-simulator/src/cli.ts`:

1. Replace the usage line `//        [--enrollment-key KEY] [--no-reconnect]` with `//        [--no-reconnect]`.
2. Delete the line
   ```ts
   const enrollmentKey = arg("enrollment-key", process.env.CAFEQUEST_ENROLLMENT_KEY ?? null) ?? undefined;
   ```
3. Delete the line `    enrollmentKey,` from the `new DeviceSim({ ... })` options.

In `quest-simulator/src/deviceSim.ts`:

1. Delete `  enrollmentKey?: string;` from `DeviceSimOptions`.
2. Delete this line from the hello in `ws.on("open", ...)`:
   ```ts
           ...(this.opts.enrollmentKey ? { enrollmentKey: this.opts.enrollmentKey } : {}),
   ```

- [ ] **Step 10: Remove the key from `.env` and `.env.example`**

Run (deletes the key line and rewords the header comment; the admin key value is untouched):

```bash
perl -pi -e '$_ = "" if /^DEVICE_ENROLLMENT_KEY=/; s/^# Unset keys = open LAN POC mode with a boot warning\.$/# Unset ADMIN_API_KEY = open dashboard (LAN POC mode) with a boot warning./' .env .env.example
grep -c -E "DEVICE_ENROLLMENT_KEY|Unset keys" .env .env.example
```

Expected: `.env:0` and `.env.example:0`.

- [ ] **Step 11: Run everything Node-side**

Run: `npm run build -w shared && npm run build -w server && npm run build -w quest-simulator && npx tsc -p tsconfig.json && npm test -w shared && npm test -w server && npm test -w quest-simulator`
Expected: no `tsc` output; shared `# tests 20`, `# fail 0`; server `# tests 68`, `# fail 0`; simulator `# tests 11`, `# fail 0`.

Run: `git grep -n -E "enrollmentKey|isEnrolled|ENROLLMENT_REJECTED|DEVICE_ENROLLMENT_KEY" -- shared server quest-simulator .env.example`
Expected: only `shared/tests/protocol.test.ts` and `server/tests/security.test.ts` (the tests that pin old-APK compatibility).

- [ ] **Step 12: Commit**

```bash
git add server/src/auth.ts server/src/app.ts server/src/index.ts server/tests/security.test.ts shared/src/protocol.ts shared/tests/protocol.test.ts quest-simulator/src/cli.ts quest-simulator/src/deviceSim.ts .env .env.example
git commit -F - <<'EOF'
refactor: drop the device enrollment key

CafeQuest only runs on the café LAN, so the shared DEVICE_ENROLLMENT_KEY
protected nothing real. Hello loses enrollmentKey (Zod strips it, so a 0.2.0
agent that still sends one is accepted), ENROLLMENT_REJECTED and the 4401
close go, and the simulator drops --enrollment-key. ADMIN_API_KEY is
unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Server discovery responder

**Files:**
- Create: `server/src/discovery.ts`
- Modify: `server/src/app.ts`, `server/src/index.ts`
- Test: `server/tests/discovery.test.ts`

**Interfaces:**
- Consumes (Task 1, from `@cafequest/shared`): `DISCOVERY_PORT`, `MAX_DISCOVERY_BYTES`, `parseDiscoveryProbe(raw: string): DiscoveryProbe | null`, `type DiscoveryReply`.
- Produces: `serverDisplayName(host?: string): string`; `type DiscoveryResponder = { port: number; close(): Promise<void> }`; `startDiscoveryResponder(opts: DiscoveryOptions): Promise<DiscoveryResponder | null>`; `AppConfig.discoveryPort?: number`; `buildApp()` now returns `{ app, db, hub, discovery }` with `discovery: DiscoveryResponder | null`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/discovery.test.ts`:

```ts
// Headsets find the café PC by broadcasting a UDP probe; the server answers the
// sender with its name and live HTTP port (spec 2026-10-09 §2). Real UDP on
// loopback, port 0, so nothing here needs the LAN or a firewall prompt.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createSocket } from "node:dgram";
import { buildApp } from "../src/app.js";
import { serverDisplayName } from "../src/discovery.js";

const PROBE = JSON.stringify({ type: "cafequest_discover" });

function streamLogger() {
  let text = "";
  const stream = { write: (s: string) => { text += s; } };
  return { stream, text: () => text };
}

/** Sends one datagram to the responder; resolves with the first reply, or null after waitMs. */
async function ask(payload: string, udpPort: number, waitMs = 300): Promise<string | null> {
  const client = createSocket("udp4");
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), waitMs);
      client.on("message", (msg) => {
        clearTimeout(timer);
        resolve(msg.toString("utf8"));
      });
      client.send(payload, udpPort, "127.0.0.1");
    });
  } finally {
    client.close();
  }
}

const logs = streamLogger();
const built = await buildApp({
  dbPath: ":memory:", port: 0, host: "127.0.0.1", discoveryPort: 0,
  logger: { level: "info", stream: logs.stream as any },
});
await built.app.listen({ port: 0, host: "127.0.0.1" });
const addr = built.app.server.address();
const httpPort = typeof addr === "object" && addr ? addr.port : 0;
after(() => built.app.close());

test("a probe gets the server's name and live HTTP port", async () => {
  assert.ok(built.discovery, "discovery should be running");
  const reply = await ask(PROBE, built.discovery.port);
  assert.ok(reply, "no reply");
  assert.deepEqual(JSON.parse(reply), { type: "cafequest_server", name: serverDisplayName(), port: httpPort });
  assert.match(logs.text(), /discovery probe answered/);
});

test("junk and oversize datagrams get no answer", async () => {
  assert.ok(built.discovery);
  const oversize = JSON.stringify({ type: "cafequest_discover", pad: "x".repeat(600) });
  for (const payload of ["hello", "{}", '{"type":"cafequest_server","name":"X","port":1}', oversize]) {
    assert.equal(await ask(payload, built.discovery.port), null, payload.slice(0, 40));
  }
});

test("a busy UDP port leaves the server running without discovery", async () => {
  const squatter = createSocket("udp4");
  await new Promise<void>((resolve) => squatter.bind(0, "127.0.0.1", () => resolve()));
  const busyLogs = streamLogger();
  const second = await buildApp({
    dbPath: ":memory:", port: 0, host: "127.0.0.1", discoveryPort: squatter.address().port,
    logger: { level: "info", stream: busyLogs.stream as any },
  });
  try {
    assert.equal(second.discovery, null);
    assert.match(busyLogs.text(), /discovery disabled/);
    await second.app.listen({ port: 0, host: "127.0.0.1" });
    const a = second.app.server.address();
    const p = typeof a === "object" && a ? a.port : 0;
    assert.equal((await fetch(`http://127.0.0.1:${p}/api/health`)).status, 200);
  } finally {
    await second.app.close();
    squatter.close();
  }
});

test("before the server listens a probe gets no answer, and closing frees the UDP port", async () => {
  const idle = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1", discoveryPort: 0, logger: { level: "silent" } });
  await idle.app.ready(); // booted, so close() runs the onClose hooks, but never listening
  assert.ok(idle.discovery);
  const udpPort = idle.discovery.port;
  // Not listening yet: there is no HTTP port to announce.
  assert.equal(await ask(PROBE, udpPort), null);
  await idle.app.close();
  const reuse = createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    reuse.once("error", reject);
    reuse.bind(udpPort, "127.0.0.1", () => resolve());
  });
  reuse.close();
});

test("serverDisplayName drops .local, caps at 64 and never goes empty", () => {
  assert.equal(serverDisplayName("Ahmets-MacBook-Air.local"), "Ahmets-MacBook-Air");
  assert.equal(serverDisplayName("CAFE-PC"), "CAFE-PC");
  assert.equal(serverDisplayName("x".repeat(80)).length, 64);
  assert.equal(serverDisplayName("  "), "CafeQuest");
  assert.equal(serverDisplayName(".local"), "CafeQuest");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w shared && npm run build -w server`
Expected: FAIL with `error TS2307: Cannot find module '../src/discovery.js'` (and `discoveryPort` not in `AppConfig`).

- [ ] **Step 3: Write the responder**

Create `server/src/discovery.ts`:

```ts
import { createSocket } from "node:dgram";
import { hostname } from "node:os";
import type { FastifyBaseLogger } from "fastify";
import { MAX_DISCOVERY_BYTES, parseDiscoveryProbe, type DiscoveryReply } from "@cafequest/shared";

/**
 * The name headsets show and remember (spec 2026-10-09 §1): the PC's hostname
 * without macOS's ".local", at most 64 characters, never empty.
 */
export function serverDisplayName(host: string = hostname()): string {
  return host.trim().replace(/\.local$/i, "").slice(0, 64) || "CafeQuest";
}

export type DiscoveryResponder = {
  /** The UDP port actually bound (the OS picks one when asked for 0). */
  port: number;
  close(): Promise<void>;
};

export type DiscoveryOptions = {
  port: number;
  host: string;
  name: string;
  /** The live HTTP port, or null before listen(); read per probe so the reply never lies. */
  httpPort: () => number | null;
  log: FastifyBaseLogger;
};

/**
 * Answers headset discovery probes (spec §2): only valid probes of at most
 * MAX_DISCOVERY_BYTES, straight back to the sender, never unprompted. Resolves
 * to null when the UDP port is taken: the server keeps running and headsets can
 * still use a manual IP.
 */
export async function startDiscoveryResponder(opts: DiscoveryOptions): Promise<DiscoveryResponder | null> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(opts.port, opts.host, () => {
        socket.off("error", reject);
        resolve();
      });
    });
  } catch (err) {
    socket.close();
    opts.log.warn({ err, port: opts.port }, `discovery disabled: UDP ${opts.port} unavailable; headsets need a manual IP`);
    return null;
  }
  socket.on("error", (err) => opts.log.warn({ err }, "discovery socket error"));
  socket.on("message", (msg, rinfo) => {
    if (msg.length > MAX_DISCOVERY_BYTES || !parseDiscoveryProbe(msg.toString("utf8"))) return;
    const httpPort = opts.httpPort();
    if (httpPort === null) return;
    const reply: DiscoveryReply = { type: "cafequest_server", name: opts.name, port: httpPort };
    socket.send(JSON.stringify(reply), rinfo.port, rinfo.address);
    opts.log.info({ from: rinfo.address }, "discovery probe answered");
  });
  const port = socket.address().port;
  opts.log.info({ port, name: opts.name }, "discovery: answering headset probes");
  return {
    port,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}
```

- [ ] **Step 4: Wire it into `buildApp` and `index.ts`**

In `server/src/app.ts`:

1. Below `import { manualGameId, resolveInstalledApp } from "./installed-apps.js";` add:
   ```ts
   import { serverDisplayName, startDiscoveryResponder } from "./discovery.js";
   ```
2. In `AppConfig`, below the `catalogFetch?: typeof fetch;` line, add:
   ```ts
     /** UDP port answering headset discovery probes (DISCOVERY_PORT from index.ts); unset = off, tests opt in with 0. */
     discoveryPort?: number;
   ```
3. Directly below `hub.start();` add:
   ```ts

     // Headsets in Auto mode find this server by broadcasting a probe (spec 2026-10-09 §2).
     const discovery = cfg.discoveryPort === undefined
       ? null
       : await startDiscoveryResponder({
           port: cfg.discoveryPort,
           host: cfg.host,
           name: serverDisplayName(),
           httpPort: () => {
             const address = app.server.address();
             return typeof address === "object" && address ? address.port : null;
           },
           log: app.log,
         });
   ```
4. Replace
   ```ts
     app.addHook("onClose", async () => {
       hub.stop();
       db.close();
     });

     return { app, db, hub };
   ```
   with
   ```ts
     app.addHook("onClose", async () => {
       hub.stop();
       await discovery?.close();
       db.close();
     });

     return { app, db, hub, discovery };
   ```

In `server/src/index.ts`:

1. Below `import { loadRootEnv, nonBlankEnv } from "./env.js";` add:
   ```ts
   import { DISCOVERY_PORT } from "@cafequest/shared";
   ```
2. Replace
   ```ts
     dbPath, port, host, adminApiKey, games: config.games,
   ```
   with
   ```ts
     dbPath, port, host, adminApiKey, games: config.games, discoveryPort: DISCOVERY_PORT,
   ```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build -w server && node --test server/dist/tests/discovery.test.js`
Expected: PASS, `# tests 5`, `# fail 0`.

Run: `npm test -w server && npx tsc -p tsconfig.json`
Expected: `# tests 73`, `# fail 0`; no `tsc` output.

- [ ] **Step 6: Commit**

```bash
git add server/src/discovery.ts server/src/app.ts server/src/index.ts server/tests/discovery.test.ts
git commit -F - <<'EOF'
feat(server): answer headset discovery probes on UDP 3000

A dgram responder answers valid probes (≤512 bytes) straight back to the
sender with the PC's hostname (minus .local) and the live HTTP port, and
stays silent otherwise. buildApp starts it only when given discoveryPort, so
tests stay off unless they opt in; a busy port disables discovery with a
warning instead of stopping the server.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Agent discovery rules (pure Kotlin)

**Files:**
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/Discovery.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/SetupValues.kt` (add `ServerMode`)
- Test: `quest-agent/app/src/test/kotlin/com/cafequest/agent/DiscoveryTest.kt`

**Interfaces:**
- Consumes: `protocolJson` (Protocol.kt).
- Produces: `const val DISCOVERY_PORT = 3000`, `const val MAX_DISCOVERY_BYTES = 512`, `const val SEARCH_AFTER_FAILURES = 3`, `data class FoundServer(val name: String, val host: String, val port: Int)`, `fun encodeDiscoveryProbe(): ByteArray`, `fun parseDiscoveryReply(text: String, fromHost: String): FoundServer?`, `fun chooseServer(found: List<FoundServer>, rememberedName: String?): FoundServer?`, `fun shouldSearch(mode: ServerMode, savedHost: String, failedAttempts: Int): Boolean`, `fun broadcastTargets(subnets: List<Pair<Inet4Address, Int>>): List<InetAddress>`, `enum class ServerMode(val stored: String) { AUTO("auto"), MANUAL("manual") }` with `ServerMode.fromStored(value: String?): ServerMode`.

All agent Gradle commands run from `quest-agent/` with JDK 21:
`cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew ...`

- [ ] **Step 1: Write the failing test**

Create `quest-agent/app/src/test/kotlin/com/cafequest/agent/DiscoveryTest.kt`:

```kotlin
package com.cafequest.agent

import java.net.Inet4Address
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {
    private val cafePc = FoundServer("CAFE-PC", "192.168.1.150", 3000)
    private val laptop = FoundServer("Turans-MacBook-Air", "192.168.1.20", 3000)

    private fun v4(text: String) = InetAddress.getByName(text) as Inet4Address

    @Test fun `constants match shared discovery ts`() {
        assertEquals(3000, DISCOVERY_PORT)
        assertEquals(512, MAX_DISCOVERY_BYTES)
    }

    @Test fun `the probe is exactly the shared probe shape`() {
        assertEquals("""{"type":"cafequest_discover"}""", encodeDiscoveryProbe().toString(Charsets.UTF_8))
    }

    @Test fun `a reply becomes a server at the address it came from`() {
        assertEquals(
            FoundServer("CAFE-PC", "192.168.1.150", 3000),
            parseDiscoveryReply("""{"type":"cafequest_server","name":"CAFE-PC","port":3000}""", "192.168.1.150"),
        )
    }

    @Test fun `anything that is not a valid reply is ignored`() {
        val junk = listOf(
            "",
            "hello",
            """{"type":"cafequest_discover"}""",
            """{"type":"cafequest_server","name":"","port":3000}""",
            """{"type":"cafequest_server","name":"${"x".repeat(65)}","port":3000}""",
            """{"type":"cafequest_server","name":"PC","port":0}""",
            """{"type":"cafequest_server","name":"PC","port":65536}""",
            """{"type":"cafequest_server","name":"PC"}""",
            """{"type":"cafequest_server","port":3000}""",
        )
        for (raw in junk) assertNull(raw, parseDiscoveryReply(raw, "192.168.1.150"))
    }

    @Test fun `with no remembered PC the first answer wins`() {
        assertEquals(laptop, chooseServer(listOf(laptop, cafePc), rememberedName = null))
        assertNull(chooseServer(emptyList(), rememberedName = null))
    }

    @Test fun `a remembered PC is the only one accepted`() {
        assertEquals(cafePc, chooseServer(listOf(laptop, cafePc), rememberedName = "CAFE-PC"))
        // The café PC is down and only the laptop answers: stay put rather than move.
        assertNull(chooseServer(listOf(laptop), rememberedName = "CAFE-PC"))
    }

    @Test fun `a blank remembered name counts as none`() {
        assertEquals(laptop, chooseServer(listOf(laptop), rememberedName = " "))
    }

    @Test fun `auto searches with no address or after three failed connects`() {
        assertTrue(shouldSearch(ServerMode.AUTO, "", failedAttempts = 0))
        assertFalse(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 0))
        assertFalse(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 2))
        assertTrue(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 3))
        assertTrue(shouldSearch(ServerMode.AUTO, "192.168.1.150", failedAttempts = 9))
    }

    @Test fun `manual never searches`() {
        assertFalse(shouldSearch(ServerMode.MANUAL, "192.168.1.77", failedAttempts = 50))
        assertFalse(shouldSearch(ServerMode.MANUAL, "", failedAttempts = 0))
    }

    @Test fun `stored modes read back, and anything else is auto`() {
        assertEquals(ServerMode.MANUAL, ServerMode.fromStored("manual"))
        assertEquals(ServerMode.AUTO, ServerMode.fromStored("auto"))
        assertEquals(ServerMode.AUTO, ServerMode.fromStored(null))
        assertEquals(ServerMode.AUTO, ServerMode.fromStored("MANUAL"))
    }

    @Test fun `targets are the all-ones address plus each subnet broadcast`() {
        val targets = broadcastTargets(listOf(v4("192.168.1.150") to 24, v4("10.0.5.7") to 16))
        assertEquals(listOf("255.255.255.255", "192.168.1.255", "10.0.255.255"), targets.map { it.hostAddress })
    }

    @Test fun `point-to-point links and duplicates add nothing`() {
        val targets = broadcastTargets(
            listOf(v4("192.168.1.150") to 32, v4("192.168.1.151") to 31, v4("192.168.1.150") to 24, v4("192.168.1.9") to 24),
        )
        assertEquals(listOf("255.255.255.255", "192.168.1.255"), targets.map { it.hostAddress })
        assertEquals(listOf("255.255.255.255"), broadcastTargets(emptyList()).map { it.hostAddress })
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests 'com.cafequest.agent.DiscoveryTest'`
Expected: FAIL at `compileDebugUnitTestKotlin` with `Unresolved reference 'FoundServer'` (and the other new names).

- [ ] **Step 3: Write the implementation**

In `SetupValues.kt`, directly below `const val UNCONFIGURED_APP_ID = "UNCONFIGURED"`, add:

```kotlin

/** How the agent gets its server address (spec §4). */
enum class ServerMode(val stored: String) {
    /** Found on the Wi-Fi, and followed when the café PC's IP changes. */
    AUTO("auto"),
    /** Typed on the setup screen; never replaced by a search. */
    MANUAL("manual");

    companion object {
        /** Missing or junk reads as Auto, so headsets upgraded from 0.2.0 start healing themselves. */
        fun fromStored(value: String?): ServerMode = entries.firstOrNull { it.stored == value } ?: AUTO
    }
}
```

Create `Discovery.kt`:

```kotlin
package com.cafequest.agent

import java.net.Inet4Address
import java.net.InetAddress
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/*
 * LAN discovery (docs/superpowers/specs/2026-10-09-server-discovery-design.md).
 * Hand-synced with shared/src/discovery.ts: same port, size cap and JSON shapes.
 */

/** UDP port the server answers probes on; fixed, independent of the server's PORT. */
const val DISCOVERY_PORT = 3000

/** Largest datagram either side sends or reads. */
const val MAX_DISCOVERY_BYTES = 512

/** Auto searches before every retry once this many connects in a row have failed. */
const val SEARCH_AFTER_FAILURES = 3

private const val PROBE_TYPE = "cafequest_discover"
private const val REPLY_TYPE = "cafequest_server"

@Serializable
private data class DiscoveryProbe(val type: String = PROBE_TYPE)

@Serializable
private data class DiscoveryReply(val type: String, val name: String, val port: Int)

/** A CafeQuest server that answered a probe; [host] is the reply's source address. */
data class FoundServer(val name: String, val host: String, val port: Int)

fun encodeDiscoveryProbe(): ByteArray = protocolJson.encodeToString(DiscoveryProbe()).toByteArray(Charsets.UTF_8)

/** One datagram as a server, or null for anything that is not a valid reply. Never throws. */
fun parseDiscoveryReply(text: String, fromHost: String): FoundServer? {
    val reply = runCatching { protocolJson.decodeFromString<DiscoveryReply>(text) }.getOrNull() ?: return null
    if (reply.type != REPLY_TYPE || reply.name.isEmpty() || reply.name.length > 64 || reply.port !in 1..65535) return null
    return FoundServer(name = reply.name, host = fromHost, port = reply.port)
}

/** Which answer to dial: only the remembered café PC, else the first answer (spec §3). */
fun chooseServer(found: List<FoundServer>, rememberedName: String?): FoundServer? =
    if (rememberedName.isNullOrBlank()) found.firstOrNull() else found.firstOrNull { it.name == rememberedName }

/** Auto searches with no address yet, or once [SEARCH_AFTER_FAILURES] connects in a row have failed; Manual never. */
fun shouldSearch(mode: ServerMode, savedHost: String, failedAttempts: Int): Boolean =
    mode == ServerMode.AUTO && (savedHost.isBlank() || failedAttempts >= SEARCH_AFTER_FAILURES)

/** 255.255.255.255 plus each IPv4 subnet's directed broadcast; some access points drop the all-ones address. */
fun broadcastTargets(subnets: List<Pair<Inet4Address, Int>>): List<InetAddress> {
    val targets = linkedSetOf<InetAddress>(InetAddress.getByAddress(byteArrayOf(-1, -1, -1, -1)))
    for ((address, prefixLength) in subnets) {
        if (prefixLength !in 1..30) continue // /31 and /32 links have no broadcast address
        val ip = address.address.fold(0) { acc, byte -> (acc shl 8) or (byte.toInt() and 0xFF) }
        val broadcast = ip or (-1 ushr prefixLength)
        targets += InetAddress.getByAddress(ByteArray(4) { i -> (broadcast ushr (24 - 8 * i)).toByte() })
    }
    return targets.toList()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests 'com.cafequest.agent.DiscoveryTest'`
Expected: `BUILD SUCCESSFUL`.

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: `BUILD SUCCESSFUL` (all agent tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/Discovery.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/SetupValues.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/DiscoveryTest.kt
git commit -F - <<'EOF'
feat(quest-agent): discovery messages and the rules for trusting an answer

Kotlin mirror of shared/src/discovery.ts plus the pure rules: Auto searches
with no address or after 3 failed connects (Manual never), a remembered PC
name is the only answer accepted, and probes go to 255.255.255.255 and the
subnet's directed broadcast.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Agent network search

**Files:**
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/Discovery.kt` (append)
- Test: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ServerDiscoveryTest.kt`

**Interfaces:**
- Consumes (Task 4): `DISCOVERY_PORT`, `MAX_DISCOVERY_BYTES`, `FoundServer`, `encodeDiscoveryProbe()`, `parseDiscoveryReply(text, fromHost)`, `broadcastTargets(subnets)`.
- Produces: `class ServerDiscovery(targets: () -> List<InetAddress>, port: Int = DISCOVERY_PORT, windowMs: Long = 1_500, probes: Int = 3, gapMs: Long = 400)` with `suspend fun search(): List<FoundServer>`; `fun wifiBroadcastTargets(context: Context): List<InetAddress>`.

- [ ] **Step 1: Write the failing test**

Create `quest-agent/app/src/test/kotlin/com/cafequest/agent/ServerDiscoveryTest.kt`:

```kotlin
package com.cafequest.agent

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real UDP on loopback: a fake café PC answers, ServerDiscovery listens. */
class ServerDiscoveryTest {
    private val loopback = InetAddress.getLoopbackAddress()
    private val sockets = mutableListOf<DatagramSocket>()

    @After fun closeSockets() = sockets.forEach { it.close() }

    /** A fake café PC: answers every valid probe with each of [replies] as its own datagram. */
    private fun responder(vararg replies: String): DatagramSocket {
        val socket = DatagramSocket(0, loopback).also(sockets::add)
        Thread {
            val buffer = ByteArray(MAX_DISCOVERY_BYTES)
            while (!socket.isClosed) {
                val probe = DatagramPacket(buffer, buffer.size)
                try { socket.receive(probe) } catch (_: Exception) { return@Thread }
                if (String(probe.data, 0, probe.length, Charsets.UTF_8) != """{"type":"cafequest_discover"}""") continue
                for (reply in replies) {
                    val bytes = reply.toByteArray(Charsets.UTF_8)
                    socket.send(DatagramPacket(bytes, bytes.size, probe.address, probe.port))
                }
            }
        }.apply { isDaemon = true }.start()
        return socket
    }

    private fun discovery(port: Int, targets: () -> List<InetAddress> = { listOf(loopback) }) =
        ServerDiscovery(targets = targets, port = port, windowMs = 400, probes = 3, gapMs = 50)

    @Test fun `answers are deduped across probes, kept in arrival order, and junk is skipped`() = runBlocking {
        val pc = responder(
            "not json",
            """{"type":"cafequest_server","name":"CAFE-PC","port":3000}""",
            """{"type":"cafequest_server","name":"DEV-LAPTOP","port":3001}""",
        )
        val host = loopback.hostAddress
        assertEquals(
            listOf(FoundServer("CAFE-PC", host, 3000), FoundServer("DEV-LAPTOP", host, 3001)),
            discovery(pc.localPort).search(),
        )
    }

    @Test fun `silence means nothing found once the window closes`() = runBlocking {
        val quiet = DatagramSocket(0, loopback).also(sockets::add) // bound, never answers
        val started = System.currentTimeMillis()
        assertEquals(emptyList<FoundServer>(), discovery(quiet.localPort).search())
        assertTrue(System.currentTimeMillis() - started < 2_000)
    }

    @Test fun `no network reads as nothing found, never a crash`() = runBlocking {
        val broken = discovery(DISCOVERY_PORT) { throw IllegalStateException("Wi-Fi off") }
        assertEquals(emptyList<FoundServer>(), broken.search())
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests 'com.cafequest.agent.ServerDiscoveryTest'`
Expected: FAIL at `compileDebugUnitTestKotlin` with `Unresolved reference 'ServerDiscovery'`.

- [ ] **Step 3: Write the implementation**

In `Discovery.kt`, replace the import block with:

```kotlin
import android.content.Context
import android.net.ConnectivityManager
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
```

and append to the end of `Discovery.kt`:

```kotlin

/**
 * Broadcasts the probe and collects answers (spec §3): [probes] sends, [gapMs]
 * apart, to every target, listening until [windowMs] after the first. Answers
 * are deduped by address and port and kept in arrival order. Never throws: no
 * Wi-Fi or no route reads as "nothing found". No android.* calls, so it runs in
 * JVM tests against a loopback responder.
 */
class ServerDiscovery(
    private val targets: () -> List<InetAddress>,
    private val port: Int = DISCOVERY_PORT,
    private val windowMs: Long = 1_500,
    private val probes: Int = 3,
    private val gapMs: Long = 400,
) {
    suspend fun search(): List<FoundServer> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, FoundServer>()
        runCatching { collect(found) }
        found.values.toList()
    }

    private fun collect(found: MutableMap<String, FoundServer>) {
        val destinations = targets()
        val probe = encodeDiscoveryProbe()
        DatagramSocket().use { socket ->
            socket.broadcast = true
            val buffer = ByteArray(MAX_DISCOVERY_BYTES)
            val start = System.currentTimeMillis()
            val deadline = start + windowMs
            var sent = 0
            while (true) {
                val now = System.currentTimeMillis()
                if (sent < probes && now >= start + sent * gapMs) {
                    for (target in destinations) {
                        // One unreachable target (say, no route for 255.255.255.255) must not stop the others.
                        runCatching { socket.send(DatagramPacket(probe, probe.size, target, port)) }
                    }
                    sent++
                    continue
                }
                if (now >= deadline) break
                val wakeAt = if (sent < probes) minOf(start + sent * gapMs, deadline) else deadline
                socket.soTimeout = (wakeAt - now).coerceAtLeast(1).toInt()
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val host = packet.address?.hostAddress ?: continue
                val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                val server = parseDiscoveryReply(text, host) ?: continue
                found.putIfAbsent("${server.host}:${server.port}", server)
            }
        }
    }
}

/** Broadcast targets for the network the headset is on now: all-ones plus its subnet broadcast. */
fun wifiBroadcastTargets(context: Context): List<InetAddress> {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val links = connectivity?.getLinkProperties(connectivity.activeNetwork)?.linkAddresses.orEmpty()
    return broadcastTargets(links.mapNotNull { link -> (link.address as? Inet4Address)?.let { it to link.prefixLength } })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests 'com.cafequest.agent.ServerDiscoveryTest'`
Expected: `BUILD SUCCESSFUL`.

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/Discovery.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ServerDiscoveryTest.kt
git commit -F - <<'EOF'
feat(quest-agent): search the Wi-Fi for the CafeQuest server

ServerDiscovery sends the probe three times, 400 ms apart, to the all-ones
and subnet broadcast addresses and collects answers for 1.5 s, deduped by
address and port in arrival order. Any network failure reads as "nothing
found". Tested against a fake responder on loopback.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Agent setup — Auto/Manual rules, no key, no baked address

**Files:**
- Modify: `quest-agent/app/src/test/kotlin/com/cafequest/agent/SetupValuesTest.kt` (rewrite)
- Modify: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/SetupValues.kt` (rewrite)
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/Identity.kt` (rewrite)
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt` (hello only)
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt` (`SetupScreen`, interim)
- Modify: `quest-agent/app/build.gradle.kts`
- Modify: `.env`, `.env.example`

**Interfaces:**
- Consumes (Task 4): `ServerMode`, `FoundServer`, `shouldSearch`.
- Produces:
  - `data class AgentIdentity(val deviceId: String, val deviceName: String, val serverHost: String, val serverPort: Int, val serverMode: ServerMode, val serverName: String?, val metaAppId: String)`
  - `const val DEFAULT_SERVER_PORT = 3000`
  - `data class AgentSetupDefaults(val metaAppId: String)` with `fromBuildConfig()`
  - `data class StoredSetup(deviceName, serverHost, serverPort, serverMode, serverName, metaAppId: String? = null)`
  - `data class AgentSetupInput(val deviceName: String, val serverMode: ServerMode, val serverHost: String, val serverPort: String, val metaAppId: String, val picked: FoundServer? = null)`
  - `fun resolveIdentity(deviceId: String, stored: StoredSetup, defaults: AgentSetupDefaults): AgentIdentity`
  - `fun mergeSetup(current: AgentIdentity, input: AgentSetupInput): AgentIdentity`
  - `fun withDiscovered(current: AgentIdentity, found: FoundServer): AgentIdentity?`
  - `IdentityStore.load(): AgentIdentity`, `IdentityStore.save(input: AgentSetupInput): AgentIdentity`, `IdentityStore.saveDiscovered(found: FoundServer): Boolean`, `IdentityStore.wsUrl(host: String, port: Int): String`

- [ ] **Step 1: Write the failing tests**

Replace the whole of `SetupValuesTest.kt` with:

```kotlin
package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SetupValuesTest {
    private val deviceId = "0b8f6a1e-3f2a-4c5d-9e8f-1a2b3c4d5e6f"

    private val baked = AgentSetupDefaults(metaAppId = "1336716629531597")

    private val auto = AgentIdentity(
        deviceId = deviceId,
        deviceName = "Quest 01",
        serverHost = "192.168.1.150",
        serverPort = 3000,
        serverMode = ServerMode.AUTO,
        serverName = "CAFE-PC",
        metaAppId = "1336716629531597",
    )
    private val manual = auto.copy(serverHost = "192.168.1.77", serverMode = ServerMode.MANUAL)
    private val cafePcMoved = FoundServer(name = "CAFE-PC", host = "192.168.1.151", port = 3000)

    // --- mergeSetup: a Save must never silently drop a field staff cannot see ---

    @Test fun `saving with a blank name or Meta App ID keeps the stored values`() {
        val merged = mergeSetup(auto, input(deviceName = "  ", metaAppId = ""))
        assertEquals("Quest 01", merged.deviceName)
        assertEquals("1336716629531597", merged.metaAppId)
    }

    @Test fun `manual saves the typed address, trimmed, and keeps the remembered PC name`() {
        val merged = mergeSetup(auto, input(serverMode = ServerMode.MANUAL, serverHost = " 10.0.0.9 ", serverPort = "4000"))
        assertEquals(ServerMode.MANUAL, merged.serverMode)
        assertEquals("10.0.0.9", merged.serverHost)
        assertEquals(4000, merged.serverPort)
        assertEquals("CAFE-PC", merged.serverName)
    }

    @Test fun `manual with a blank host or a bad port keeps the stored address`() {
        val merged = mergeSetup(manual, input(serverMode = ServerMode.MANUAL, serverHost = "", serverPort = "three thousand"))
        assertEquals("192.168.1.77", merged.serverHost)
        assertEquals(3000, merged.serverPort)
    }

    @Test fun `a manual port outside the valid range is clamped`() {
        assertEquals(65535, mergeSetup(manual, input(serverMode = ServerMode.MANUAL, serverPort = "99999")).serverPort)
        assertEquals(1, mergeSetup(manual, input(serverMode = ServerMode.MANUAL, serverPort = "0")).serverPort)
    }

    @Test fun `auto with a found server takes its address and name`() {
        val merged = mergeSetup(manual, input(serverMode = ServerMode.AUTO, picked = cafePcMoved))
        assertEquals(ServerMode.AUTO, merged.serverMode)
        assertEquals("192.168.1.151", merged.serverHost)
        assertEquals(3000, merged.serverPort)
        assertEquals("CAFE-PC", merged.serverName)
    }

    @Test fun `auto without a pick keeps what auto found before and ignores a typed host`() {
        assertEquals(auto, mergeSetup(auto, input(serverMode = ServerMode.AUTO, serverHost = "10.9.9.9")))
    }

    @Test fun `switching from manual to auto without a pick drops the typed address so the agent searches`() {
        val merged = mergeSetup(manual, input(serverMode = ServerMode.AUTO))
        assertEquals(ServerMode.AUTO, merged.serverMode)
        assertEquals("", merged.serverHost)
        assertEquals("CAFE-PC", merged.serverName)
        assertTrue(shouldSearch(merged.serverMode, merged.serverHost, failedAttempts = 0))
    }

    // --- withDiscovered: what the agent persists after a search ---

    @Test fun `a search result moves an auto headset to the PC's new address`() {
        val moved = withDiscovered(auto, cafePcMoved)
        assertEquals(auto.copy(serverHost = "192.168.1.151"), moved)
    }

    @Test fun `a search result never overwrites a manual address`() {
        assertNull(withDiscovered(manual, cafePcMoved))
    }

    // --- resolveIdentity: a fresh install should need no typing at all ---

    @Test fun `a fresh install is auto with no address yet, so it searches at once`() {
        val identity = resolveIdentity(deviceId, StoredSetup(), baked)
        assertEquals(ServerMode.AUTO, identity.serverMode)
        assertEquals("", identity.serverHost)
        assertEquals(DEFAULT_SERVER_PORT, identity.serverPort)
        assertNull(identity.serverName)
        assertEquals("1336716629531597", identity.metaAppId)
        assertEquals("Quest 0B8F", identity.deviceName)
        assertTrue(shouldSearch(identity.serverMode, identity.serverHost, failedAttempts = 0))
    }

    @Test fun `a headset upgraded from the old agent keeps its saved address and reads as auto`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(deviceName = "Quest 03", serverHost = "192.168.1.150", serverPort = "3000"),
            baked,
        )
        assertEquals(ServerMode.AUTO, identity.serverMode)
        assertEquals("192.168.1.150", identity.serverHost)
        assertNull(identity.serverName)
        assertFalse(shouldSearch(identity.serverMode, identity.serverHost, failedAttempts = 0))
    }

    @Test fun `stored values win over the baked-in Meta App ID`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(
                deviceName = "Quest 03",
                serverHost = "10.0.0.5",
                serverPort = "4000",
                serverMode = "manual",
                serverName = "CAFE-PC",
                metaAppId = "9999999999999999",
            ),
            baked,
        )
        assertEquals("Quest 03", identity.deviceName)
        assertEquals("10.0.0.5", identity.serverHost)
        assertEquals(4000, identity.serverPort)
        assertEquals(ServerMode.MANUAL, identity.serverMode)
        assertEquals("CAFE-PC", identity.serverName)
        assertEquals("9999999999999999", identity.metaAppId)
    }

    @Test fun `blank or junk stored values are treated as unset`() {
        val identity = resolveIdentity(
            deviceId,
            StoredSetup(deviceName = "   ", serverHost = "", serverPort = "x", serverMode = "sideways", serverName = " ", metaAppId = ""),
            baked,
        )
        assertEquals("Quest 0B8F", identity.deviceName)
        assertEquals("", identity.serverHost)
        assertEquals(DEFAULT_SERVER_PORT, identity.serverPort)
        assertEquals(ServerMode.AUTO, identity.serverMode)
        assertNull(identity.serverName)
        assertEquals("1336716629531597", identity.metaAppId)
    }

    @Test fun `with nothing baked in the Meta App ID stays unconfigured`() {
        assertEquals(UNCONFIGURED_APP_ID, resolveIdentity(deviceId, StoredSetup(), AgentSetupDefaults(metaAppId = "")).metaAppId)
    }

    private fun input(
        deviceName: String = "Quest 01",
        serverMode: ServerMode = ServerMode.AUTO,
        serverHost: String = "",
        serverPort: String = "",
        metaAppId: String = "1336716629531597",
        picked: FoundServer? = null,
    ) = AgentSetupInput(deviceName, serverMode, serverHost, serverPort, metaAppId, picked)
}
```

In `ProtocolTest.kt`, in the test `hello serializes with protocol version 1`, add as its last line:

```kotlin
        assertFalse(json.contains("enrollmentKey"))
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests 'com.cafequest.agent.SetupValuesTest'`
Expected: FAIL at `compileDebugUnitTestKotlin` (`No parameter with name 'serverMode' found`, `Unresolved reference 'withDiscovered'`, ...).

- [ ] **Step 3: Rewrite `SetupValues.kt`**

Replace the whole of `SetupValues.kt` with:

```kotlin
package com.cafequest.agent

/** Sentinel the launcher treats as "no Meta Dashboard App ID configured yet". */
const val UNCONFIGURED_APP_ID = "UNCONFIGURED"

/** Port a Manual setup starts from; Auto learns the real one from the discovery reply. */
const val DEFAULT_SERVER_PORT = 3000

/** How the agent gets its server address (spec §4). */
enum class ServerMode(val stored: String) {
    /** Found on the Wi-Fi, and followed when the café PC's IP changes. */
    AUTO("auto"),
    /** Typed on the setup screen; never replaced by a search. */
    MANUAL("manual");

    companion object {
        /** Missing or junk reads as Auto, so headsets upgraded from 0.2.0 start healing themselves. */
        fun fromStored(value: String?): ServerMode = entries.firstOrNull { it.stored == value } ?: AUTO
    }
}

/**
 * CafeQuest's own Meta App ID, baked in at build time from the café PC's
 * `cafequest.config.json` (see app/build.gradle.kts). Blank means "nothing was
 * baked in". The server address is not baked in: Auto finds it on the Wi-Fi.
 */
data class AgentSetupDefaults(val metaAppId: String) {
    companion object {
        fun fromBuildConfig(): AgentSetupDefaults = AgentSetupDefaults(metaAppId = BuildConfig.DEFAULT_META_APP_ID)
    }
}

/** Raw strings as persisted by DataStore; null or blank both mean "unset". */
data class StoredSetup(
    val deviceName: String? = null,
    val serverHost: String? = null,
    val serverPort: String? = null,
    val serverMode: String? = null,
    val serverName: String? = null,
    val metaAppId: String? = null,
)

/** Raw setup-screen fields, before trimming or validation. */
data class AgentSetupInput(
    val deviceName: String,
    val serverMode: ServerMode,
    /** Manual only; ignored in Auto. */
    val serverHost: String,
    /** Manual only; ignored in Auto. */
    val serverPort: String,
    val metaAppId: String,
    /** The server picked after Find server; Auto only. */
    val picked: FoundServer? = null,
)

private fun String?.orNullIfBlank(): String? = this?.takeIf { it.isNotBlank() }?.trim()

private fun clampPort(port: Int): Int = port.coerceIn(1, 65535)

/** What the agent runs with: stored values first, then the baked-in Meta App ID. */
fun resolveIdentity(
    deviceId: String,
    stored: StoredSetup,
    defaults: AgentSetupDefaults,
): AgentIdentity = AgentIdentity(
    deviceId = deviceId,
    deviceName = stored.deviceName.orNullIfBlank() ?: "Quest ${deviceId.take(4).uppercase()}",
    serverHost = stored.serverHost.orNullIfBlank() ?: "",
    serverPort = stored.serverPort.orNullIfBlank()?.toIntOrNull()?.let(::clampPort) ?: DEFAULT_SERVER_PORT,
    serverMode = ServerMode.fromStored(stored.serverMode),
    serverName = stored.serverName.orNullIfBlank(),
    metaAppId = stored.metaAppId.orNullIfBlank()?.takeUnless { it == UNCONFIGURED_APP_ID }
        ?: defaults.metaAppId.orNullIfBlank()
        ?: UNCONFIGURED_APP_ID,
)

/**
 * What a Save persists. A blank field keeps whatever is already stored: editing
 * the device name must never silently wipe the Meta App ID or a typed address.
 * Manual takes the typed host and port; Auto takes a server picked after Find
 * server, and coming back from Manual without a pick drops the typed address so
 * the agent searches at once.
 */
fun mergeSetup(current: AgentIdentity, input: AgentSetupInput): AgentIdentity {
    val picked = input.picked
    val server = when {
        input.serverMode == ServerMode.MANUAL -> current.copy(
            serverHost = input.serverHost.orNullIfBlank() ?: current.serverHost,
            serverPort = input.serverPort.orNullIfBlank()?.toIntOrNull()?.let(::clampPort) ?: current.serverPort,
        )
        picked != null -> current.copy(serverHost = picked.host, serverPort = picked.port, serverName = picked.name)
        current.serverMode == ServerMode.MANUAL -> current.copy(serverHost = "")
        else -> current
    }
    return server.copy(
        deviceName = input.deviceName.orNullIfBlank() ?: current.deviceName,
        serverMode = input.serverMode,
        metaAppId = input.metaAppId.orNullIfBlank() ?: current.metaAppId,
    )
}

/** A server Auto found, applied to the stored setup; null when the setup is Manual (never overwrite a typed IP). */
fun withDiscovered(current: AgentIdentity, found: FoundServer): AgentIdentity? =
    if (current.serverMode == ServerMode.MANUAL) null
    else current.copy(serverHost = found.host, serverPort = found.port, serverName = found.name)
```

- [ ] **Step 4: Rewrite `Identity.kt`**

Replace the whole of `Identity.kt` with:

```kotlin
package com.cafequest.agent

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.identityStore by preferencesDataStore("cafequest_identity")

/** Persistent UUID + setup values from brief §17/§38 (DataStore, no HW ids). */
data class AgentIdentity(
    val deviceId: String,
    val deviceName: String,
    /** "" until Auto finds a server or one is typed in Manual. */
    val serverHost: String,
    val serverPort: Int,
    val serverMode: ServerMode,
    /** The café PC's name from its last discovery reply; Auto accepts only this name afterwards. */
    val serverName: String?,
    val metaAppId: String,
)

class IdentityStore(
    private val context: Context,
    private val defaults: AgentSetupDefaults = AgentSetupDefaults.fromBuildConfig(),
) {
    private val ID = stringPreferencesKey("device_id")
    private val NAME = stringPreferencesKey("device_name")
    private val HOST = stringPreferencesKey("server_host")
    private val PORT = stringPreferencesKey("server_port")
    private val MODE = stringPreferencesKey("server_mode")
    private val SERVER_NAME = stringPreferencesKey("server_name")
    private val META = stringPreferencesKey("meta_app_id")

    suspend fun load(): AgentIdentity {
        var id = context.identityStore.data.map { it[ID] }.first()
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            context.identityStore.edit { it[ID] = id }
        }
        val prefs = context.identityStore.data.first()
        return resolveIdentity(
            deviceId = id,
            stored = StoredSetup(
                deviceName = prefs[NAME],
                serverHost = prefs[HOST],
                serverPort = prefs[PORT],
                serverMode = prefs[MODE],
                serverName = prefs[SERVER_NAME],
                metaAppId = prefs[META],
            ),
            defaults = defaults,
        )
    }

    /** Persists the setup screen. Blank fields keep their current values (see mergeSetup). */
    suspend fun save(input: AgentSetupInput): AgentIdentity = mergeSetup(load(), input).also { persist(it) }

    /** Persists a server Auto found; false (nothing written) when the setup is Manual by now. */
    suspend fun saveDiscovered(found: FoundServer): Boolean {
        val moved = withDiscovered(load(), found) ?: return false
        persist(moved)
        return true
    }

    private suspend fun persist(identity: AgentIdentity) {
        context.identityStore.edit {
            it[NAME] = identity.deviceName
            it[HOST] = identity.serverHost
            it[PORT] = identity.serverPort.toString()
            it[MODE] = identity.serverMode.stored
            val name = identity.serverName
            if (name == null) {
                it.remove(SERVER_NAME)
            } else {
                it[SERVER_NAME] = name
            }
            it[META] = identity.metaAppId
        }
    }

    fun wsUrl(host: String, port: Int): String = "ws://$host:$port/agent-ws"
}
```

The 0.2.0 `enrollment_key` preference stays in DataStore and is never read.

- [ ] **Step 5: Remove the key from the protocol, connection, strings and setup screen**

`Protocol.kt`: delete the line `    val enrollmentKey: String? = null,` from `data class Hello`.

`AgentConnection.kt`: delete the line `                    enrollmentKey = identity.enrollmentKey.ifBlank { null },` from the `Hello(...)` call in `onOpen`.

`AgentStrings.kt`:
1. Delete `    val enrollmentKey: String` from the `AgentStrings` interface.
2. Delete `    override val enrollmentKey = "Enrollment key"` from `EnglishStrings` and `    override val enrollmentKey = "Kayıt anahtarı"` from `TurkishStrings`.
3. Replace `    override val setupHint = "Filled in from the café PC's settings. A field left blank keeps its saved value."` with `    override val setupHint = "A field left blank keeps its saved value."`
4. Replace `    override val setupHint = "Kafe bilgisayarının ayarlarından dolduruldu. Boş bırakılan alan kayıtlı değerini korur."` with `    override val setupHint = "Boş bırakılan alan kayıtlı değerini korur."`

`MainActivity.kt`, in `SetupScreen` (Task 8 replaces this function; this keeps today's behavior meanwhile):
1. Delete these three lines:
   ```kotlin
       // Prefilled, unlike before: a blank field used to be saved over the stored
       // value, so renaming a headset silently wiped its enrollment key.
       var enroll by remember(identity) { mutableStateOf(identity?.enrollmentKey ?: "") }
   ```
2. Delete the line `        SetupField(s.enrollmentKey, enroll) { enroll = it }`.
3. Replace
   ```kotlin
                   store.save(AgentSetupInput(
                       deviceName = name,
                       serverHost = host,
                       serverPort = port,
                       enrollmentKey = enroll,
                       metaAppId = meta,
                   ))
   ```
   with
   ```kotlin
                   store.save(AgentSetupInput(
                       deviceName = name,
                       // Until the Auto | Manual switch lands, the typed host is what the agent dials.
                       serverMode = ServerMode.MANUAL,
                       serverHost = host,
                       serverPort = port,
                       metaAppId = meta,
                   ))
   ```

- [ ] **Step 6: Stop baking the server address and key into the APK**

In `quest-agent/app/build.gradle.kts`, replace everything from the line `// Build-time setup defaults, read from the files the café PC already maintains so a` down to (not including) `fun configuredMetaAppId(): String {` with:

```kotlin
// Build-time setup default: CafeQuest's own Meta App ID from the café PC's
// cafequest.config.json, so a freshly installed headset needs no typing. Blank
// when the file is absent; Gradle re-generates BuildConfig when it changes. The
// server address is not baked in: the agent finds it on the Wi-Fi (Discovery.kt).
val repoRoot = rootProject.projectDir.parentFile

```

In the same file's `defaultConfig`, replace

```kotlin
        versionCode = 2
        versionName = "0.2.0"
```

with

```kotlin
        versionCode = 3
        versionName = "0.3.0"
```

and delete these three lines:

```kotlin
        buildConfigField("String", "DEFAULT_SERVER_HOST", javaString(envValue("CAFE_PC_LAN_HOST").ifBlank { "192.168.1.50" }))
        buildConfigField("int", "DEFAULT_SERVER_PORT", (envValue("PORT").toIntOrNull() ?: 3000).toString())
        buildConfigField("String", "DEFAULT_ENROLLMENT_KEY", javaString(envValue("DEVICE_ENROLLMENT_KEY")))
```

(`buildConfigField("String", "DEFAULT_META_APP_ID", ...)` and `javaString` stay.)

Then remove `CAFE_PC_LAN_HOST` and its comment from both env files:

```bash
perl -0pi -e 's/\n# LAN address headsets dial;[^\n]*\nCAFE_PC_LAN_HOST=[^\n]*\n//' .env .env.example
grep -c "CAFE_PC_LAN_HOST" .env .env.example
```

Expected: `.env:0` and `.env.example:0`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: `BUILD SUCCESSFUL` (main sources, including `MainActivity`, compile; all tests pass).

Run: `grep -rn -E "enrollmentKey|BuildConfig\.DEFAULT_SERVER|DEFAULT_ENROLLMENT_KEY|envValue" quest-agent/app/src quest-agent/app/build.gradle.kts`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add quest-agent/app/build.gradle.kts quest-agent/app/src/main/kotlin/com/cafequest/agent/SetupValues.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/Identity.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/SetupValuesTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt .env .env.example
git commit -F - <<'EOF'
feat(quest-agent): Auto/Manual server setup without a key or baked address

The setup now stores a server mode and the remembered PC name. A fresh
install is Auto with no address, a headset upgraded from 0.2.0 keeps its
saved host and reads as Auto, and a search result never overwrites a Manual
setup. The enrollment key, CAFE_PC_LAN_HOST and the baked PORT are gone; only
the Meta App ID is still baked. Agent 0.3.0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Agent connection loop finds the server

**Files:**
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/ServerLocator.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentDiagnostics.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/HeadsetStatus.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt`
- Test: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ServerLocatorTest.kt` (new), `DiagnosticsTest.kt`, `HeadsetStatusTest.kt`, `AgentStringsTest.kt`

**Interfaces:**
- Consumes: `FoundServer`, `chooseServer`, `shouldSearch`, `ServerDiscovery`, `wifiBroadcastTargets` (Tasks 4–5); `ServerMode`, `AgentIdentity`, `IdentityStore.saveDiscovered(found): Boolean` (Task 6).
- Produces:
  - `data class ServerTarget(val name: String?, val host: String, val port: Int, val mode: ServerMode)` and `fun AgentIdentity.serverTarget(): ServerTarget` (AgentDiagnostics.kt)
  - `AgentDiagnosticsState.server: ServerTarget?` and `AgentDiagnostics.setServer(server: ServerTarget)`
  - `class ServerLocator(initial: ServerTarget, search: suspend () -> List<FoundServer>, persist: suspend (FoundServer) -> Boolean, onSearching: () -> Unit, onTarget: (ServerTarget) -> Unit)` with `val target: ServerTarget` and `suspend fun beforeConnect(failedAttempts: Int): ServerTarget`
  - `enum class ConnState { DISCONNECTED, SEARCHING, CONNECTING, CONNECTED }`
  - `AgentStrings.searching: String`, `AgentStrings.searchingCaption: String`

- [ ] **Step 1: Write the failing tests**

Create `quest-agent/app/src/test/kotlin/com/cafequest/agent/ServerLocatorTest.kt`:

```kotlin
package com.cafequest.agent

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerLocatorTest {
    private val cafePcMoved = FoundServer("CAFE-PC", "192.168.1.151", 3000)
    private val laptop = FoundServer("DEV-LAPTOP", "192.168.1.20", 3000)
    private val savedCafePc = ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO)

    /** Records what the locator asked of its collaborators. */
    private class Calls(val answers: List<FoundServer>, val persistResult: Boolean = true) {
        var searches = 0
        var searchingShown = 0
        val persisted = mutableListOf<FoundServer>()
        val published = mutableListOf<ServerTarget>()
    }

    private fun locator(initial: ServerTarget, calls: Calls) = ServerLocator(
        initial = initial,
        search = { calls.searches++; calls.answers },
        persist = { found -> calls.persisted += found; calls.persistResult },
        onSearching = { calls.searchingShown++ },
        onTarget = { calls.published += it },
    )

    @Test fun `a fresh install searches at once and dials what it found`() = runTest {
        val calls = Calls(listOf(cafePcMoved))
        val target = locator(ServerTarget(null, "", 3000, ServerMode.AUTO), calls).beforeConnect(failedAttempts = 0)
        assertEquals(ServerTarget("CAFE-PC", "192.168.1.151", 3000, ServerMode.AUTO), target)
        assertEquals(listOf(cafePcMoved), calls.persisted)
        assertEquals(listOf(target), calls.published)
        assertEquals(1, calls.searchingShown)
    }

    @Test fun `a saved address is dialed without searching until three connects fail`() = runTest {
        val calls = Calls(listOf(cafePcMoved))
        val l = locator(savedCafePc, calls)
        assertEquals(savedCafePc, l.beforeConnect(failedAttempts = 2))
        assertEquals(0, calls.searches)
        assertEquals("192.168.1.151", l.beforeConnect(failedAttempts = 3).host)
        assertEquals(1, calls.searches)
        assertEquals("192.168.1.151", l.target.host)
    }

    @Test fun `another server never takes over a headset that remembers the cafe PC`() = runTest {
        val calls = Calls(listOf(laptop))
        assertEquals(savedCafePc, locator(savedCafePc, calls).beforeConnect(failedAttempts = 5))
        assertTrue(calls.persisted.isEmpty())
        assertTrue(calls.published.isEmpty())
    }

    @Test fun `a manual headset never searches`() = runTest {
        val calls = Calls(listOf(cafePcMoved))
        val typed = ServerTarget(null, "192.168.1.77", 3000, ServerMode.MANUAL)
        assertEquals(typed, locator(typed, calls).beforeConnect(failedAttempts = 40))
        assertEquals(0, calls.searches)
        assertEquals(0, calls.searchingShown)
    }

    @Test fun `a result that could not be saved is not dialed`() = runTest {
        // Staff switched the headset to Manual while this search ran, so IdentityStore refused it.
        val calls = Calls(listOf(cafePcMoved), persistResult = false)
        assertEquals(savedCafePc, locator(savedCafePc, calls).beforeConnect(failedAttempts = 3))
        assertTrue(calls.published.isEmpty())
    }

    @Test fun `finding the same server again changes nothing`() = runTest {
        val calls = Calls(listOf(FoundServer("CAFE-PC", "192.168.1.150", 3000)))
        assertEquals(savedCafePc, locator(savedCafePc, calls).beforeConnect(failedAttempts = 3))
        assertTrue(calls.persisted.isEmpty())
        assertTrue(calls.published.isEmpty())
    }
}
```

In `DiagnosticsTest.kt`, add this test inside the class:

```kotlin
    @Test fun `diagnostics carries the server the agent dials`() {
        val diagnostics = AgentDiagnostics { "2026-01-02T03:04:05Z" }
        assertNull(diagnostics.state.value.server)
        val identity = AgentIdentity(
            deviceId = "d",
            deviceName = "Quest 01",
            serverHost = "192.168.1.150",
            serverPort = 3000,
            serverMode = ServerMode.AUTO,
            serverName = "CAFE-PC",
            metaAppId = "1",
        )
        diagnostics.setServer(identity.serverTarget())
        assertEquals(ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO), diagnostics.state.value.server)
    }
```

In `HeadsetStatusTest.kt`, add inside the class:

```kotlin
    @Test
    fun searchingSaysWhatTheHeadsetIsDoing() {
        val status = linkStatus(ConnState.SEARCHING, null, null)
        assertEquals("Searching for server…", status.word)
        assertEquals("Looking for the café PC on this Wi-Fi.", status.caption)
        assertEquals(LinkTone.WAITING, status.tone)
    }
```

In `AgentStringsTest.kt`, add inside the class:

```kotlin
    @Test
    fun searchingSpeaksTurkish() {
        val searching = linkStatus(ConnState.SEARCHING, "192.168.1.150", 3000, AgentLanguage.TR.strings)
        assertEquals("Sunucu aranıyor…", searching.word)
        assertEquals("Kafe bilgisayarı bu Wi-Fi ağında aranıyor.", searching.caption)
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: FAIL at `compileDebugUnitTestKotlin` (`Unresolved reference 'ServerTarget'`, `'ServerLocator'`, `'SEARCHING'`, `'setServer'`).

- [ ] **Step 3: Add the server target to diagnostics**

In `AgentDiagnostics.kt`:

1. Directly above `data class AgentDiagnosticsState(` add:
   ```kotlin
   /** The server the agent dials right now, as the diagnostics screen shows it. */
   data class ServerTarget(val name: String?, val host: String, val port: Int, val mode: ServerMode)

   fun AgentIdentity.serverTarget(): ServerTarget = ServerTarget(serverName, serverHost, serverPort, serverMode)

   ```
2. In `AgentDiagnosticsState`, below `val lastResult: String = "—",` add:
   ```kotlin
       /** Published by the connection; Auto discovery may move it. Null until the service starts. */
       val server: ServerTarget? = null,
   ```
3. Below `fun setServiceRunning(running: Boolean) = _state.update { it.copy(serviceRunning = running) }` add:
   ```kotlin
       fun setServer(server: ServerTarget) = _state.update { it.copy(server = server) }
   ```

- [ ] **Step 4: Write `ServerLocator.kt`**

```kotlin
package com.cafequest.agent

/**
 * Where the agent dials next (spec §3). Auto searches when nothing is saved or
 * once [SEARCH_AFTER_FAILURES] connects in a row have failed, keeps to the café
 * PC it remembers, and persists a new address before dialing it. Manual never
 * searches. No android.* calls, so the whole decision is unit-tested.
 */
class ServerLocator(
    initial: ServerTarget,
    private val search: suspend () -> List<FoundServer>,
    /** Saves a found server; false when the setup turned Manual meanwhile, so it must not be dialed. */
    private val persist: suspend (FoundServer) -> Boolean,
    private val onSearching: () -> Unit,
    private val onTarget: (ServerTarget) -> Unit,
) {
    @Volatile var target: ServerTarget = initial
        private set

    suspend fun beforeConnect(failedAttempts: Int): ServerTarget {
        val current = target
        if (!shouldSearch(current.mode, current.host, failedAttempts)) return current
        onSearching()
        val pick = chooseServer(search(), current.name) ?: return current
        if (pick.host == current.host && pick.port == current.port && pick.name == current.name) return current
        if (!persist(pick)) return current
        return ServerTarget(pick.name, pick.host, pick.port, ServerMode.AUTO).also {
            target = it
            onTarget(it)
        }
    }
}
```

- [ ] **Step 5: Add the searching words**

In `AgentStrings.kt`:

1. In the interface, directly above `    val server: String`, add:
   ```kotlin
       val searching: String
       val searchingCaption: String

   ```
2. In `EnglishStrings`, directly above `    override val server = "Server"`, add:
   ```kotlin
       override val searching = "Searching for server…"
       override val searchingCaption = "Looking for the café PC on this Wi-Fi."

   ```
3. In `TurkishStrings`, directly above `    override val server = "Sunucu"`, add:
   ```kotlin
       override val searching = "Sunucu aranıyor…"
       override val searchingCaption = "Kafe bilgisayarı bu Wi-Fi ağında aranıyor."

   ```

In `HeadsetStatus.kt`, in `linkStatus`, add this branch directly above the `ConnState.CONNECTING ->` branch:

```kotlin
        ConnState.SEARCHING -> LinkStatus(strings.searching, strings.searchingCaption, LinkTone.WAITING)
```

- [ ] **Step 6: Drive the connection loop through the locator**

In `AgentConnection.kt`:

1. Replace `enum class ConnState { DISCONNECTED, CONNECTING, CONNECTED }` with `enum class ConnState { DISCONNECTED, SEARCHING, CONNECTING, CONNECTED }`.
2. Replace the class KDoc line ` * on launch commands, with §25 backoff reconnect. Network loss never crashes.` with:
   ```kotlin
    * on launch commands, with §25 backoff reconnect. Network loss never crashes.
    * In Auto mode the loop finds the café PC on the Wi-Fi first (ServerLocator).
   ```
3. Replace the constructor's last parameter line
   ```kotlin
       private val foregroundAppReader: ForegroundAppReader = AndroidForegroundAppReader(context),
   ) : ManagedAgentConnection {
   ```
   with
   ```kotlin
       private val foregroundAppReader: ForegroundAppReader = AndroidForegroundAppReader(context),
       private val discovery: ServerDiscovery = ServerDiscovery({ wifiBroadcastTargets(context) }),
   ) : ManagedAgentConnection {
   ```
4. Replace
   ```kotlin
       private val client = OkHttpClient.Builder()
           .pingInterval(20, TimeUnit.SECONDS)
           .build()
   ```
   with
   ```kotlin
       private val client = OkHttpClient.Builder()
           // A LAN connect takes milliseconds; an old IP the café PC left must not cost 10s a try.
           .connectTimeout(3, TimeUnit.SECONDS)
           .pingInterval(20, TimeUnit.SECONDS)
           .build()
       private val locator = ServerLocator(
           initial = identity.serverTarget(),
           search = { discovery.search() },
           persist = { found -> IdentityStore(context).saveDiscovered(found) },
           onSearching = { diagnostics.setConnection(ConnState.SEARCHING) },
           onTarget = {
               diagnostics.setServer(it)
               Log.i(LOG_TAG, "found ${it.name} at ${it.host}:${it.port}")
           },
       )
   ```
5. In `start()`, replace
   ```kotlin
           running = true
           scope.launch { loop() }
   ```
   with
   ```kotlin
           running = true
           diagnostics.setServer(locator.target)
           scope.launch { loop() }
   ```
6. Replace the whole `loop()` function and the first two lines of `connectOnce()`:
   ```kotlin
       private suspend fun loop() {
           while (running && scope.isActive) {
               diagnostics.setConnection(ConnState.CONNECTING)
               try { connectOnce() } catch (e: Exception) {
                   Log.w(LOG_TAG, "connect failed: ${e.message}")
               }
               if (!running) break
               // connectOnce returns only after the socket dies; back off, then retry.
               val wait = backoffDelayMs(attempt++)
               Log.i(LOG_TAG, "reconnecting in ${wait}ms (attempt $attempt)")
               delay(wait)
           }
           diagnostics.setConnection(ConnState.DISCONNECTED)
       }

       private suspend fun connectOnce() {
           val url = IdentityStore(context).wsUrl(identity.serverHost, identity.serverPort)
   ```
   with
   ```kotlin
       private suspend fun loop() {
           while (running && scope.isActive) {
               val server = locator.beforeConnect(attempt)
               if (!running) break
               if (server.host.isBlank()) {
                   // Nothing saved and nothing answered: wait like a failed connect, then search again.
                   diagnostics.setConnection(ConnState.DISCONNECTED)
               } else {
                   diagnostics.setConnection(ConnState.CONNECTING)
                   try { connectOnce(server) } catch (e: Exception) {
                       Log.w(LOG_TAG, "connect failed: ${e.message}")
                   }
                   if (!running) break
               }
               // connectOnce returns only after the socket dies; back off, then retry.
               val wait = backoffDelayMs(attempt++)
               Log.i(LOG_TAG, "reconnecting in ${wait}ms (attempt $attempt)")
               delay(wait)
           }
           diagnostics.setConnection(ConnState.DISCONNECTED)
       }

       private suspend fun connectOnce(server: ServerTarget) {
           val url = IdentityStore(context).wsUrl(server.host, server.port)
   ```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`, 0 failures (including `ServerLocatorTest`'s 6 tests).

- [ ] **Step 8: Commit**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/ServerLocator.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentDiagnostics.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/HeadsetStatus.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ServerLocatorTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/DiagnosticsTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/HeadsetStatusTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/AgentStringsTest.kt
git commit -F - <<'EOF'
feat(quest-agent): find the café PC before connecting, and follow it

Before each connect, ServerLocator searches in Auto mode when no address is
saved or after 3 failed connects, accepts only the remembered PC name, and
saves a new address before dialing it; Manual never searches. The screen
shows "Searching for server…" meanwhile, the service publishes the server it
dials, and the WebSocket connect timeout drops to 3 s.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Agent screens — Auto | Manual, Find server, server line

**Files:**
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/HeadsetStatus.kt` (add `serverSummary`)
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt`
- Test: `HeadsetStatusTest.kt`, `AgentStringsTest.kt`

**Interfaces:**
- Consumes: `ServerTarget`, `serverTarget()`, `AgentDiagnosticsState.server` (Task 7); `ServerMode`, `DEFAULT_SERVER_PORT`, `AgentSetupInput(..., picked)` (Task 6); `FoundServer`, `ServerDiscovery`, `wifiBroadcastTargets` (Tasks 4–5).
- Produces: `fun serverSummary(target: ServerTarget, strings: AgentStrings): String`; `AgentStrings.auto`, `.manual`, `.notFoundYet`, `.findServer`, `.findingServer`, `.pickServer`, `.noServerFound`; private composable `TwoWaySwitch<T>`.

- [ ] **Step 1: Write the failing tests**

In `HeadsetStatusTest.kt`, add inside the class:

```kotlin
    @Test
    fun serverLineNamesTheCafePcInAuto() {
        assertEquals(
            "CAFE-PC · 192.168.1.150:3000 · Auto",
            serverSummary(ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO), EnglishStrings),
        )
        // Upgraded from 0.2.0: the saved host works but no PC name was learned yet.
        assertEquals(
            "192.168.1.150:3000 · Auto",
            serverSummary(ServerTarget(null, "192.168.1.150", 3000, ServerMode.AUTO), EnglishStrings),
        )
    }

    @Test
    fun serverLineInManualShowsOnlyTheTypedAddress() {
        assertEquals(
            "192.168.1.77:3000 · Manual",
            serverSummary(ServerTarget("CAFE-PC", "192.168.1.77", 3000, ServerMode.MANUAL), EnglishStrings),
        )
    }

    @Test
    fun serverLineBeforeAutoFindsAnything() {
        assertEquals("Not found yet", serverSummary(ServerTarget(null, "", 3000, ServerMode.AUTO), EnglishStrings))
    }
```

In `AgentStringsTest.kt`, add inside the class:

```kotlin
    @Test
    fun serverLineSpeaksTurkish() {
        val tr = AgentLanguage.TR.strings
        assertEquals(
            "CAFE-PC · 192.168.1.150:3000 · Otomatik",
            serverSummary(ServerTarget("CAFE-PC", "192.168.1.150", 3000, ServerMode.AUTO), tr),
        )
        assertEquals("192.168.1.77:3000 · Manuel", serverSummary(ServerTarget("CAFE-PC", "192.168.1.77", 3000, ServerMode.MANUAL), tr))
        assertEquals("Henüz bulunamadı", serverSummary(ServerTarget(null, "", 3000, ServerMode.AUTO), tr))
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: FAIL at `compileDebugUnitTestKotlin` with `Unresolved reference 'serverSummary'`.

- [ ] **Step 3: Add the words and the server line**

In `AgentStrings.kt`:

1. In the interface, directly above `    val notificationChannel: String`, add:
   ```kotlin
       val auto: String
       val manual: String
       val notFoundYet: String
       val findServer: String
       val findingServer: String
       val pickServer: String
       val noServerFound: String

   ```
2. In `EnglishStrings`, directly above `    override val notificationChannel = "CafeQuest agent"`, add:
   ```kotlin
       override val auto = "Auto"
       override val manual = "Manual"
       override val notFoundYet = "Not found yet"
       override val findServer = "Find server"
       override val findingServer = "Searching…"
       override val pickServer = "Several servers answered. Pick the café PC:"
       override val noServerFound = "No server found. Is this headset on the café PC's Wi-Fi? Is UDP port 3000 open in the PC's firewall?"

   ```
3. In `TurkishStrings`, directly above `    override val notificationChannel = "CafeQuest servisi"`, add:
   ```kotlin
       override val auto = "Otomatik"
       override val manual = "Manuel"
       override val notFoundYet = "Henüz bulunamadı"
       override val findServer = "Sunucuyu bul"
       override val findingServer = "Aranıyor…"
       override val pickServer = "Birden fazla sunucu yanıt verdi. Kafe bilgisayarını seçin:"
       override val noServerFound = "Sunucu bulunamadı. Gözlük, kafe bilgisayarıyla aynı Wi-Fi ağında mı? Bilgisayarın güvenlik duvarında UDP 3000 portu açık mı?"

   ```

In `HeadsetStatus.kt`, directly below the `linkStatus` function, add:

```kotlin

/**
 * The server line on the diagnostics and setup screens: "CAFE-PC · 192.168.1.150:3000 · Auto".
 * The PC name shows only in Auto (it is what Auto stays with); before Auto finds anything, "Not found yet".
 */
fun serverSummary(target: ServerTarget, strings: AgentStrings): String {
    if (target.host.isBlank()) return strings.notFoundYet
    val mode = if (target.mode == ServerMode.AUTO) strings.auto else strings.manual
    val name = target.name?.takeIf { target.mode == ServerMode.AUTO }
    return listOfNotNull(name, "${target.host}:${target.port}", mode).joinToString(" · ")
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Share one two-way switch between language and server mode**

In `MainActivity.kt`, replace the whole `LanguageSwitch` composable (from its KDoc `/** EN | TR, the same two-way switch as the dashboard header; the pressed side is live. */` through its closing brace) with:

```kotlin
/** EN | TR, the same two-way switch as the dashboard header; the pressed side is live. */
@Composable
private fun LanguageSwitch(current: AgentLanguage, onPick: (AgentLanguage) -> Unit) {
    TwoWaySwitch(
        options = AgentLanguage.entries,
        current = current,
        description = LocalStrings.current.language,
        label = { it.code.uppercase() },
        onPick = onPick,
    )
}

/** A segmented switch drawn like the dashboard header's EN | TR; the pressed side is live. */
@Composable
private fun <T> TwoWaySwitch(
    options: List<T>,
    current: T,
    description: String,
    label: (T) -> String,
    onPick: (T) -> Unit,
) {
    Row(
        Modifier
            .border(1.dp, CqColors.Rail, RoundedCornerShape(8.dp))
            .padding(2.dp)
            .semantics { contentDescription = description }
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { option ->
            val picked = option == current
            Box(
                Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (picked) CqColors.Raised else Color.Transparent)
                    .selectable(selected = picked, role = Role.RadioButton, onClick = { onPick(option) })
                    .height(44.dp)
                    .widthIn(min = 56.dp)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label(option),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (picked) CqColors.Chalk else CqColors.ChalkDim,
                )
            }
        }
    }
}
```

- [ ] **Step 6: Show the server the agent dials on the diagnostics screen**

In `MainActivity.kt`, in `DiagnosticsScreen`:

1. Replace
   ```kotlin
       val link = linkStatus(diagnostics.connection, identity?.serverHost, identity?.serverPort, s)
   ```
   with
   ```kotlin
       // The service publishes where it dials (Auto may have moved it); before that, the saved setup.
       val server = diagnostics.server ?: identity?.serverTarget()
       val link = linkStatus(diagnostics.connection, server?.host, server?.port, s)
   ```
2. Replace
   ```kotlin
               Fact(s.server) { FactText(identity?.let { "${it.serverHost}:${it.serverPort}" } ?: "…") }
   ```
   with
   ```kotlin
               Fact(s.server) { FactText(server?.let { serverSummary(it, s) } ?: "…") }
   ```

In `Screens`, replace the comment

```kotlin
        // Opening CafeQuest connects. With the baked-in setup defaults this means a
        // freshly installed headset needs no typing at all: install, open, online.
```

with

```kotlin
        // Opening CafeQuest connects. In Auto (the default) the agent finds the café PC
        // itself, so a freshly installed headset needs no typing at all: install, open, online.
```

- [ ] **Step 7: Auto | Manual and Find server on the setup screen**

In `MainActivity.kt`, replace the whole `SetupScreen` composable (from `@Composable` / `fun SetupScreen(` through its closing brace) with:

```kotlin
@Composable
fun SetupScreen(identity: AgentIdentity?, store: IdentityStore, onSaved: () -> Unit, onCancel: () -> Unit) {
    val s = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember(identity) { mutableStateOf(identity?.deviceName ?: "") }
    var mode by remember(identity) { mutableStateOf(identity?.serverMode ?: ServerMode.AUTO) }
    var host by remember(identity) { mutableStateOf(identity?.serverHost ?: "") }
    var port by remember(identity) { mutableStateOf((identity?.serverPort ?: DEFAULT_SERVER_PORT).toString()) }
    var meta by remember(identity) { mutableStateOf(identity?.metaAppId?.takeUnless { it == UNCONFIGURED_APP_ID } ?: "") }
    // Find server: null = not searched yet. A pick is applied by Save and connect, like every other field.
    var found by remember(identity) { mutableStateOf<List<FoundServer>?>(null) }
    var picked by remember(identity) { mutableStateOf<FoundServer?>(null) }
    var searching by remember { mutableStateOf(false) }
    Panel {
        Text(s.setupTitle, style = MaterialTheme.typography.headlineSmall)
        Text(
            s.setupHint,
            style = MaterialTheme.typography.bodyMedium,
            color = CqColors.ChalkDim,
        )
        SetupField(s.deviceName, name) { name = it }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(s.server, style = MaterialTheme.typography.bodyLarge)
            TwoWaySwitch(
                options = ServerMode.entries,
                current = mode,
                description = s.server,
                label = { if (it == ServerMode.AUTO) s.auto else s.manual },
                onPick = { mode = it },
            )
        }
        if (mode == ServerMode.AUTO) {
            // What Auto dials after Save: the pick, else what Auto found before (a Manual setup found nothing).
            val shown = picked?.let { ServerTarget(it.name, it.host, it.port, ServerMode.AUTO) }
                ?: identity?.takeIf { it.serverMode == ServerMode.AUTO }?.serverTarget()
            Text(
                shown?.let { serverSummary(it, s) } ?: s.notFoundYet,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
            SecondaryAction(if (searching) s.findingServer else s.findServer) {
                if (searching) return@SecondaryAction
                searching = true
                scope.launch {
                    val results = ServerDiscovery({ wifiBroadcastTargets(context) }).search()
                    found = results
                    results.singleOrNull()?.let { picked = it }
                    searching = false
                }
            }
            val answers = found
            if (answers != null && answers.isEmpty()) {
                Text(s.noServerFound, style = MaterialTheme.typography.bodyMedium, color = CqColors.Alert)
            }
            if (answers != null && answers.size > 1) {
                Text(s.pickServer, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                answers.forEach { server ->
                    SecondaryAction(serverSummary(ServerTarget(server.name, server.host, server.port, ServerMode.AUTO), s)) {
                        picked = server
                    }
                }
            }
        } else {
            SetupField(s.serverHost, host) { host = it }
            SetupField(s.serverPort, port, KeyboardType.Number) { port = it }
        }
        SetupField(s.metaAppId, meta, KeyboardType.Number) { meta = it }
        Spacer(Modifier.height(4.dp))
        PrimaryAction(s.saveAndConnect) {
            scope.launch {
                store.save(AgentSetupInput(
                    deviceName = name,
                    serverMode = mode,
                    serverHost = host,
                    serverPort = port,
                    metaAppId = meta,
                    picked = picked,
                ))
                onSaved()
            }
        }
        TextButton(onClick = onCancel, modifier = Modifier.height(48.dp)) {
            Text(s.cancel, style = MaterialTheme.typography.labelLarge, color = CqColors.ChalkDim)
        }
    }
}
```

No new imports are needed: `LocalContext`, `FontWeight`, `widthIn`, `height`, `padding` and the selection modifiers are already imported in `MainActivity.kt`.

- [ ] **Step 8: Build the APK and run every agent test**

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest assembleDebug`
Expected: `BUILD SUCCESSFUL`; `app/build/outputs/apk/debug/app-debug.apk` exists.

Run: `grep -n "ServerMode.MANUAL,$" quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt`
Expected: no output (Task 6's interim hard-coded Manual save is gone).

- [ ] **Step 9: Commit**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/HeadsetStatus.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/HeadsetStatusTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/AgentStringsTest.kt
git commit -F - <<'EOF'
feat(quest-agent): Auto | Manual setup with Find server

The setup screen gets an Auto | Manual switch drawn like EN | TR. Auto shows
the server it will dial and a Find server button that lists every PC that
answered; Manual keeps today's host and port fields. Diagnostics shows
"CAFE-PC · 192.168.1.150:3000 · Auto" from what the service actually dials.
All new words in English and Turkish.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Docs

**Files:**
- Modify: `CLAUDE.md`, `docs/architecture.md`, `docs/quest-setup.md` (rewrite), `docs/morning-test.md`, `README.md`, `docs/known-limitations.md`, `docs/decisions.md` (append), `docs/poc-test-results.md`
- Add to git: `docs/superpowers/specs/2026-10-09-server-discovery-design.md`, `docs/superpowers/plans/2026-10-09-server-discovery.md`

**Interfaces:** none (documentation of Tasks 1–8).

- [ ] **Step 1: `CLAUDE.md`**

1. In Commands, replace `npm run simulator -- --count 8 --stable --enrollment-key "$DEVICE_ENROLLMENT_KEY"` with `npm run simulator -- --count 8 --stable`.
2. In the single-test block, below `node --test server/dist/tests/security.test.js` add `node --test server/dist/tests/discovery.test.js`.
3. In Build gotchas, replace
   ```
   - Tests build apps with `dbPath: ":memory:"` and `port: 0`; `buildApp()` returns
     `{ app, db, hub }` and `app.close()` stops the hub timers and closes the DB.
   ```
   with
   ```
   - Tests build apps with `dbPath: ":memory:"` and `port: 0`; `buildApp()` returns
     `{ app, db, hub, discovery }` (`discovery` is null unless `discoveryPort` is
     set; tests that want it pass `0`) and `app.close()` stops the hub timers, the
     discovery socket and the DB.
   ```
4. Replace the architecture block
   ```
   server :3000 — Fastify + better-sqlite3
     app.ts    routes, auth hooks, the hello/enrollment handshake
     hub.ts    live sockets, command lifecycle, 1s sweep, 1s dashboard state push
     catalog-refresh.ts  the one network fetch, shared by CLI and refresh route
     store.ts  ALL SQL (devices, games, device_apps, sessions, commands)
     db.ts     schema creation + additive idempotent migrations on open
     │ WS /agent-ws (hello carries enrollmentKey — never a URL param)
     ▼
   agents: quest-simulator (tests/demo) │ quest-agent APK (hardware)
   ```
   with
   ```
   server :3000 — Fastify + better-sqlite3
     app.ts    routes, auth hooks, the hello handshake
     hub.ts    live sockets, command lifecycle, 1s sweep, 1s dashboard state push
     discovery.ts  UDP 3000 responder: answers headset probes with name + HTTP port
     catalog-refresh.ts  the one internet fetch, shared by CLI and refresh route
     store.ts  ALL SQL (devices, games, device_apps, sessions, commands)
     db.ts     schema creation + additive idempotent migrations on open
     │ UDP 3000: headset broadcasts a probe, server answers the sender
     │ WS /agent-ws (hello, telemetry, commands; no key)
     ▼
   agents: quest-simulator (tests/demo, --url) │ quest-agent APK (hardware, finds the server)
   ```
5. Replace
   ```
   Two code paths reach the network, both via `catalog-refresh.ts`:
   `npm run catalog:update` and `POST /api/catalog/refresh` (the dashboard's
   **Update app list** button). Nothing else does. `appCatalog` in `app.ts` is a
   ```
   with
   ```
   Two code paths reach the internet, both via `catalog-refresh.ts`:
   `npm run catalog:update` and `POST /api/catalog/refresh` (the dashboard's
   **Update app list** button). Nothing else does (the discovery responder only
   answers LAN probes). `appCatalog` in `app.ts` is a
   ```
6. Directly below the line `Changing a message shape means touching all three plus their tests.` add:
   ```

   Discovery is a separate, smaller pair: `shared/src/discovery.ts` (UDP 3000,
   ≤512-byte JSON `cafequest_discover` probe and `cafequest_server` reply) and
   `quest-agent/.../Discovery.kt`. Change both together, with their tests.
   ```
7. At the end of "Invariants to preserve" (after the **DB beats config** bullet) add:
   ```
   - **Discovery**: the server answers only valid probes of ≤512 bytes, with its
     live HTTP port, and never announces itself. An Auto headset searches when
     nothing is saved and before every retry after 3 failed connects, then accepts
     only the PC name it remembers; Manual never searches, and a search result
     never overwrites a Manual setup (`withDiscovered`). `HOST` must stay
     `0.0.0.0`; a busy UDP 3000 disables discovery with a warning, never the server.
   ```
8. In "Auth (LAN POC model)", replace
   ```
   `?key=` (browsers cannot set WS headers). `DEVICE_ENROLLMENT_KEY` gates agent
   hello. Either key unset = open mode with a boot warning — tested behavior, not an
   oversight. Fastify runs with `disableRequestLogging: true` so WS key params never
   reach the logs; do not re-enable request logging.
   ```
   with
   ```
   `?key=` (browsers cannot set WS headers). Unset = open mode with a boot warning —
   tested behavior, not an oversight. Agents need no key: the enrollment key was
   removed on 2026-10-09 (LAN-only café), and the hello schema strips a leftover
   `enrollmentKey` sent by an old APK. Fastify runs with `disableRequestLogging:
   true` so WS key params never reach the logs; do not re-enable request logging.
   ```
9. In "Installed apps and Meta App IDs", replace
   ```
   The agent's setup screen is prefilled from `BuildConfig` fields that
   `quest-agent/app/build.gradle.kts` reads at build time out of the repo-root
   `.env` (`CAFE_PC_LAN_HOST`, `PORT`, `DEVICE_ENROLLMENT_KEY`) and
   `cafequest.config.json` (`metaAppId`). `SetupValues.kt` holds the pure merge
   rules: a blank field keeps the stored value, so saving one field never wipes
   another. Usage access needs `adb shell appops set com.cafequest.agent
   GET_USAGE_STATS allow` once per headset.
   ```
   with
   ```
   Only CafeQuest's own Meta App ID is baked into `BuildConfig`, from
   `cafequest.config.json` (`metaAppId`); the APK no longer reads `.env`. The
   server address comes from discovery in **Auto** mode (`Discovery.kt`,
   `ServerLocator.kt`) or is typed in **Manual** mode. `SetupValues.kt` holds the
   pure merge rules: a blank field keeps the stored value, so saving one field
   never wipes another. Usage access needs `adb shell appops set
   com.cafequest.agent GET_USAGE_STATS allow` once per headset.
   ```

- [ ] **Step 2: `docs/architecture.md`**

1. Replace
   ```
     │  app.ts      HTTP + WS routes, auth gates, hello/enrollment check
     │  hub.ts      live sockets, command lifecycle, sweeps, snapshots
     │  store.ts    all SQL (devices/games/device apps/sessions/commands)
     │  catalog.ts  local package-name to Meta App ID cache + verified fallbacks
     │  config.ts   cafequest.config.json loading + non-clobbering seed
     │  auth.ts     ADMIN_API_KEY / DEVICE_ENROLLMENT_KEY checks
     │  WS /agent-ws (hello.enrollmentKey)
   ```
   with
   ```
     │  app.ts       HTTP + WS routes, auth gate, hello handshake
     │  hub.ts       live sockets, command lifecycle, sweeps, snapshots
     │  store.ts     all SQL (devices/games/device apps/sessions/commands)
     │  catalog.ts   local package-name to Meta App ID cache + verified fallbacks
     │  config.ts    cafequest.config.json loading + non-clobbering seed
     │  auth.ts      ADMIN_API_KEY checks
     │  discovery.ts UDP 3000: answers headset probes with name + HTTP port
     │  UDP 3000 probe → reply, then WS /agent-ws (hello, no key)
   ```
2. Directly above `## Language (EN / TR)` insert:
   ```
   ## Server discovery

   Headsets in **Auto** mode (the default) find the café PC by themselves. The
   agent sends `{"type":"cafequest_discover"}` to UDP 3000 at `255.255.255.255`
   and the Wi-Fi subnet's broadcast address, three times 400 ms apart, and listens
   for 1.5 s. The server answers the sender directly with
   `{"type":"cafequest_server","name":…,"port":…}`: its hostname without `.local`
   and its live HTTP port. The headset dials the reply's source address, so the
   server never has to know its own LAN IP.

   An Auto headset searches when nothing is saved and before every retry once 3
   connects in a row have failed, so a PC that moved to a new IP is found again
   within ~35 s of answering. It remembers the PC's name and from then on accepts
   only that name, so a second server on the Wi-Fi (a laptop running
   `npm run dev`) cannot take over a headset. **Manual** mode dials a typed
   address and never searches. The setup screen's **Find server** runs the same
   search on demand.

   UDP 3000 is fixed in `shared/src/discovery.ts` and `Discovery.kt`, independent
   of `PORT`. `buildApp` starts the responder only when given `discoveryPort`
   (tests opt in with `0`); a busy port disables it with a warning and the server
   keeps running.

   ```
3. Replace
   ```
   LAN-first POC: `ADMIN_API_KEY` guards dashboard REST + WS, `DEVICE_ENROLLMENT_KEY`
   gates agent hello. Either unset = open LAN mode with a boot warning (documented,
   tested). Request lines are never logged, so WS `?key=` values cannot leak.
   ```
   with
   ```
   LAN-first POC: `ADMIN_API_KEY` guards dashboard REST + WS; unset = open LAN mode
   with a boot warning (documented, tested). Agents need no key: the enrollment key
   was removed on 2026-10-09 because CafeQuest only ever runs on the café LAN.
   Request lines are never logged, so WS `?key=` values cannot leak.
   ```

- [ ] **Step 3: `docs/quest-setup.md`**

Replace the whole file with:

````markdown
# Quest Setup (per headset)

All values live in the agent's setup screen and persist in DataStore (§38).

A fresh install needs no typing: in **Auto** mode (the default) the headset finds
the café PC on the Wi-Fi by itself and follows it when the PC's IP changes. The
only value baked into the APK is CafeQuest's Meta App ID, read at build time from
`cafequest.config.json` (`metaAppId`); change it and rebuild to move every new
headset at once. Blank fields on the setup screen keep the value already stored,
so editing one field never clears the others.

## Install

```bash
cd quest-agent
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Foreground-game detection: Android requires this per-package grant in addition
# to the PACKAGE_USAGE_STATS manifest permission. Once per headset; it survives
# `adb install -r` but not an uninstall.
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow
```

Without that grant every card reads **Usage access required** instead of the
current game. Nothing else breaks: battery, sessions, and launching still work.

If `adb devices` shows nothing: put the headset in developer mode (phone app →
Menu → Devices → headset → Developer mode), connect USB, accept the
RSA prompt inside the headset, try another cable/port.

## Configure (on-headset setup screen)

| Field | Example |
|---|---|
| Device name | `Quest 01` … `Quest 08` |
| Server | **Auto** (default): found on the Wi-Fi; **Find server** searches now and lists every PC that answered. **Manual** (debugging): host `192.168.1.50` (the café PC's LAN IP from `ipconfig` / `ifconfig`, not `localhost`) and port `3000`; a Manual headset never searches. |
| Meta App ID | CafeQuest's own Meta Horizon Developer Dashboard App ID (`1336716629531597`) |

Tap **Save and connect**. The diagnostics screen should show `Connected` with a
server line like `CAFE-PC · 192.168.1.50:3000 · Auto`, and the dashboard card for
this headset should flip to Online within ~5s. Saving while the agent service is
already running reloads the server and Meta App ID immediately; no process
restart is required.

The PC firewall must allow inbound TCP 3000 (dashboard and headsets) and UDP 3000
(discovery). Windows' "allow node" prompt creates a program rule that covers
both; a hand-made TCP-only port rule does not.

The headset's **Meta App ID** initializes CafeQuest with the Meta SDK. It is not
one of the target-game IDs in `cafequest.config.json`; each game still needs its
own real Meta App ID there.

## Diagnostics controls

- **Reconnect** restarts the agent WebSocket connection.
- **Send test telemetry** refreshes the displayed battery state and sends a
  telemetry frame when connected.
- **Test app launch** retries the most recent game command received from the
  dashboard. Before the first dashboard launch it reports
  `FAILED NO_GAME_COMMAND_RECEIVED` instead of launching an unknown app.

## Troubleshooting

- **Quest cannot reach the PC**: same Wi-Fi band (2.4/5 GHz SSID), PC firewall
  must allow inbound TCP 3000 and UDP 3000, no client-isolation on the AP.
- **Stays on "Searching for server…" or "No server found"**: allow inbound UDP
  3000 in the PC firewall, keep `HOST=0.0.0.0` in `.env` (the default), and check
  the headset is on the café PC's Wi-Fi subnet. Some access points drop
  broadcasts: switch the headset to **Manual** and type the PC's IP.
- **Joined the wrong server** (a laptop running `npm run dev` answered first on a
  fresh install): **Change setup** → **Find server** → pick the café PC → **Save
  and connect**. The headset remembers that PC's name from then on.
- **Café PC renamed or replaced**: Auto headsets keep looking for the old name.
  Press **Find server** once on each headset and pick the new PC.
- **Online but battery stuck**: telemetry is every 5s; if last-seen ages past
  15s the card goes Offline (§15) — check Wi-Fi, then **Reconnect**.
- **META_APP_ID_NOT_CONFIGURED**: the headset setup screen's Meta App ID is
  blank/placeholder; enter CafeQuest's own Dashboard App ID and save again.
- **Open now says "Usage access required"**: run the `appops` grant above
  for this headset, then **Reconnect**. The next telemetry frame (≤5s) clears it.
- **Open now says "No game open" while a game is running**: the
  agent only names packages from the inventory it reported, so a game installed
  after the last connection is invisible until the next **Reconnect**.
- **Launch does nothing**: game not installed/entitled on *that* headset, or
  its target Meta App ID is still a `FILL_*` placeholder (dashboard shows the
  `game_meta_app_id_not_configured` error).
````

- [ ] **Step 4: `docs/morning-test.md`**

1. Replace `cp .env.example .env # replace both change-me keys before continuing` with `cp .env.example .env # replace the change-me admin key before continuing`.
2. Replace
   ```
   The server loads the root `.env` automatically. The simulator and each headset
   must use its `DEVICE_ENROLLMENT_KEY`; the dashboard prompts for
   `ADMIN_API_KEY`.

   Find the PC's LAN IP (`ipconfig` / `ifconfig`), e.g. `192.168.1.50`.
   Dashboard: http://localhost:5173.
   ```
   with
   ```
   The server loads the root `.env` automatically; the dashboard prompts for
   `ADMIN_API_KEY`. Headsets need no key and find the PC on the Wi-Fi by
   themselves; the PC firewall must allow inbound TCP 3000 and UDP 3000.

   For Manual mode only: the PC's LAN IP (`ipconfig` / `ifconfig`), e.g.
   `192.168.1.50`. Dashboard: http://localhost:5173.
   ```
3. Replace
   ```
   The APK bakes in host/port/enrollment key/Meta App ID from `.env` +
   `cafequest.config.json`, so the setup screen should already be filled in.
   ```
   with
   ```
   The APK bakes in CafeQuest's Meta App ID from `cafequest.config.json`; the
   server address is found on the Wi-Fi, so the setup screen needs no typing.
   ```
4. Replace
   ```
   Open **CafeQuest** on the Quest. Host, port, enrollment key, and the Meta
   Dashboard App ID are prefilled from the build; set the name to `Quest 01` →
   **Save and connect**.
   ```
   with
   ```
   Open **CafeQuest** on the Quest. Server is **Auto** and the Meta Dashboard App
   ID is prefilled from the build; set the name to `Quest 01` → **Save and
   connect**.
   ```
5. Directly below the table row that starts with `| 15 |` add:
   ```
   | 16 | Fresh install: `adb shell pm clear com.cafequest.agent`, then open CafeQuest without touching any field. It shows `Searching for server…`, then `Connected`, and the server line reads `<PC name> · <PC IP>:3000 · Auto`. (The headset gets a new id: remove its old offline card.) | |
   | 17 | **Change setup** → **Find server**: the café PC is listed within ~2 s; **Save and connect** reconnects | |
   | 18 | PC IP change: stop the server, give the PC a new IP (switch Wi-Fi ↔ Ethernet, or renew its DHCP lease), start the server. Every Auto headset is back `Online` within ~35 s with nobody touching it, and the server log shows `discovery probe answered` | |
   | 19 | Set one headset to **Manual** with the PC's IP → **Save and connect**, then restart the server: the headset reconnects to the same IP and never shows `Searching for server…` | |
   ```
6. Replace
   ```
   - **Can't connect**: same Wi-Fi, PC firewall TCP 3000, no AP client-isolation.
   - **ENROLLMENT_REJECTED**: key mismatch with server `.env`.
   ```
   with
   ```
   - **Can't connect**: same Wi-Fi, PC firewall TCP 3000 and UDP 3000, no AP
     client-isolation.
   - **No server found**: allow inbound UDP 3000 in the PC firewall and keep
     `HOST=0.0.0.0`; if the access point drops broadcasts, use **Manual** with the
     PC's IP.
   ```

- [ ] **Step 5: `README.md`**

1. Replace `cp .env.example .env # then replace both change-me keys` with `cp .env.example .env # then replace the change-me admin key`.
2. Replace
   ```
   A freshly installed headset needs no typing. The APK bakes its setup defaults in
   at build time:

   | Setup field | Baked from |
   |---|---|
   | Server host | `CAFE_PC_LAN_HOST` in `.env` |
   | Server port | `PORT` in `.env` |
   | Enrollment key | `DEVICE_ENROLLMENT_KEY` in `.env` |
   | Meta App ID | top-level `metaAppId` in `cafequest.config.json` |

   Change those files, rebuild, and every newly installed headset picks the values
   up. Only the device name is worth setting per headset, and the dashboard can
   rename a headset instead. On the setup screen, a field left blank keeps the
   value already stored, so editing one field never clears the others.
   ```
   with
   ```
   A freshly installed headset needs no typing. It finds the café PC on the Wi-Fi
   by itself and follows it when the PC's IP changes ([server
   discovery](docs/architecture.md#server-discovery)); the PC firewall must allow
   inbound TCP 3000 and UDP 3000. The only value baked into the APK is CafeQuest's
   own Meta App ID, the top-level `metaAppId` in `cafequest.config.json`: change
   it, rebuild, and every newly installed headset picks it up.

   For debugging, the setup screen's **Manual** mode dials a typed host and port
   and never searches. Only the device name is worth setting per headset, and the
   dashboard can rename a headset instead. On the setup screen, a field left blank
   keeps the value already stored, so editing one field never clears the others.
   ```
3. Replace `- [docs/architecture.md](docs/architecture.md) — components, semantics, auth model` with `- [docs/architecture.md](docs/architecture.md) — components, semantics, server discovery, auth model`.

- [ ] **Step 6: `docs/known-limitations.md`**

1. Replace
   ```
   - **No per-device credentials yet**: one shared `DEVICE_ENROLLMENT_KEY` gates
     enrollment; architecture permits per-device tokens later (§35).
   ```
   with
   ```
   - **No agent authentication**: any device on the café LAN can connect to
     `/agent-ws` as a headset. The shared enrollment key was removed on 2026-10-09
     because CafeQuest only ever runs on the café's own network.
   ```
2. Replace
   ```
     sessions, commands and app inventory, but a headset that still has the agent
     and the enrollment key enrolls again on its next hello. A connected headset
     is refused with 409 `headset_online`.
   ```
   with
   ```
     sessions, commands and app inventory, but a headset that still runs the agent
     comes back on its next hello. A connected headset is refused with 409
     `headset_online`.
   ```
3. Append at the end of the file:
   ```
   - **Discovery needs one broadcast domain**: headsets find the server only on
     the same subnet, through an access point that passes broadcasts, with inbound
     UDP 3000 allowed on the PC and the server on `HOST=0.0.0.0` (a socket bound to
     one address misses broadcasts). Otherwise use **Manual** with the PC's IP.
     UNVERIFIED on hardware (docs/morning-test.md rows 16–19).
   - **A renamed or replaced café PC is not followed automatically**: an Auto
     headset accepts only the PC name it remembers, so after a rename staff press
     **Find server** once per headset. On a fresh install with two servers
     answering (say, a laptop running `npm run dev`), the first answer wins.
   ```

- [ ] **Step 7: `docs/decisions.md` (append only)**

Append at the end of the file:

```

## Headsets find the server by UDP probe

Decision: in **Auto** mode the agent broadcasts `{"type":"cafequest_discover"}`
to UDP 3000 and the server answers the sender with its name and live HTTP port
(`server/src/discovery.ts`, `quest-agent/.../Discovery.kt`). The agent searches
when no address is saved and before every retry after 3 failed connects, and
then accepts only the remembered PC name. **Manual** mode keeps a typed address
and never searches. `CAFE_PC_LAN_HOST` and the baked `PORT` are gone; this
supersedes the host/port part of "Agent setup defaults are baked in at build
time" (the Meta App ID is still baked).

Reason: the café PC's IP comes from the router. A baked or typed address went
stale whenever it changed, and fixing it meant retyping it on eight headsets.
mDNS needed an npm dependency and Android's callback-heavy `NsdManager`, and
multicast is filtered by more access points than broadcast; a subnet sweep
assumed /24 and port 3000. The reply's source address is the IP that works even
when the PC has several interfaces. Spec:
`docs/superpowers/specs/2026-10-09-server-discovery-design.md`.

## No enrollment key

Decision: `DEVICE_ENROLLMENT_KEY`, `hello.enrollmentKey`, `ENROLLMENT_REJECTED`
and the setup screen's key field are removed. The server's hello schema strips
unknown keys, so a 0.2.0 agent that still sends one is accepted. `ADMIN_API_KEY`
stays.

Reason: CafeQuest runs only on the café's own LAN and is never published, so the
key protected nothing real while costing a setup field and a way for a headset
to fail enrollment.
```

- [ ] **Step 8: `docs/poc-test-results.md`**

Directly below the table row that starts with `| Headset app in Turkish |` add:

```
| Server discovery (fresh install) | NOT TESTED | UDP probe/reply built and tested on loopback (server and agent JVM tests); not yet run on a Quest or through the café access point (morning-test row 16). |
| Find server button | NOT TESTED | Morning-test row 17. |
| PC IP change healing | NOT TESTED | Agent searches before every retry after 3 failed connects; morning-test row 18. |
| Manual IP stays pinned | NOT TESTED | Unit-tested rule (Manual never searches); morning-test row 19. |
```

- [ ] **Step 9: Check for leftovers**

Run: `git grep -n -i -E "enrollment|CAFE_PC_LAN_HOST" -- CLAUDE.md README.md docs/architecture.md docs/quest-setup.md docs/morning-test.md docs/known-limitations.md`
Expected: only the deliberate "removed on 2026-10-09" notes in `CLAUDE.md`, `docs/architecture.md` and `docs/known-limitations.md`.

- [ ] **Step 10: Commit**

```bash
git add CLAUDE.md README.md docs/architecture.md docs/quest-setup.md docs/morning-test.md docs/known-limitations.md docs/decisions.md docs/poc-test-results.md docs/superpowers/specs/2026-10-09-server-discovery-design.md docs/superpowers/plans/2026-10-09-server-discovery.md
git commit -F - <<'EOF'
docs: headsets find the server; enrollment key removed

Describe UDP discovery (architecture, setup, troubleshooting, limitations),
add morning-test rows 16-19 with NOT TESTED results, append the two
decisions, and drop every enrollment-key and CAFE_PC_LAN_HOST instruction.
Adds the design spec and implementation plan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Full verification and a live smoke test

**Files:** none changed (unless a step fails).

**Interfaces:** consumes everything above.

- [ ] **Step 1: All automated suites**

Run: `npm test && npx tsc -p tsconfig.json`
Expected: shared 20, server 73, simulator 11, dashboard 121 tests, all passing; no `tsc` output.

Run: `cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: No stray key or baked address in code**

Run: `git grep -n -E "enrollmentKey|isEnrolled|ENROLLMENT_REJECTED|DEVICE_ENROLLMENT_KEY|CAFE_PC_LAN_HOST|BuildConfig\.DEFAULT_SERVER" -- shared server quest-simulator quest-agent dashboard .env.example`
Expected: only `shared/tests/protocol.test.ts` and `server/tests/security.test.ts` (old-APK compatibility tests).

- [ ] **Step 3: Live probe against a real server process**

UDP 3000 may already be taken by a dev server Turan is running; that is fine and shows up as a `discovery disabled` warning plus a reply from the other server.

Run:

```bash
npm run build -w shared && npm run build -w server
DB_PATH="$TMPDIR/cq-smoke.db" PORT=3100 node server/dist/src/index.js > "$TMPDIR/cq-smoke.log" 2>&1 &
SMOKE_PID=$!
sleep 2
node -e '
const s = require("node:dgram").createSocket("udp4");
s.on("message", (m, r) => console.log(r.address, String(m)));
s.bind(() => {
  s.setBroadcast(true);
  const probe = Buffer.from(JSON.stringify({ type: "cafequest_discover" }));
  s.send(probe, 3000, "127.0.0.1");
  s.send(probe, 3000, "255.255.255.255");
  setTimeout(() => s.close(), 1500);
});'
kill $SMOKE_PID
grep -E "discovery" "$TMPDIR/cq-smoke.log"
```

Expected: at least one line `127.0.0.1 {"type":"cafequest_server","name":"<this Mac's name>","port":3100}`, usually a second one from the Mac's LAN address for the broadcast; the log shows `discovery: answering headset probes` and `discovery probe answered`. If another server already holds UDP 3000, the replies carry its port (3000) and the log shows `discovery disabled`.

- [ ] **Step 4: Hardware (only with Turan at the headset)**

If `adb devices` lists a Quest and Turan agrees: `adb install -r quest-agent/app/build/outputs/apk/debug/app-debug.apk`, run morning-test rows 16–19 (row 16's `pm clear` wipes that headset's CafeQuest setup and id, so ask first), and record PASS/FAIL with notes in `docs/poc-test-results.md`, replacing the `NOT TESTED` rows added in Task 9. Commit that update as `docs: record discovery hardware results`. Without hardware, leave the rows `NOT TESTED`.
