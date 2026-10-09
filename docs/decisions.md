# CafeQuest Decisions

## Monorepo layout

Decision: npm workspaces with `shared`, `server`, `quest-simulator`, `dashboard`, `quest-agent`.

Reason: Matches brief §11; shared protocol package prevents duplicating message
shapes (§14 "Do not duplicate arbitrary message shapes").

## Configuration file

Decision: `cafequest.config.json` (see example) records the Meta Dashboard App
ID, Quest-side server URL, and the server's game catalog (id, name, metaAppId,
enabled per §19). The Quest persists its operational copy of the server address
and CafeQuest Dashboard App ID in its local setup screen because it cannot read
the café PC's JSON file.

Reason: Game `metaAppId`s stay as obvious placeholders rather than invented IDs
(§19), while the setup documentation makes the required per-headset copy step
explicit.

## Server-side launch without a real agent

Decision: The server persists commands and, when a device is offline at launch
time, records status `queued` instead of failing hard; the queue is delivered on
the device's next WebSocket connection.

Reason: Makes morning testing forgiving (headset connects after dashboard use)
and keeps HTTP 200 from being misread as proof of launch (§21).

## Offline detection

Decision: A device is OFFLINE when `now - lastSeenAt > 15s` (§15), evaluated by
a server sweep every 5s and included in dashboard state pushes.

## Command timeout

Decision: 10 seconds from command sent to `command_result`, else `timeout` (§21).

## Reconnect liveness on hello

Decision: the server refreshes `last_seen_at` when a valid hello arrives
(`touchDevice` in the WS hello branch), not only on telemetry.

Reason: live verification showed reconnecting devices dropped as "stale" by
the 1s offline sweep before their first 5s telemetry arrived (old
`last_seen_at` survived `upsertDevice`). Covered by
`server/tests/ownership.test.ts` ("reconnect with a stale last_seen_at").

## Meta SDK direct-call integration

Decision: `MetaAppLauncher` calls the SDK directly —
`HorizonServiceConnection.connect(appId, context, scope)` then
`Application().launchOtherApp(appId)` — verified by decompiling the published
AARs (`horizon.platform.application.Application`,
`horizon.core.android.driver.coroutines.HorizonServiceConnection`).

Reason: the DI constructor is `internal`; the public no-arg `Application()`
binds the active service connection. Return is a status `String` compared
against the `ApplicationStatusCode` enum names (`Success`,
`TargetAppBlocked`, …).

## kotlinx.serialization wire defaults

Decision: agent `Json { encodeDefaults = true; explicitNulls = false }`.

Reason: the default drops `type`/`protocolVersion` (they have Kotlin
defaults), which the server rejects. Caught by `ProtocolTest` before any
hardware run.

## Android toolchain

Decision: AGP 8.5.2 + Gradle 8.7 + JDK 21 (Temurin), `compileSdk/targetSdk 34`,
`minSdk 29`, Kotlin `jvmTarget 17`.

Reason: JDK 25 (machine default) is unsupported by Gradle 8.x; JDK 21 is
installed alongside. `local.properties` (SDK path) is gitignored.

## Unmanaged overlays do not end a foreground run

Decision: `ForegroundAppTracker` ignores ACTIVITY_RESUMED for a package outside
the device's reported inventory; only ACTIVITY_PAUSED of the current game, a
different managed game resuming, or the package leaving the inventory clears it.

Reason: the Meta universal menu raises `com.oculus.vrshell` over a running game.
Clearing on that reset `startedAt`, so a staff member's menu peek made "open for
12m" jump back to 0:00. Filtering to known packages alone did not fix the reset.

## Catalog refresh is a server route, not just a CLI script

Decision: `server/src/catalog-refresh.ts` owns the one network fetch;
`scripts/update-catalog.mjs` and `POST /api/catalog/refresh` both call it.
`appCatalog` became a mutable binding and `Hub` takes `() => AppCatalog`.

Reason: staff should not need a terminal to pick up a newly released game, and
the refresh must apply without restarting the server mid-shift. A single-flight
lock keeps a double-clicked button to one download; any failure (network, HTTP,
shape, <1000 valid records) leaves the previous cache file untouched.

## Agent setup defaults are baked in at build time

Decision: `app/build.gradle.kts` reads the repo-root `.env`
(`CAFE_PC_LAN_HOST`, `PORT`, `DEVICE_ENROLLMENT_KEY`) and
`cafequest.config.json` (`metaAppId`) into `BuildConfig` fields;
`resolveIdentity` prefers stored values and falls back to them.

Reason: provisioning eight headsets meant typing the same four values eight
times. Reusing files the café PC already maintains avoids a second source of
truth. Gradle re-generates `BuildConfig` when a value changes.

## Blank setup fields keep stored values

Decision: `mergeSetup` treats a blank field as "unchanged"; the setup screen
also prefills the enrollment key instead of starting empty.

Reason: `save()` previously wrote every field unconditionally while the
enrollment key input always rendered blank, so renaming a headset silently
cleared its key and enrollment failed with nothing on screen explaining why.

## Foreground tracking follows a resumed set, not one current app

Decision: `ForegroundAppTracker` keeps a map of managed package → resume time for
every package currently resumed, and reports the most recently resumed one.
`UsageQueryWindow` advances only past events it actually saw.

Reason: both found on a Quest 3 while verifying the feature. Quest keeps the
immersive game and 2D panel apps resumed simultaneously, so a one-second
`com.oculus.igvr` blink overwrote and then cleared a Breachers run that had been
going for minutes. Separately, the launch's ACTIVITY_RESUMED was present in
`dumpsys usagestats` but never returned by a query, because the old window had
already advanced past its timestamp before Android flushed it. Both are covered
by unit tests that reproduce the hardware behavior.

## Pongs prove liveness

Decision: the hub pings every agent socket every 5s, and the pong refreshes
`last_seen_at` (`touchDevice`) like any agent message.

Reason: a connected headset showed Offline for about a second, then Online
again. Whenever the agent's 5s telemetry stops while its socket stays healthy,
the sweep closes the socket at 15s and the agent's 1s-backoff reconnect brings
it back, every ~16s. Reproduced against the real server; the hardware trigger
(suspected: a sleeping headset's telemetry timer freezing) is not verified, see
docs/morning-test.md row 13. OkHttp answers pings by itself, so the agent did
not change. Covered by `server/tests/ownership.test.ts` ("pong proves
liveness").

## Unlimited sessions keep `ends_at` NOT NULL

Decision: `POST /api/devices/:id/sessions` with `{ "minutes": null }` starts an
unlimited session, stored with `open_ended = 1` and `ends_at` set to its start
time until Stop writes when play ended. The API and snapshot report
`endsAt: null` while it runs; the expiry sweep skips it and extend refuses it
(409 `session has no time limit`). A stopped unlimited session stays on the
board until the next session starts; a stopped timed session still clears it.

Reason: staff charge open-ended customers by time played, so the played time
must survive Stop. SQLite cannot drop `NOT NULL` from `ends_at` without
rebuilding the table, and POC migrations are additive, so the flag is a new
column instead. Covered by `server/tests/store.test.ts` and
`server/tests/sessions.test.ts`.
