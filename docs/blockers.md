# Blockers

## Meta Platform runtime initialization

Status: OPTIONAL_LEGACY_FALLBACK

Reason: current agents launch reported installed apps by Android package and do
not require per-game Meta App IDs. The legacy `launchOtherApp` fallback still
needs a Meta Horizon Developer Dashboard App ID and real per-game Meta App IDs;
the repository intentionally holds only `FILL_*` placeholders (§19 — never
invent IDs).

Work completed:
- launch abstraction + ownership-checked command pipeline on the server
- `FakeAppLauncher`-equivalent behavior in quest-simulator (`--behavior`)
- configuration supported via cafequest.config.json
- placeholder launches rejected with `game_meta_app_id_not_configured`

Legacy fallback setup (only when supporting older agents):
1. Create a Meta developer app and record its Dashboard App ID in
   `cafequest.config.json` → `metaAppId`.
2. Enter that same CafeQuest Dashboard App ID in every headset's CafeQuest
   setup screen; the Android agent cannot read the café PC's JSON file.
3. Put each target game's real Meta App ID in the same JSON file.
4. Rebuild/reinstall the agent and run Tests 3–10 from `docs/morning-test.md`.
