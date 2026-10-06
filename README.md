# CafeQuest

Proof-of-concept management system for a VR café running Meta Quest headsets:
real-time headset status (online/offline, battery, charging), session timers,
and remote game launching — from a web dashboard on the café PC.

## Quick start

```bash
npm install
npm run dev          # starts server (port 3000) + dashboard (port 5173)
npm run simulator -- --count 8   # separate terminal: 8 simulated headsets
npm test
```

## The only two things you must fill in (hardware day)

Open [cafequest.config.example.json](cafequest.config.example.json), copy it to
`cafequest.config.json`, and fill in exactly two values:

1. `"metaAppId"` — your Meta Horizon Developer Dashboard App ID (Dashboard → My Apps → your app → Development → API → App ID).
2. `"questServerUrl"` — the café PC's LAN address the Quest agent should connect to, e.g. `http://192.168.1.50:3000`.

Everything else (game list, per-game Meta App IDs) can be edited later in the same file.

## Packages

| Path | What it is |
|---|---|
| [shared/](shared/) | Zod device-protocol schemas shared by server + simulator |
| [server/](server/) | Fastify + SQLite backend: WebSocket device hub, REST API, sessions |
| [quest-simulator/](quest-simulator/) | Simulated Quest agents for testing without hardware |
| [dashboard/](dashboard/) | Café staff web dashboard (lands in a later pass) |
| [quest-agent/](quest-agent/) | Android agent APK for the headsets (lands in a later pass) |

## Docs

- [docs/decisions.md](docs/decisions.md) — implementation decisions log
- [docs/meta-research.md](docs/meta-research.md) — verified current Meta launch API research
- [docs/morning-test.md](docs/morning-test.md) — the 10-minute physical test plan (lands with the agent pass)
