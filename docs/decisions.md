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

## Installed apps launch by Android package ID

Decision: launch commands carry exactly one target. A current agent receives an
Android package ID for any app in its reported inventory, including catalog and
manual matches, and resolves the package's Leanback/launcher activity. A
catalog/manual numeric Meta App ID remains the fallback for older agents.

The package target is an additive protocol-v1 capability. Agent 0.4 advertises
`launch_android_package` in its hello; an older connected agent receives an
immediate `agent_update_required` response instead of a command it would ignore.

Reason: a locally installed app must not be blocked by missing or failing Meta
entitlement checks. The community GitHub catalog remains valuable for
identifying official apps and preserving a compatibility fallback.

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

## Headsets find the server by UDP probe

Decision: in **Auto** mode the agent broadcasts `{"type":"cafequest_discover"}`
to UDP 3000 and the server answers the sender with its name and live HTTP port
(`server/src/discovery.ts`, `quest-agent/.../Discovery.kt`). The agent searches
when no address is saved and before every retry after 3 failed connects, and
then accepts only the remembered PC name. **Manual** mode keeps a typed address
and never searches. `CAFE_PC_LAN_HOST` and the baked `PORT` are gone; this
supersedes the host/port part of "Agent setup defaults are baked in at build
time" (the Meta App ID is still baked).

Reason: the café PC's IP comes from the router. A baked or typed address went
stale whenever it changed, and fixing it meant retyping it on eight headsets.
mDNS needed an npm dependency and Android's callback-heavy `NsdManager`, and
multicast is filtered by more access points than broadcast; a subnet sweep
assumed /24 and port 3000. The reply's source address is the IP that works even
when the PC has several interfaces. Spec:
`docs/superpowers/specs/2026-10-09-server-discovery-design.md`.

## No enrollment key

Decision: `DEVICE_ENROLLMENT_KEY`, `hello.enrollmentKey`, `ENROLLMENT_REJECTED`
and the setup screen's key field are removed. The server's hello schema strips
unknown keys, so a 0.2.0 agent that still sends one is accepted. `ADMIN_API_KEY`
stays.

Reason: CafeQuest runs only on the café's own LAN and is never published, so the
key protected nothing real while costing a setup field and a way for a headset
to fail enrollment.

## Live support view: MediaProjection capture plus direct WebRTC

Decision: the one-headset support view (protocol capability `screen_cast_v1`)
captures the Quest screen with `MediaProjection` + `ScreenCapturerAndroid`
(`io.getstream:stream-webrtc-android:1.3.9`) and sends it straight to the
dashboard browser over a direct `RTCPeerConnection` with an **empty ICE-server
list**. The server relays offer/answer/ICE on `/cast-ws` and tells the agent to
start or stop; it never receives or stores media, and no SDP or ICE value
ever reaches its logs or files. Every session needs a fresh Quest consent
result.

Reason: the media path is the part that cannot scale on a café PC, and a direct
LAN peer connection keeps the server stateless and cheap (no SFU, no encoding,
no cloud service, no TURN credentials). Host candidates are enough because the
headset and the dashboard are on the same subnet. MediaProjection is the only
API that can capture the whole screen on a Quest, and Android grants it per
session: caching a grant would mean the café could watch a headset without
anyone approving, so the dialog stays a hard gate per request. Specs:
`docs/superpowers/specs/2026-10-09-screen-casting-design.md`,
`docs/superpowers/plans/2026-10-09-screen-casting.md`.

## Live support view: one global video-only stream

Decision: exactly one cast session exists at a time (`CastCoordinator` keeps it
in memory: reservation, viewer binding, timeouts, live state), exactly one
viewer may bind it (second socket → 4409), and the profile is video-only at
960×540 / 15 FPS / 1.5 Mbps. No audio, recording, screenshots, multi-headset
streaming, or queueing: a second request while a session is active is refused
with `CAST_BUSY` (409). Cleanup is one idempotent terminal path shared by
viewer close, `DELETE`, timeout, agent replacement/disconnect, projection
revocation and server shutdown.

Reason: the support view exists so staff can help one customer, not to run a
control room; a single in-memory session cannot leak into SQLite, queues or
stale state, and a bounded video profile keeps the cost predictable on a share
of the café's Wi-Fi and the headset's battery. "Busy" is a clearer answer for
staff than a queue whose owner may already be gone.

## Headset identity survives app-data loss and reinstall

Decision: the agent derives its protocol UUID from Android's app-signing-key,
user and device-scoped `ANDROID_ID`, namespaced before it leaves the headset.
An upgraded install also sends its former DataStore UUID as optional
`hello.previousDeviceId`; the server transactionally moves or merges that row,
including sessions, commands and app inventory, while preserving its assigned
name. Older agents remain valid because the hello field is additive.

Reason: a random UUID stored only in DataStore disappears on clear-data or
uninstall, which produced a new card and left the old card stale. Android's
scoped value survives reinstall without exposing a raw device identifier. A
factory reset, another device user or another signing key intentionally creates
a new identity.

## The server owns the headset name, and both sides can rename

Decision: a headset's name lives on the server. After every accepted hello and
every dashboard rename the server sends `device_name {name}` to agents that
advertise `device_name_v1`; the agent stores it and shows it. A name typed on
the headset is sent as `hello.deviceNameSetByStaff: true` until the server
echoes it back, and only then may it rename an existing row. A pending typed
name is never overwritten by a different server name, and the setup field starts
from the server's latest name so an untouched Save never pushes a stale one.
The dashboard card has a Rename control.

Reason: the name previously flowed one way only (headset to server, first
sight), so a rename typed on the headset was silently ignored and the dashboard
had no rename at all. Flagging typed names, rather than always trusting the
agent's, keeps a reinstall's default "Quest XXXX" from clobbering "Quest 01".
Last write wins when both sides rename while disconnected.
