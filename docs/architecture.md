# CafeQuest Architecture

## Pieces

```text
Browser (dashboard :5173, React+Vite)
  │  REST /api/* (Bearer ADMIN_API_KEY) + WS /dashboard-ws?key=
  │  WS /cast-ws?key=&sessionId=  signaling only; media is peer-to-peer
  ▼
Server :3000 (Fastify + better-sqlite3, server/src)
  │  app.ts       HTTP + WS routes, auth gate, hello handshake
  │  hub.ts       live sockets, command lifecycle, sweeps, snapshots
  │  cast-coordinator.ts  one in-memory live-view session, timeouts, routing
  │  controller-battery.ts  optional ADB poll for Touch controller levels
  │  store.ts     all SQL (devices/games/device apps/sessions/commands)
  │  catalog.ts   local package-name to Meta App ID cache + verified fallbacks
  │  config.ts    cafequest.config.json loading + non-clobbering seed
  │  auth.ts      ADMIN_API_KEY checks
  │  discovery.ts UDP 3000: answers headset probes with name + HTTP port
  │  UDP 3000 probe → reply, then WS /agent-ws (hello, no key)
  ▼
Agents: quest-simulator (test) or quest-agent APK (hardware)
```

The live support view is the one path where media does **not** traverse the
server: the browser and the headset exchange WebRTC offer/answer/ICE through it
and then send video directly over the café LAN.

## Key semantics

- **Online** = `now - lastSeenAt <= 15s` (§15), evaluated by a 1s server sweep.
  Any agent message refreshes `lastSeenAt`, and so does the pong to the hub's 5s
  WebSocket ping: a headset that stops sending telemetry stays online while its
  socket still answers.
- **Headset identity survives reinstall**: the Android agent converts
  `Settings.Secure.ANDROID_ID` into a namespaced protocol UUID. Android scopes
  that source value to the device user and APK signing key, so clearing app
  data or reinstalling the same signed APK reconnects to the same server row.
  On the first upgraded connection, optional `hello.previousDeviceId` moves the
  old random-UUID row and its sessions, commands and app inventory to the stable
  ID. The server keeps the row's staff-assigned name instead of replacing it
  with the fresh install's default name.
- **The server owns the headset's name**: it sends `device_name {name}`
  (capability `device_name_v1`) to a capable agent right after every accepted
  hello and whenever the dashboard renames it, so a reinstalled headset adopts
  "Quest 01" at once and its screen follows a dashboard rename. A name typed on
  the headset's setup screen goes up as `hello.deviceNameSetByStaff: true` and
  is the only agent name that may rename an existing row; the agent clears the
  flag when the server echoes the name back. A fresh install's default name is
  never flagged, so it cannot overwrite a staff name. Renaming on the
  dashboard is `POST /api/devices/:id/rename`.
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
  `QUERY_ALL_PACKAGES`, filters out system packages, and reports at
  most 512 entries once per WebSocket connection. The server drops a few Meta
  system components that arrive as user packages (`IGNORED_PACKAGES` in
  `installed-apps.ts`), persists the rest of each device inventory and matches
  it against a local, gitignored catalog cache. Manual package-to-App-ID
  corrections override community matches.
- **Installed app launch**: a capable agent receives exactly one Android
  package ID for every app in its reported inventory, then resolves the
  Leanback/launcher activity and starts it as a new task. The GitHub catalog
  improves official-app metadata; its Meta App IDs remain a fallback for older
  agents. Protocol-v1 agents advertise the additive `launch_android_package`
  capability; an unmatched package on an older agent returns
  `agent_update_required` instead of sending a command it cannot decode.

## Live support view (`screen_cast_v1`)

Staff can watch one headset's screen on the dashboard while they help a customer.
It is deliberately small: **one stream at a time, one viewer, no audio, no
recording**.

- **Reservation**: `POST /api/casts {deviceId}` fills the single global slot
  (409 `CAST_BUSY` while any session is active, 409 `DEVICE_OFFLINE`/
  `agent_update_required` for a headset that is not connected or is too old to
  advertise the additive `screen_cast_v1` capability, 404 for an unknown
  device). The dashboard stores the returned `sessionId` in memory only.
- **Signaling**: the browser opens `/cast-ws?key=<admin key>&sessionId=<uuid>`
  with the same admin key as the rest of the dashboard. A second socket for the
  same session is closed with 4409; unknown/expired sessions 4404, a bad id
  4400, a missing/wrong key 4401. The server relays `cast_request`,
  `cast_status`, `cast_signal` (offer/answer/ICE) and `cast_stop` and nothing
  else: it rejects binary frames (4400) and never receives, decodes or stores
  media or SDP.
- **Consent is per session**: Quest's own `MediaProjection` dialog is the only
  way to obtain a capture grant, and it must be approved again for every new
  request. The headset shows **Share screen with café staff** first; only that
  tap opens the system dialog. **Developer Mode is not a bypass** — it helps
  installing and debugging the APK, and does nothing about capture consent.
  The one-use result is handed to exactly one publisher and never cached,
  logged, persisted, or reused.
- **Media path**: direct peer-to-peer WebRTC with an empty ICE-server list
  (host candidates on the café LAN). No STUN, no TURN, no SFU, no cloud relay.
  Both peers are on the same subnet, so host candidates are enough.
- **Profile**: 960×540, 15 FPS, `maxBitrateBps` 1.5 Mbps, video only. The
  agent's `AndroidRtcPeer` sets the encoder limits on the sender; there is no
audio track anywhere in the codebase.
- **State**: `CastCoordinator` (`server/src/cast-coordinator.ts`) keeps the one
  session in memory — reservation, viewer binding, approval/negotiation
  timeouts, and the live state. Nothing about a cast is ever written to SQLite,
  files, or logs (the log lines carry only lifecycle words and ids).
- **Cleanup is idempotent** and has one terminal path per cause: viewer closes
  the tab or presses **Stop**, `DELETE /api/casts/:sessionId`, approval or
  negotiation timeout, the agent's socket dropping or being replaced by a
  newer hello, the headset's projection being revoked (system stop) or the
  person pressing **Stop sharing**, and server shutdown — each frees the slot
  and, where a peer still exists, stops capture.
- **Failure is bounded**: statuses are `awaiting_approval | negotiating | live |
  stopped | failed`, and failures carry a stable code (`consent_denied`,
  `approval_timeout`, `negotiation_timeout`, `projection_stopped`,
  `peer_disconnected`, `capture_failed`, `internal_error`). Raw platform or
  exception text never reaches the wire or the UI.

## Optional controller batteries

Horizon OS knows the left/right Touch controller levels but exposes them only
through `dumpsys OVRRemoteService`, so this is best-effort diagnostics over
wireless ADB, off by default:

- **Setting**: one global flag, `controller_battery_monitoring` in the
  `app_settings` table, changed by
  `PUT /api/settings/controller-battery-monitoring {enabled}` (admin key). The
  flag survives restarts; readings do not.
- **Matching**: the collector polls the headset whose live agent socket came
  from the same LAN IPv4 address, normalized at the hello
  (`req.socket.remoteAddress`). The address is in memory only, is never sent to
  a shell (arguments are always argv through `execFile`), and loopback/IPv6/
  malformed values are simply not pollable (`no_wireless_address`). No serial
  number enters the protocol or the database.
- **Enabling ADB**: the agent, not the server, turns Horizon OS Wireless
  Debugging on. The server sends `controller_monitoring {enabled}` (capability
  `controller_monitoring_v1`) at every agent hello and whenever the switch
  flips; the agent writes `Settings.Global adb_wifi_enabled` using a one-time
  `WRITE_SECURE_SETTINGS` grant, asks at most once per boot, and switches it off
  again only if it turned it on. It reports `wirelessDebugging`
  (`on|off|not_permitted`) in telemetry; the server uses it only to explain a
  connect that already failed (`wireless_debugging_off`,
  `agent_permission_missing`).
- **Endpoint discovery**: the TLS port is random per enable and unreadable by an
  app, so each cycle runs one `adb mdns services` and picks, per headset IP,
  `_adb-tls-connect._tcp`, then `_adb._tcp`, then `<ip>:5555`. Only plain IPv4
  `ip:port` values from that listing can become an argument.
- **Cadence**: immediately after enabling, then once per minute, one cycle at a
  time, at most one ADB operation per headset. When an agent first reports
  Wireless Debugging `on`, one early cycle runs about 2 s later (`pollSoon`:
  coalesced, cancelled by switching off, queued behind a cycle already running),
  because the headset needs a moment to advertise its port and the card would
  otherwise show a failure hint until the next interval.
- **Ownership**: only endpoints whose `adb connect` said it *newly* connected
  them are disconnected again when monitoring is turned off or the server
  exits. A session owned by another tool (`already connected`) is read but never
  torn down.
- **Failure boundary**: ADB is outside the liveness, session, and command paths.
  A missing `adb` (or `ADB_PATH`), a refused connect, a failed dump, or changed
  diagnostics text only ever change controller-monitoring state. A failed cycle
  keeps the last values with their old time as `stale`.
- **Public shape**: `controllerBatteryMonitoring: {enabled, availability}` in
  the snapshot plus a per-device `controllerBattery` with bounded status and
  reason codes. Raw ADB output, stderr, endpoints, and serials never reach the
  REST/WebSocket payloads, the logs, or SQLite.

`ADB_PATH` (optional, see `.env.example`) points at a specific `adb` when it is
not on `PATH`. The one-time per-headset setup (the `pm grant` and the USB adb
authorization) is in docs/quest-setup.md.

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
