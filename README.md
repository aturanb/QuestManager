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

## Values you must supply for hardware testing

Open [cafequest.config.example.json](cafequest.config.example.json), copy it to
`cafequest.config.json`, and replace every `FILL_*` game Meta App ID. These IDs
identify the target games passed to Meta's `launchOtherApp` API.

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

The headset's Meta App ID initializes the Meta SDK and is different from the
per-game target IDs.

Foreground-game reporting needs one grant per headset, since Android does not
let the user approve `PACKAGE_USAGE_STATS` from inside the app:

```bash
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow
```

The private agent reports its non-system installed packages, including
CafeQuest itself, when it connects. The dashboard lists every package under
**Installed on this headset** and exposes both identifier types under
**Installed app IDs**. Catalog-matched apps launch through Meta's
`launchOtherApp`; unmatched/sideloaded apps launch directly by Android package
ID and do not need the GitHub catalog. If a package really has a Meta App ID,
staff can still add that optional mapping from the dashboard; it is stored in
SQLite. An offline card offers **Remove headset** to clear stale headsets off
the board.

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
- [docs/poc-test-results.md](docs/poc-test-results.md) — hardware results sheet (all NOT TESTED)
- [docs/known-limitations.md](docs/known-limitations.md) — what this POC does not do
- [docs/blockers.md](docs/blockers.md) — external blockers + human actions
