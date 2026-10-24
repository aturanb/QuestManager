# CafeQuest

Proof-of-concept management system for a VR café running Meta Quest headsets:
real-time headset status (online/offline, battery, charging), session timers,
and remote game launching — from a web dashboard on the café PC.

## Quick start

```bash
npm install
cp .env.example .env # then replace the change-me admin key
npm run catalog:update # optional: identify official Meta apps automatically
npm run dev          # starts server (port 3000) + dashboard (port 5173)
npm run simulator -- --count 8   # separate terminal: 8 simulated headsets
npm test
```

The server automatically loads the repository-root `.env`. Values exported in
the shell take precedence over values in that file.

### Café PC (Windows)

Double-click [scripts/windows/start-cafequest.cmd](scripts/windows/start-cafequest.cmd).
It builds, starts the server and the built dashboard (`vite preview`, same
ports and proxy as `npm run dev`) in two minimized windows, and opens
`http://localhost:5173`. Each window restarts its process 5 s after it stops
and records that in `logs/restarts.log`; close both windows to stop CafeQuest.
Run it again after pulling changes so they are rebuilt, and run `npm install`
first when dependencies changed. Run
[scripts/windows/install-shortcuts.cmd](scripts/windows/install-shortcuts.cmd)
once to add Desktop and Startup shortcuts, so CafeQuest starts when that
Windows user signs in. Root `npm run dev` is POSIX-only: `cmd.exe` runs its
`&` commands one after another, so it never gets past the server.

### Older iPads (iOS 12)

The dashboard build targets Safari/iOS 12, including the first-generation iPad
Air. Use the **built dashboard**, since Vite's development server requires a
newer browser. The Windows launcher above already builds and serves it. After
updating the code, close the two CafeQuest process windows and run the launcher
again to rebuild.

For a manual setup, keep the backend running and run:

```bash
npm run build -w dashboard
npm run preview -w dashboard
```

Connect the iPad to the café Wi-Fi and open
`http://<cafe-PC-LAN-IP>:5173` in Safari. Use the café PC's actual local IP;
`localhost` on the iPad refers to the iPad itself. The PC must allow inbound TCP
5173 from the café LAN. A blank page can indicate an outdated dashboard build;
a Safari connection error requires checking the address, Wi-Fi, and firewall.
After it loads, Safari's **Share → Add to Home Screen** gives staff a convenient
shortcut. Verify sessions, game launching, and notes on the physical iPad before
using it for a shift; live-view playback and capacity also need device testing.

The catalog is optional for sideloaded apps: CafeQuest can list and launch them
directly by Android package ID. `catalog:update` and the dashboard's **Update
app list** button enrich official apps with their names and numeric Meta App
IDs, and are the only
things that contact the community catalog ([threethan/MetaMetadata], refreshed
daily upstream, ~18k apps). Both run the same code path
(`server/src/catalog-refresh.ts`): validate, then replace `server/data/app-catalog.json`
atomically. A failed refresh leaves the previous mappings in place. The file is
gitignored and read locally; the button reloads it without restarting the
server. If it is absent, CafeQuest still knows the five verified fallback
mappings documented in `server/src/catalog.ts`.

[threethan/MetaMetadata]: https://github.com/threethan/MetaMetadata

## Hardware configuration

Open [cafequest.config.example.json](cafequest.config.example.json), copy it to
`cafequest.config.json`. Current agents launch apps reported by the headset
directly by Android package, so per-game `FILL_*` Meta App IDs are not required
for the normal launch path. Replace them only if older agents must use Meta's
legacy `launchOtherApp` fallback.

A freshly installed headset needs no typing. It finds the café PC on the Wi-Fi
by itself and follows it when the PC's IP changes ([server
discovery](docs/architecture.md#server-discovery)); the PC firewall must allow
inbound TCP 3000 and UDP 3000. The top-level `metaAppId` in
`cafequest.config.json` is baked into the APK for the legacy Meta launch path;
change it and rebuild when that fallback is required.

For debugging, the setup screen's **Manual** mode dials a typed host and port
and never searches. Only the device name is worth setting per headset, and the
dashboard can rename a headset instead. On the setup screen, a field left blank
keeps the value already stored, so editing one field never clears the others.

The headset's Meta App ID initializes the legacy Meta launcher and is different
from the optional per-game target IDs.

Foreground-game reporting needs one grant per headset, since Android does not
let the user approve `PACKAGE_USAGE_STATS` from inside the app:

```bash
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow
```

The private agent reports its non-system installed packages, including
CafeQuest itself, when it connects. The dashboard lists every package under
**Installed on this headset** and exposes both identifier types under
**Installed app IDs**. Current agents launch every reported installed app
directly by Android package ID, avoiding Meta entitlement checks. Catalog and
manual Meta App IDs identify official apps and remain a launch fallback for
older agents. Staff can add an optional mapping from the dashboard; it is
stored in SQLite. An offline card offers **Remove headset** to clear stale
headsets off the board.

## Arrange headset cards

Drag the six-dot handle at the top right of a headset card onto another card to
change its position. The arrow buttons work by tap or click; with the handle
focused, arrow keys also move the card earlier or later. The header summary
follows the same order. Your arrangement is saved in this browser and survives
reloads and live updates; new headsets appear at the end.

## Shared café notes

Open **Notes** in the top navigation to record game purchases, headset details,
or reminders on its own page (`/#/notes`). Add, edit, search, and delete notes there; press **Add note** or
**Save changes** to save. Notes are shared across admin browsers and stored in the
server's SQLite database, so they survive browser refreshes and server restarts
when using the same database. The page and navigation support English and Turkish;
switching between **Headsets** and **Notes** keeps unsaved note drafts.

## Live support view

Staff can watch several headsets at once while helping customers: press **Request live
view** on a card and the headset shows **Share screen with café staff**, which
opens Quest's own per-session screen-sharing consent. Approving starts a live
view in a floating dashboard panel (**Stop live view** ends it, as does the headset's
**Stop sharing**).

Each headset has one stream and one viewer. Multiple headset views share a
scrollable dock, with separate minimize, fullscreen, retry, and stop controls.
Stopping one view leaves the others running; game-reopen prompts are shown one
at a time for the correct headset. Streaming remains video only (no audio,
recording, or screenshots), and the video travels directly between the
headset and the browser over the café LAN — WebRTC with no STUN/TURN/SFU and no
cloud service. The server only relays session setup (offer/answer/ICE) and keeps
nothing: no SDP, ICE, or media ever reaches SQLite, files, or logs. Quest's
consent dialog is required for every session and Developer Mode does not bypass
it, so a headset is never watchable without someone approving on it. Both
devices must be on the same subnet. The existing casting-capable APK needs no
update for multiple headset views; deploy the updated server and dashboard
together. Test simultaneous playback on café hardware to establish Wi-Fi and
browser capacity. Details in
[docs/architecture.md](docs/architecture.md#live-support-view-screen_cast_v1).

## Controller batteries (optional)

The dashboard header has one **Controller batteries** switch. It is **off by
default**; turning it on makes the server read the left/right Touch controller
levels of connected headsets over wireless ADB and shows compact `L 100%` /
`R 80%` badges beside the headset battery. It reads
`adb shell dumpsys OVRRemoteService`, which Horizon OS may change at any update,
so a changed format only ever means "controller batteries unavailable" — never a
broken headset.

It needs two one-time steps per headset (docs/quest-setup.md): grant the agent
`WRITE_SECURE_SETTINGS` over USB, and authorize the café PC's adb key (the USB
"Always allow" prompt). With the switch on, the agent turns Horizon OS Wireless
Debugging on by itself and the server finds the port over mDNS, so there is no
`adb tcpip` and no USB after a reboot. After a headset reboot, open CafeQuest
and tap **Allow** once on the "Allow wireless debugging on this network?"
dialog. A headset that already has `adb tcpip 5555` running keeps working.
Turning the switch off turns Wireless Debugging back off where CafeQuest turned
it on. Nothing about this feature can affect online status, sessions, or game
launching, and controller readings are never stored: they live in memory and
are refreshed after every server start.

## Packages

| Path | What it is |
|---|---|
| [shared/](shared/) | Zod device-protocol schemas shared by server + simulator |
| [server/](server/) | Fastify + SQLite backend: WebSocket device hub, REST API, sessions |
| [quest-simulator/](quest-simulator/) | Simulated Quest agents for testing without hardware |
| [dashboard/](dashboard/) | React+Vite staff dashboard: 8-headset grid, sessions, launch control |
| [quest-agent/](quest-agent/) | Kotlin Android agent APK for the headsets |

## Docs

- [docs/decisions.md](docs/decisions.md) — implementation decisions log
- [docs/meta-research.md](docs/meta-research.md) — verified current Meta launch API research
- [docs/morning-test.md](docs/morning-test.md) — the 10-minute physical test plan
- [docs/architecture.md](docs/architecture.md) — components, semantics, server discovery, auth model
- [docs/quest-setup.md](docs/quest-setup.md) — per-headset install + config
- [docs/live-view-testing.md](docs/live-view-testing.md) — how to test the live support view (automated + physical)
- [docs/poc-test-results.md](docs/poc-test-results.md) — hardware results sheet (all NOT TESTED)
- [docs/known-limitations.md](docs/known-limitations.md) — what this POC does not do
- [docs/blockers.md](docs/blockers.md) — external blockers + human actions
