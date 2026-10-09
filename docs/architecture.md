# CafeQuest Architecture

## Pieces

```text
Browser (dashboard :5173, React+Vite)
  │  REST /api/* (Bearer ADMIN_API_KEY) + WS /dashboard-ws?key=
  ▼
Server :3000 (Fastify + better-sqlite3, server/src)
  │  app.ts      HTTP + WS routes, auth gates, hello/enrollment check
  │  hub.ts      live sockets, command lifecycle, sweeps, snapshots
  │  store.ts    all SQL (devices/games/device apps/sessions/commands)
  │  catalog.ts  local package-name to Meta App ID cache + verified fallbacks
  │  config.ts   cafequest.config.json loading + non-clobbering seed
  │  auth.ts     ADMIN_API_KEY / DEVICE_ENROLLMENT_KEY checks
  │  WS /agent-ws (hello.enrollmentKey)
  ▼
Agents: quest-simulator (test) or quest-agent APK (hardware)
```

## Key semantics

- **Online** = `now - lastSeenAt <= 15s` (§15), evaluated by a 1s server sweep.
  Any agent message refreshes `lastSeenAt`, and so does the pong to the hub's 5s
  WebSocket ping: a headset that stops sending telemetry stays online while its
  socket still answers.
- **expectedCurrentGame** = the last game CafeQuest successfully asked to launch (§18).
  We never claim to know the true foreground app.
- **Command lifecycle**: `sent → received → success|failed`, else `timeout` after 10s (§21).
  Acks/results carry the sender's `deviceId` and are ownership-checked; duplicates
  and late results are ignored, never regress a terminal state. Duplicate
  connections: newest hello wins, the old socket gets `DUPLICATE_DEVICE` + close 4001.
- **Sessions**: server clock authoritative; `remaining = endsAt - serverTime` (§26).
  The dashboard compensates skew with `serverTime - Date.now()`. Expiry never
  touches the headset (§27). An unlimited session (`minutes: null`) has
  `endsAt: null` while it runs: it counts up, never expires and cannot be
  extended. Stopping it records the real end, and it stays in the snapshot
  (`status: "stopped"`) until the next session, so staff can read the time to
  charge.
- **HTTP 202 is not proof of launch** — only `command_result: success` is.
- **DB is authoritative after boot**: `cafequest.config.json` seeds missing games and
  upgrades placeholder App IDs, but never overwrites real values staff set.
- **Installed app discovery**: the private sideloaded Android agent uses
  `QUERY_ALL_PACKAGES`, filters out system packages and itself, and reports at
  most 512 entries once per WebSocket connection. The server drops a few Meta
  system components that arrive as user packages (`IGNORED_PACKAGES` in
  `installed-apps.ts`), persists the rest of each device inventory and matches
  it against a local, gitignored catalog cache. Manual package-to-App-ID
  corrections override community matches.

## Language (EN / TR)

The dashboard header and the headset app each have an EN | TR switch. The pick
is stored where the screen is, not on the server: the browser's
`localStorage["cq-lang"]` and the agent's SharedPreferences (`cafequest_prefs`).
It survives page refreshes and restarts of the browser, server, PC, app and
headset. Until someone picks, the browser's or headset's own language decides.
All UI text sits in `dashboard/src/messages.tsx` (`tr` typed as `Messages`) and
`quest-agent/.../AgentStrings.kt` (both languages implement `AgentStrings`), so
a string missing its Turkish twin fails the build. The dashboard keeps errors
raw and words them at render, so a switch also re-words an error on screen.

## Auth (§35)

LAN-first POC: `ADMIN_API_KEY` guards dashboard REST + WS, `DEVICE_ENROLLMENT_KEY`
gates agent hello. Either unset = open LAN mode with a boot warning (documented,
tested). Request lines are never logged, so WS `?key=` values cannot leak.
