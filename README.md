# CafeQuest

Proof-of-concept management system for a VR café running Meta Quest headsets:
real-time headset status (online/offline, battery, charging), session timers,
and remote game launching — from a web dashboard on the café PC.

## Quick start

```bash
npm install
cp .env.example .env # then replace both change-me keys
npm run catalog:update # cache the community package/App-ID catalog locally
npm run dev          # starts server (port 3000) + dashboard (port 5173)
npm run simulator -- --count 8   # separate terminal: 8 simulated headsets
npm test
```

The server automatically loads the repository-root `.env`. Values exported in
the shell take precedence over values in that file.

`catalog:update` and the dashboard's **Update app list** button are the only
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

The headset's Meta App ID initializes the Meta SDK and is different from the
per-game target IDs.

Foreground-game reporting needs one grant per headset, since Android does not
let the user approve `PACKAGE_USAGE_STATS` from inside the app:

```bash
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow
```

The private agent reports its non-system installed packages when it connects.
The dashboard matches those package names to the local catalog and lists them
under **Installed on this headset** in each card's game picker. Unknown packages
remain visible and can be assigned a numeric Meta App ID from the dashboard;
that correction is stored in SQLite. An offline card offers **Remove headset**
to clear stale headsets off the board.

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
- [docs/architecture.md](docs/architecture.md) — components, semantics, auth model
- [docs/quest-setup.md](docs/quest-setup.md) — per-headset install + config
- [docs/poc-test-results.md](docs/poc-test-results.md) — hardware results sheet (all NOT TESTED)
- [docs/known-limitations.md](docs/known-limitations.md) — what this POC does not do
- [docs/blockers.md](docs/blockers.md) — external blockers + human actions
