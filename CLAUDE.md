# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CafeQuest: a LAN proof-of-concept for running a VR café of ~8 Meta Quest headsets —
live headset status, play-time sessions, and remote game launching from a web
dashboard on the café PC. npm workspaces (`shared`, `server`, `quest-simulator`,
`dashboard`) plus a Gradle/Kotlin Android agent in `quest-agent/` (outside the
workspace set). Node >= 22, ESM everywhere, TypeScript `strict` +
`noUncheckedIndexedAccess`.

## Commands

```bash
npm install                  # root; links all workspaces
npm run build                # tsc all workspaces, in dependency order
npm test                     # all workspaces (~40s; shared, server, simulator, dashboard)
npx tsc -p tsconfig.json     # whole-repo typecheck, noEmit (excludes dashboard)

npm run dev                  # server :3000 + dashboard :5173
npm run server / npm run dashboard
npm run simulator -- --count 8 --stable
npm run catalog:update       # builds, then refreshes gitignored server/data/app-catalog.json
```

Single tests (backend tests are compiled first, then run from `dist/`):

```bash
npm run build -w shared && npm run build -w server
node --test server/dist/tests/security.test.js
node --test server/dist/tests/discovery.test.js
node --test --test-name-pattern "reconnect with a stale last_seen_at" server/dist/tests/ownership.test.js
node --test shared/dist/tests/protocol.test.js
npm run build -w quest-simulator && node --test quest-simulator/dist/quest-simulator/tests/e2e.test.js
npm test -w dashboard -- src/api.test.ts        # vitest
node --test server/dist/tests/catalog-refresh.test.js
node --test server/dist/tests/catalog-routes.test.js
node --test server/dist/tests/cast-coordinator.test.js
node --test server/dist/tests/casting-routes.test.js
npm test -w dashboard -- src/casting.test.ts src/components/LiveViewModal.test.tsx
```

Android agent (needs **JDK 21** — Gradle 8.7 rejects the JDK 25 that
`/usr/libexec/java_home` returns by default; prefix with
`JAVA_HOME=$(/usr/libexec/java_home -v 21)` if `java -version` is not 21):

```bash
cd quest-agent && ./gradlew testDebugUnitTest     # JVM unit tests
./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Build gotchas

- No watch mode anywhere on the backend: `dev`/`test` scripts are `tsc` then
  `node`. Rebuild after every edit.
- `@cafequest/shared` resolves to `shared/dist/src/index.js`. Protocol edits are
  invisible to `server`/`quest-simulator` until `shared` is rebuilt.
- `quest-simulator` sets `rootDir: ".."` (it imports `server/src` in its e2e
  test), so its output lands under `dist/quest-simulator/...` — hence the odd
  paths in its `start`/`test` scripts.
- The server loads the repo-root `.env` itself (`env.ts` walks up from
  `server/dist/src`). Shell exports take precedence; blank values count as unset.
- Tests build apps with `dbPath: ":memory:"` and `port: 0`; `buildApp()` returns
  `{ app, db, hub, discovery }` (`discovery` is null unless `discoveryPort` is
  set; tests that want it pass `0`) and `app.close()` stops the hub timers, the
  discovery socket and the DB.

## Architecture

```
dashboard :5173 (React+Vite)
  │ REST /api/* (Authorization: Bearer ADMIN_API_KEY)  +  WS /dashboard-ws?key=
  ▼
server :3000 — Fastify + better-sqlite3
  app.ts    routes, auth hooks, the hello handshake
  hub.ts    live sockets, command lifecycle, 1s sweep, 1s dashboard state push
  cast-coordinator.ts  the one in-memory live-view session (no SQL, no media)
  discovery.ts  UDP 3000 responder: answers headset probes with name + HTTP port
  catalog-refresh.ts  the one internet fetch, shared by CLI and refresh route
  store.ts  ALL SQL (devices, games, device_apps, sessions, commands)
  db.ts     schema creation + additive idempotent migrations on open
  │ UDP 3000: headset broadcasts a probe, server answers the sender
  │ WS /agent-ws (hello, telemetry, commands; no key)
  │ WS /cast-ws?key=&sessionId= relays offer/answer/ICE; video is peer-to-peer
  ▼
agents: quest-simulator (tests/demo, --url) │ quest-agent APK (hardware, finds the server)
```

**Live support view** (`screen_cast_v1`): one global session, one viewer, video
only (960×540 / 15 FPS / 1.5 Mbps), direct LAN WebRTC with an empty ICE-server
list — no STUN, TURN, SFU, audio, or recording. The server relays signaling and
keeps nothing: no SDP, ICE, or media in SQLite, files, or logs. MediaProjection
consent is required per session and Developer Mode does not bypass it, so
`quest-agent/.../CastingController.kt` owns one request at a time and every stop
path (viewer close, DELETE, timeout, agent disconnect/replacement, projection
revocation, app shutdown) is idempotent. Cast messages extend the wire protocol,
so they too live in `shared/src/protocol.ts`, `quest-agent/.../Protocol.kt`, and
`dashboard/src/types.ts`; browser signaling sits in `dashboard/src/casting.ts`
with the native adapter in `browser-rtc.ts`.

Two code paths reach the internet, both via `catalog-refresh.ts`:
`npm run catalog:update` and `POST /api/catalog/refresh` (the dashboard's
**Update app list** button). Nothing else does (the discovery responder only
answers LAN probes). `appCatalog` in `app.ts` is a
mutable binding and `Hub` holds a `() => AppCatalog` getter, so a refresh takes
effect without a restart — don't turn either back into a captured value.

`docs/architecture.md` is the fuller version. Treat it and the code as
authoritative; `docs/decisions.md` is an append-only log and some entries have
drifted from the code (it claims a 5s offline sweep and queueing launches for
offline devices; the code sweeps every 1s and rejects offline launches with 409).

### The wire protocol lives in three hand-synced places

1. `shared/src/protocol.ts` — Zod schemas, the source of truth
   (`PROTOCOL_VERSION = 1`, discriminated union on `type`). `parseAgentMessage`
   never throws and reports `UNSUPPORTED_PROTOCOL_VERSION` before validation.
2. `quest-agent/.../Protocol.kt` — kotlinx.serialization mirror. It **must** use
   `Json { encodeDefaults = true; explicitNulls = false }`, or `type` and
   `protocolVersion` drop off the wire and the server rejects every message.
3. `dashboard/src/types.ts` — hand-written mirror of the `hub.snapshot()` shape
   (not generated from the server).

Changing a message shape means touching all three plus their tests.

Discovery is a separate, smaller pair: `shared/src/discovery.ts` (UDP 3000,
≤512-byte JSON `cafequest_discover` probe and `cafequest_server` reply) and
`quest-agent/.../Discovery.kt`. Change both together, with their tests.

### Invariants to preserve

- **Online** = `now - lastSeenAt <= 15s` (`OFFLINE_MS`), re-evaluated by the 1s
  sweep, which also closes stale sockets with code 4000. Pongs to the hub's 5s
  ping refresh `lastSeenAt` like any agent message; without them a headset whose
  telemetry stalls (suspected: asleep) flickers Offline ~1s every ~16s (sweep
  close, then the agent's 1s reconnect).
- **`expectedCurrentGame`** is only "the last launch CafeQuest asked for". The
  true foreground app is the separate `usage`/`foregroundApp` channel, from
  Android `UsageStats` on the agent; keep the two distinct in the UI.
- **Foreground runs survive overlays**: `ForegroundAppTracker` ignores an
  unmanaged package coming forward (Meta universal menu), so `startedAt` is not
  restamped by a menu peek. Only ACTIVITY_PAUSED of the current game, a
  different managed game resuming, or the package leaving the reported
  inventory ends a run. The server also drops `foregroundApp` from snapshots
  when the package is not in that device's `device_apps`.
- **Commands**: `sent → received → success|failed`, else `timeout` at 10s.
  Acks/results carry the sender's `deviceId`; foreign/unknown ones are rejected
  and terminal states never regress on late or duplicate delivery.
- **No store-and-forward**: launching to a disconnected device is 409.
  `HTTP 202` means "written to the socket", never "the game started" — only
  `command_result: success` proves that.
- **Duplicate connections**: newest hello wins; the old socket gets
  `DUPLICATE_DEVICE` then close 4001. A valid hello also refreshes
  `last_seen_at`, otherwise the sweep drops reconnects before first telemetry.
- **Sessions**: server clock is authoritative (`remaining = endsAt - serverTime`,
  dashboard corrects skew with `serverTime - Date.now()`). Expiry never touches
  the headset. Unlimited sessions (`minutes: null`) report `endsAt: null` while
  running, but the DB keeps `ends_at NOT NULL` (start time, `open_ended = 1`),
  so any new query on `ends_at` must check the flag. Stop writes the real end,
  and a stopped unlimited session stays in the snapshot until the next one.
- **DB beats config**: `seedConfiguredGames` inserts missing games and upgrades a
  placeholder `metaAppId` to a real one, but never overwrites values staff set.
- **Discovery**: the server answers only valid probes of ≤512 bytes, with its
  live HTTP port, and never announces itself. An Auto headset searches when
  nothing is saved and before every retry after 3 failed connects, then accepts
  only the PC name it remembers; Manual never searches, and a search result
  never overwrites a Manual setup (`withDiscovered`). `HOST` must stay
  `0.0.0.0`; a busy UDP 3000 disables discovery with a warning, never the server.

### Auth (LAN POC model)

`ADMIN_API_KEY` guards all `/api/*` except `/api/health`, and `/dashboard-ws` via
`?key=` (browsers cannot set WS headers). Unset = open mode with a boot warning —
tested behavior, not an oversight. Agents need no key: the enrollment key was
removed on 2026-10-09 (LAN-only café), and the hello schema strips a leftover
`enrollmentKey` sent by an old APK. Fastify runs with `disableRequestLogging:
true` so WS key params never reach the logs; do not re-enable request logging.

### Installed apps and Meta App IDs

The sideloaded agent reports its non-system packages once per connection (max
512). `catalog.ts` maps package name → Meta App ID from the gitignored
`server/data/app-catalog.json` cache, falling back to five hard-verified
mappings. A manual dashboard correction is stored as a `games` row carrying
`package_name` with id `installed-<sha256(pkg)[0:16]>` and wins over the catalog.

**Never invent a Meta App ID.** Unconfigured games keep `FILL_*` /
`UNCONFIGURED` placeholders, and launches against them are rejected with
`game_meta_app_id_not_configured` (see `docs/blockers.md`). Per-game IDs come
from the catalog; CafeQuest's own Dashboard App ID (`1336716629531597`) comes
from the human via `cafequest.config.json`.

Only CafeQuest's own Meta App ID is baked into `BuildConfig`, from
`cafequest.config.json` (`metaAppId`); the APK no longer reads `.env`. The
server address comes from discovery in **Auto** mode (`Discovery.kt`,
`ServerLocator.kt`) or is typed in **Manual** mode. `SetupValues.kt` holds the
pure merge rules: a blank field keeps the stored value, so saving one field
never wipes another. Usage access needs `adb shell appops set
com.cafequest.agent GET_USAGE_STATS allow` once per headset.

## Conventions

- `§NN` in comments refers to an external project brief that is not in this repo;
  leave those references intact.
- Backend tests: `node:test` + `node:assert/strict`. Dashboard: vitest +
  Testing Library + jsdom (`dashboard/vitest.config.ts` deliberately omits the
  React plugin — vitest 2 and vite 6 types cannot coexist in one config file).
  Agent: JUnit4 unit tests, plus instrumented tests under `app/src/androidTest`.
- `store.ts` owns every SQL statement; snake_case columns map to camelCase row
  types in `server/src/types.ts`. Schema changes go in `db.ts` as additive,
  idempotent steps (`CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` guard then
  `ALTER TABLE`) since POC databases are never recreated.
- Hardware behavior is unverified by design; record results in
  `docs/poc-test-results.md` and keep `docs/known-limitations.md` honest rather
  than quietly claiming a path works.
- UI text lives in `dashboard/src/messages.tsx` and
  `quest-agent/.../AgentStrings.kt`, English and Turkish side by side; a string
  without its Turkish twin does not compile. Turkish phrases never suffix a
  device or game name ("Quest 02'yi" vs "Quest 01'i"): put the name before
  "için" or before a suffixed noun. The dashboard test "leaves no English on a
  Turkish card" catches hard-coded English in `DeviceCard`.
