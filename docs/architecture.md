# CafeQuest Architecture

## Pieces

```text
Browser (dashboard :5173, React+Vite)
  │  REST /api/* (Bearer ADMIN_API_KEY) + WS /dashboard-ws?key=
  ▼
Server :3000 (Fastify + better-sqlite3, server/src)
  │  app.ts       HTTP + WS routes, auth gate, hello handshake
  │  hub.ts       live sockets, command lifecycle, sweeps, snapshots
  │  store.ts     all SQL (devices/games/device apps/sessions/commands)
  │  catalog.ts   local package-name to Meta App ID cache + verified fallbacks
  │  config.ts    cafequest.config.json loading + non-clobbering seed
  │  auth.ts      ADMIN_API_KEY checks
  │  discovery.ts UDP 3000: answers headset probes with name + HTTP port
  │  UDP 3000 probe → reply, then WS /agent-ws (hello, no key)
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

LAN-first POC: `ADMIN_API_KEY` guards dashboard REST + WS; unset = open LAN mode
with a boot warning (documented, tested). Agents need no key: the enrollment key
was removed on 2026-10-09 because CafeQuest only ever runs on the café LAN.
Request lines are never logged, so WS `?key=` values cannot leak.
