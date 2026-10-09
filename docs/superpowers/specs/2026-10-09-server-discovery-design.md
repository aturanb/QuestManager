# Headsets find the café PC by themselves

Date: 2026-10-09 · Status: approved in conversation, ready for an implementation plan

## Problem

A headset connects to the server at a host and port saved on its setup screen.
The APK bakes a starting host in from `CAFE_PC_LAN_HOST` in `.env`, but the café
PC's IP comes from the router and can change. When it does, every headset keeps
dialing the old address until someone retypes the new one on all eight
headsets (or rebuilds and reinstalls the APK, which is worse).

## Goal and success criteria

The headset app finds the CafeQuest server on the café Wi-Fi without anyone
typing an address, and follows it when its IP changes.

- A fresh install goes Online without touching the host field.
- After the café PC's IP changes, every headset in Auto mode is back Online by
  itself within about 35 s of the server answering at its new address.
- Staff can still type an IP by hand for debugging, and a typed IP stays put.
- Turan's laptop running `npm run dev` on the same Wi-Fi does not steal
  headsets that already know the café PC.

## Decisions

| Topic | Decision |
|---|---|
| Mechanism | Headset broadcasts a UDP probe, server answers it directly (unicast). Chosen over mDNS (npm dependency, clumsy `NsdManager` API, multicast filtered by more access points) and a subnet sweep (crude, assumes /24 and port 3000). |
| Discovery port | UDP 3000, a constant in both code bases, independent of `PORT`. |
| When to search | Auto mode only: right away when no address is saved, and before every retry once 3 connects in a row have failed. |
| Manual IP | Pinned: a Manual headset never searches. Staff leave Manual by switching to Auto (and optionally pressing **Find server**). |
| Several servers | The headset remembers the name of the PC it found and accepts only that name afterwards; with no name remembered, the first answer wins. |
| `CAFE_PC_LAN_HOST` | Removed. The APK no longer reads `.env` at all; baked `PORT` goes too (the reply carries the port, manual entry defaults to 3000). The Meta App ID is still baked from `cafequest.config.json`. |
| Enrollment key | Removed everywhere: server check, protocol field, setup field, simulator flag, `.env`. CafeQuest is LAN-only and never published. |
| Admin key | Unchanged; the dashboard still asks for `ADMIN_API_KEY`. |
| DHCP reservation | Not part of this work. A router setting Turan may add later; discovery makes it optional. |

## Design

### 1. Discovery messages

JSON in a single UDP datagram, at most 512 bytes.

```json
{"type":"cafequest_discover"}
```

Probe, headset → broadcast, destination port 3000.

```json
{"type":"cafequest_server","name":"CAFE-PC","port":3000}
```

Reply, server → the probe's source address and port.

- `name`: the PC's hostname with a trailing `.local` removed, 1–64 characters
  (falls back to `CafeQuest` if the hostname is empty). Shown on the headset
  and used to stay on the same PC.
- `port`: the HTTP/WebSocket port the server is actually listening on (read from
  the live socket, so tests on port 0 and `PORT` overrides report the truth).
- The headset takes the server's IP from the reply's source address. The server
  never has to guess its own LAN IP, and the address is right even when the PC
  has Ethernet plus Wi-Fi or a VPN.
- The server never announces itself unprompted.
- No `protocolVersion` field: a version mismatch is reported by the WebSocket
  hello as today (`UNSUPPORTED_PROTOCOL_VERSION`), which is more informative than
  "no server found".

Source of truth: new `shared/src/discovery.ts` (constants, Zod schemas,
never-throwing parse functions), mirrored by hand in the agent's new
`Discovery.kt`. This is a fourth hand-synced pair next to the WebSocket protocol;
CLAUDE.md lists it.

### 2. Server responder

New `server/src/discovery.ts`, Node `dgram` (`udp4`), no new dependencies.

- Binds `cfg.host` (the same `HOST` as HTTP, `0.0.0.0` by default) on
  `cfg.discoveryPort`. Tests bind `127.0.0.1` on port 0, which keeps the macOS
  firewall out of the test run. `HOST` must stay `0.0.0.0` in production: a
  socket bound to one unicast address does not receive broadcasts on macOS or
  Linux.
- Answers only datagrams that parse as a probe and are ≤ 512 bytes; anything
  else is dropped without a reply. Before HTTP is listening it stays silent.
- Logs each answered probe at info with the sender's IP (no secrets involved).
- Wiring: `buildApp({ discoveryPort?: number })`. Unset = off, so every
  existing test is unaffected. `index.ts` passes `DISCOVERY_PORT` (3000).
  `buildApp` returns `{ app, db, hub, discovery }`; `discovery` is `null` when
  off or when the port was busy, else exposes its bound port. The existing
  `onClose` hook closes it next to `hub.stop()`.
- Port busy (another server on the same PC): warn
  `discovery disabled: UDP <port> unavailable; headsets need a manual IP` and
  keep running.
- PC firewall: inbound UDP 3000 must be allowed next to TCP 3000. Windows'
  "allow node" prompt creates a program rule that covers both; a hand-made
  TCP-only port rule does not.

### 3. Headset: searching, choosing, reconnecting

**Search** (`Discovery.kt`, class `ServerDiscovery`):

- One `DatagramSocket` on an ephemeral port with `broadcast = true`.
- Sends the probe 3 times (0, 0.4, 0.8 s) to every target: `255.255.255.255`
  plus the Wi-Fi subnet's directed broadcast (computed from
  `ConnectivityManager.getLinkProperties(activeNetwork).linkAddresses`; covers
  access points that drop the all-ones broadcast).
- Collects replies until 1.5 s after the first send, ignores anything that does
  not parse, and dedupes by IP and port, keeping arrival order.
- Any exception (Wi-Fi off, no route) returns an empty list; it never crashes
  the agent.
- No new permissions: `INTERNET` and `ACCESS_NETWORK_STATE` are already
  declared, and replies are unicast so no `MulticastLock` is needed.
- Targets are injected (`() -> List<InetAddress>`), so a JVM unit test can run a
  real search against a fake responder on `127.0.0.1`.

**Choose** (pure): `chooseServer(found, rememberedName)`:

- remembered name set → the first server with that name, else `null` (stay on
  the saved address and retry later);
- nothing remembered → the first server found, or `null` if none.

Consequence: a renamed or replaced café PC needs **Find server** once per
headset. A fresh install with two servers answering takes whichever answered
first.

**When** (pure): `shouldSearch(mode, savedHost, failedAttempts)` is true only in
Auto mode, when `savedHost` is blank or `failedAttempts >= 3`.

**Connection loop** (`AgentConnection`):

- Holds the server it dials in a mutable `target` (name, host, port, mode)
  instead of the fixed `identity` fields.
- Before each connect: if `shouldSearch(...)`, set state `SEARCHING`, run a
  search, choose; if the choice differs from `target`, persist it
  (`IdentityStore.saveDiscovered`) and dial it now.
- With no address at all after a search, skip the connect and back off as if it
  failed.
- Backoff schedule is unchanged (1, 2, 5, 10, 30 s…). After 3 failures every
  retry starts with a search, so in steady state a headset searches about every
  30 s until it finds the server.
- OkHttp `connectTimeout` drops from the default 10 s to 3 s: a LAN connect
  takes milliseconds, and a vanished old IP would otherwise cost 10 s a try.
- Publishes `target` to `AgentDiagnostics` whenever it is set or changes.

### 4. Headset: screens and stored setup

**Stored setup** (DataStore, `Identity.kt`, rules in `SetupValues.kt`):

- New keys `server_mode` (`auto` | `manual`; missing or junk = `auto`) and
  `server_name` (remembered PC name).
- `AgentIdentity` gains `serverMode` and `serverName` and loses `enrollmentKey`;
  `serverHost` is `""` when nothing is saved (fresh install), `serverPort`
  defaults to 3000.
- An upgrade from the current APK keeps its saved host and reads as Auto, so the
  headsets already in the café start healing themselves after the update.
- The old `enrollment_key` preference is left in DataStore and never read.

**Merge rules on Save** (`mergeSetup`, pure):

- Device name and Meta App ID: blank keeps the stored value, as today.
- Manual: host and port from the fields, blank (or unparseable port) keeps the
  stored value; the remembered name is kept for a later switch back to Auto.
- Auto with a server picked by **Find server**: host, port and name from it.
- Auto without a pick: keep the stored host, port and name. If the headset was
  Manual before, clear the host instead so the agent searches immediately on
  reconnect.

**Diagnostics screen:**

- New `ConnState.SEARCHING` → word "Searching for server…" / "Sunucu
  aranıyor…", caption "Looking for the café PC on this Wi-Fi." / "Kafe
  bilgisayarı bu Wi-Fi ağında aranıyor.", same `WAITING` tone as Connecting.
- Server row reads from the diagnostics state (falls back to the stored identity
  before the service publishes):
  `CAFE-PC · 192.168.1.150:3000 · Auto`, `192.168.1.77:3000 · Manual`, or
  "Not found yet" / "Henüz bulunamadı". The mode word is the switch's own label
  (`Otomatik` / `Manuel` in Turkish); the PC name shows only in Auto.

**Setup screen:**

- Enrollment key field removed. Hint becomes "A field left blank keeps its saved
  value." (the APK no longer reads the café PC's `.env`).
- Server row: an `Auto | Manual` switch drawn like the `EN | TR` switch (the two
  share one composable).
  - Auto: the current or picked server as text, and a **Find server** button.
    It searches (button reads "Searching…"), then: one server → picked; several
    → a list, tap to pick; none → "No server found. Is this headset on the café
    PC's Wi-Fi? Is UDP port 3000 open in the PC's firewall?" A pick is applied by
    **Save and connect**, like every other field.
  - Manual: today's host and port fields (port prefilled 3000).
- All new text lands in `AgentStrings` in English and Turkish; Turkish keeps
  names and addresses unsuffixed ("UDP 3000 portu", not "UDP 3000'e").
- Agent version bumps to 0.3.0 (versionCode 3), so the diagnostics header shows
  which headsets carry the new APK.

### 5. Removals

**Enrollment key:**

- `shared`: `enrollmentKey` leaves `HelloSchema`; `ENROLLMENT_REJECTED` leaves
  the server error codes. `z.object` strips unknown keys, so an old APK that
  still sends a key is accepted (pinned by a test).
- `server`: `deviceEnrollmentKey` config, `isEnrolled`, the open-enrollment boot
  warning, the reject path and its close code 4401 on `/agent-ws`.
- `quest-agent`: `Hello.enrollmentKey`, the setup field and its strings,
  `AgentIdentity.enrollmentKey`, `BuildConfig.DEFAULT_ENROLLMENT_KEY`.
- `quest-simulator`: `--enrollment-key`, `CAFEQUEST_ENROLLMENT_KEY`,
  `DeviceSimOptions.enrollmentKey`.
- `.env`, `.env.example`: `DEVICE_ENROLLMENT_KEY`.

**Baked server address:**

- `quest-agent/app/build.gradle.kts`: `envValue()`, `DEFAULT_SERVER_HOST`
  (with its invented `192.168.1.50` fallback), `DEFAULT_SERVER_PORT`.
  `AgentSetupDefaults` keeps only `metaAppId`.
- `.env`, `.env.example`: `CAFE_PC_LAN_HOST` and its comment.

### 6. Testing

- `shared` (node:test): probe and reply parsing — valid, junk, non-object,
  wrong type, empty or 65-character name, port 0 or 65536; hello without a key;
  an old hello with a key parses and drops it.
- `server` (node:test), new `discovery.test.ts` with real UDP on `127.0.0.1`,
  port 0: a probe gets `{ type, name: serverDisplayName(), port: <HTTP port> }`;
  junk and oversize datagrams get silence; a busy port leaves the app serving
  `/api/health` with `discovery === null` and the warning logged; `app.close()`
  frees the UDP port. `serverDisplayName` unit cases (`.local` stripped, 64-char
  cap, empty fallback). `security.test.ts` loses the enrollment cases and gains
  "agents need no key; a leftover key is ignored"; the log-leak test keeps the
  admin key.
- `quest-agent` (JUnit, JVM): probe encoding, reply parsing, `chooseServer`,
  `shouldSearch`, directed-broadcast math, a real `ServerDiscovery.search()`
  against a fake responder on loopback (dedupe, junk ignored, empty on timeout),
  merge and resolve rules with modes (pin, upgrade → Auto, Manual → Auto clears
  host, pick wins), `linkStatus` for `SEARCHING`, the server summary line in
  both languages. The `AgentStrings` interface keeps forcing EN/TR parity.
- `quest-simulator` e2e: stays green without a key.
- Hardware (unverified until run): new morning-test rows and `NOT TESTED` rows
  in `docs/poc-test-results.md` for: fresh install Online with no typing; PC IP
  change healed within ~35 s; **Find server** lists the PC; a Manual headset
  stays on its IP through a server restart.

### 7. Docs

- `CLAUDE.md`: diagram shows UDP 3000 discovery; Auth is admin key only;
  discovery listed as a hand-synced pair; the BuildConfig paragraph covers only
  the Meta App ID; simulator command without `--enrollment-key`; "network"
  sentence becomes "internet" (the responder only answers LAN probes).
- `docs/architecture.md`: diagram, new "Server discovery" section, Auth section.
- `docs/quest-setup.md`: Auto by default, Manual for debugging, firewall UDP
  3000, "No server found" troubleshooting; enrollment rows go.
- `docs/morning-test.md`: setup steps without keys or IP lookup; new discovery
  rows; troubleshooting.
- `README.md`: quick start and the setup-defaults table.
- `docs/known-limitations.md`: no agent authentication (any LAN device can
  connect as a headset); discovery needs the same subnet and an access point
  that passes broadcast; renamed PC needs **Find server**; first answer wins on
  a fresh install with two servers; `HOST` must stay `0.0.0.0`.
- `docs/decisions.md`: two appended entries (UDP discovery; no enrollment key).
  The log stays append-only; the new entries note what they supersede.
- `docs/poc-test-results.md`: new `NOT TESTED` rows only; past results stay as
  recorded.

## Out of scope

- DHCP reservation on the router.
- Removing `ADMIN_API_KEY`.
- mDNS/Bonjour, a subnet sweep, or the server announcing itself.
- Discovery in the simulator (it runs on the café PC and keeps `--url`).
- Showing the PC's LAN IP on the dashboard.
