# CafeQuest POC Results

## Agent-enabled Wireless Debugging, 2026-10-10

Quest model: Quest 3 (adb serial `2G0YC5ZG8106W2`), Horizon OS on Android 14.

### Hardware findings (these decided the design)

| Attempt | Result | Notes |
|---|---|---|
| Agent app runs `dumpsys OVRRemoteService`, `DUMP` granted | FAIL | `PERMISSION_DENIED` from Meta's service even inside the real app process; no SELinux denial logged |
| Other app-readable channels | FAIL | No controller `power_supply` node, `dumpsys externalbattery` empty, no input battery monitor |
| `adb shell setprop persist.adb.tcp.port 5555` | FAIL | `SELinux permission check failed` (`shell` may not set it on this build) |
| `adb_wifi_enabled` left on across a reboot | FAIL | Reset to 0; the "always allow on this network" approval was also lost |
| `settings put global adb_wifi_enabled 1` from the shell, network untrusted | PASS | Raises the "Allow wireless debugging on this network?" dialog; value reads 0 until approved |
| Agent app with `WRITE_SECURE_SETTINGS` sets `adb_wifi_enabled=1`, network trusted | PASS | `before=0 putOk=true after=1`, TLS service appears in `adb mdns services` |
| `adb connect` to the mDNS `_adb-tls-connect._tcp` endpoint with no `adb pair` | PASS | The key already authorized over USB is accepted; `dumpsys` returned Left/Right levels |
| App reading the TLS port (`service.adb.tls.port`) | FAIL | Empty for an app; the server must discover it over mDNS |
| Trust scope | Observed | Stored per access point (BSSID), not per network name; the headset roamed to a second BSSID and asked again |

### Physical check of the implemented feature

Run after Tasks 1-7 are built and the APK is installed
(`adb install -r quest-agent/app/build/outputs/apk/debug/app-debug.apk`).

| Check | Result | Notes |
|---|---|---|
| Grant `WRITE_SECURE_SETTINGS`, turn the switch on, tap Allow, readings appear with no `tcpip` | NOT TESTED | |
| Reboot, open CafeQuest, tap Allow, readings return | NOT TESTED | |
| Deny the dialog: card shows the pending reason and reconnects do not re-prompt | NOT TESTED | |
| Switch off: Wireless Debugging turns off on a headset where the agent enabled it | NOT TESTED | |
| Switch off with Wireless Debugging enabled by hand: it stays on | NOT TESTED | |
| Run without the grant: card shows *One-time setup missing on this headset* | NOT TESTED | |
| Headset with legacy `adb tcpip 5555` and Wireless Debugging off still shows readings | NOT TESTED | |

## Optional controller batteries, 2026-10-09

Quest model: Quest 3 (adb serial `2G0YC5ZG8106W2`), Horizon OS on Android 14
Server version: 0.1.0

### Automated verification (all run on this Mac)

| Check | Result | Notes |
|---|---|---|
| `npm test` | PASS | shared 28, server 130, simulator 11, dashboard 199 — 0 failures |
| `npm run build` | PASS | shared + server + simulator + dashboard |
| `npx tsc -p tsconfig.json` | PASS | whole-repo typecheck, no errors |
| `./gradlew testDebugUnitTest` (JDK 21) | PASS | 132 JVM tests: the Android agent was not touched by this feature |
| `git diff --check` | PASS | silent |
| Parser fixture | PASS | The two real `Paired device` lines from this Quest 3 (`Right` 80%, `Left` 100%, both `Status: Disabled`) parse to left 100/inactive, right 80/inactive |
| No real `adb` in tests | PASS | Every test injects a fake runner; only `ADB_PATH`/`adb` at runtime |

### Stub-`adb` end-to-end check (not a headset test)

The collector was run against a stand-in `adb` (`ADB_PATH`) that answers
`version`, `connect`, `disconnect` and returns the two real `Paired device`
lines above for `dumpsys OVRRemoteService`. Targets were two simulated headsets
(`npm run simulator -- --count 2 --stable --url <café PC LAN IP>`)
whose sockets arrive from the Mac's own LAN IPv4, so address matching, the
one-minute cycle, the API and the dashboard rendering were exercised for real —
only the `adb` binary is fake.

| Check | Result | Notes |
|---|---|---|
| Monitoring off → `controllerBattery: null` | PASS | Cards keep the headset battery only |
| `PUT /api/settings/controller-battery-monitoring {"enabled":true}` | PASS | Returns `{enabled:true, availability:"ready"}`; a cycle then records readings |
| One cycle per minute, no overlap | PASS | `version` → `connect <ip>:5555` → `dumpsys OVRRemoteService`, 60.0 s apart; a cycle that starts with no agent reports `no_devices`, the next one `ready` |
| Readings in the real snapshot | PASS | Both online headsets left 100/`active`, right 80/`inactive`; the six offline rows `unavailable`/`headset_offline` |
| Header switch and card badges | PASS | `role="switch"` named *Controller battery monitoring*, position from the server; online card shows `L 100%` and `R 80%` with the accessible *last known*, offline cards `L —`; inactive/unavailable use a subdued color **and** ARIA text |
| Clicking the switch off then on | PASS | Off removes all 16 badges and every per-card controller group; on restores them with a fresh timestamp; no horizontal overflow at 1280×900 or 390×844 |
| Turkish copy | PASS | *Kontrolcü pili izleme*, *Quest 01 için kontrolcü pilleri*, `son bilinen`, `Güncellendi: 25 sn önce` |
| Setting survives a restart | PASS | Second boot logs *controller battery monitoring restored (enabled)* and probes `adb version` with no toggle click; readings stay empty until the next cycle, so nothing stale is shown |
| Disable disconnects only owned endpoints | PASS | Exactly one `disconnect <ip>:5555` for the shared endpoint; both agents stayed online |

Not covered by this check: the real `adb` binary and USB/TCP transport,
`adb tcpip 5555` on a headset, real ADB latency/timeouts, the missing-`adb`
(`adb_unavailable`) path, and the dashboard's painted appearance — the preview
webview in this environment produced no frames, so the UI evidence above comes
from the accessibility tree and computed styles rather than a screenshot.

### Physical Quest 3 rows

Nothing below has been run: the switch is off by default, and enabling TCP ADB
on the headset (`adb tcpip 5555`) was not authorized in this session.

| Test | Result | Notes |
|---|---|---|
| Enable the switch, badges match `dumpsys OVRRemoteService` | NOT TESTED | morning-test 40 |
| Sleeping controller reads `last known` | NOT TESTED | morning-test 41 |
| Switch off removes badges, everything else keeps working | NOT TESTED | morning-test 42 |
| `adb disconnect` mid-session only affects badges | NOT TESTED | morning-test 43 |
| Missing adb → *ADB unavailable*, recovery without re-toggling | NOT TESTED | morning-test 44 |
| Server restart: switch on, no stale readings | NOT TESTED | morning-test 45 |
| Headset reboot drops TCP ADB, `adb tcpip 5555` restores it | NOT TESTED | morning-test 46 |

---

## Live support view (screen_cast_v1), 2026-10-09

Quest model: Quest 3 (adb serial `2G0YC5ZG8106W2`), Horizon OS on Android 14
(`ro.build.version.sdk` 34)
Agent version: 0.5.0 (versionCode 5)
Server version: 0.1.0

### Automated verification (all run on this Mac)

| Check | Result | Notes |
|---|---|---|
| `npm test` | PASS | shared 28, server 99, simulator 11, dashboard 177 — 0 failures |
| `npm run build` | PASS | shared + server + simulator + dashboard (`tsc` + `vite build`) |
| `npx tsc -p tsconfig.json` | PASS | whole-repo typecheck, no errors |
| `./gradlew testDebugUnitTest` (JDK 21) | PASS | 132 JVM tests, 0 failures |
| `./gradlew assembleDebug` (JDK 21) | PASS | `app-debug.apk`, versionName 0.5.0 |
| `./gradlew connectedDebugAndroidTest` (Quest 3 attached) | PARTIAL | New `MediaProjectionServiceTest` 2/2 PASS, `NetworkSecurityPolicyTest` PASS; `InstalledAppScannerInstrumentedTest` FAILS on a pre-existing self-exclusion assertion (see below) |
| APK manifest (`aapt2 dump xmltree`) | PASS | `.AgentService` declares `foregroundServiceType=0x21` (dataSync\|mediaProjection) |
| Server-side media proof | PASS | `server/tests/casting-routes.test.js`: binary frame never relayed, no SDP/ICE/admin key in logs, zero rows written to SQLite during a live session |

### Physical Quest 3 rows

Not run yet: every row below needs a person to approve Quest's capture dialog
inside the headset, so no row is claimed as passing.

| Test | Result | Notes |
|---|---|---|
| Request appears on the headset + **Share screen with café staff** shown | NOT TESTED | morning-test 20–21 |
| Consent approval → picture on the dashboard ≤ 15 s | NOT TESTED | morning-test 22 |
| Picture during a running game (no black frame) | NOT TESTED | morning-test 23 |
| Resolution / orientation | NOT TESTED | morning-test 24 |
| Latency below ~2 s | NOT TESTED | morning-test 25 |
| 15-minute stability during a game | NOT TESTED | morning-test 26 |
| Battery / thermal / game impact | NOT TESTED | morning-test 27 |
| Dashboard **Stop** cleanup ≤ 3 s | NOT TESTED | morning-test 28 |
| Headset **Stop sharing** | NOT TESTED | morning-test 29 |
| Consent denied | NOT TESTED | morning-test 30 |
| Approval timeout, then a fresh request asks again | NOT TESTED | morning-test 31 |
| Game capture compatibility (`FLAG_SECURE` opt-outs) | NOT TESTED | morning-test 32 |
| Fresh consent on every session | NOT TESTED | morning-test 33 |
| Second stream / second viewer refused while Live | NOT TESTED | morning-test 34 (server side covered by tests) |
| Headset sleep mid-session | NOT TESTED | morning-test 35 |
| Wi-Fi loss mid-session | NOT TESTED | morning-test 36 |
| Dashboard refresh mid-session | NOT TESTED | morning-test 37 |
| Duplicate-device replacement mid-session | NOT TESTED | morning-test 38 (server side covered by tests) |
| App restart mid-session | NOT TESTED | morning-test 39 |

### Instrumented-test finding (pre-existing)

`InstalledAppScannerInstrumentedTest.queryAllPackagesReturnsThirdPartyAppsWithoutCafeQuestItself`
fails on hardware at `assertFalse(apps.any { it.packageName == context.packageName })`:
the scanner filters only system packages, so the sideloaded CafeQuest package is
in its own inventory (the README says so too). The assertion has been in the
test since the original agent commit and the scanner never excluded itself, so
this is a pre-existing red test, untouched by the live-view work.

---

## CafeQuest POC Results (2026-10-08 run)

Quest model: Quest 3 (adb serial `2G0YC5ZG8106W2`)
Quest OS version: not recorded
Agent version: 0.2.0 (versionCode 2)
Server version: 0.1.0
Date: 2026-10-08

| Test | Result | Notes |
|---|---|---|
| Device connects | PASS | Fresh install after `pm clear`: connected with no typing at all, using the APK's baked-in host/port/enrollment key. Enrolled as `Quest D37B`. |
| Online status | PASS | `online: true`, `lastSeenAt` advancing every 5s. |
| Battery telemetry | PASS | 79% → 77% observed across the session. |
| Charging telemetry | PASS | Reported `true` on the cable, `false` after unplugging. |
| Installed app inventory | PASS | 22 third-party packages reported; the community catalog resolved Meta App IDs for 20 of them. |
| Usage access | PASS | `usageAccessGranted: true` after `adb shell appops set com.cafequest.agent GET_USAGE_STATS allow`. |
| Current game detection | PASS | After two bugs fixed (below), the snapshot showed `Breachers` with a stable `startedAt` and a climbing duration (8s → 13s), clearing to none when the game actually paused. |
| Foreground app launch | PASS | `launch-installed` for `com.TriangleFactory.Breachers` → `command_result: success`, game opened on the headset. This is the fix for launches previously reported as failed. |
| Sideloaded Android package launch | NOT TESTED | Package-target protocol, dashboard selection and agent launch routing are unit-tested; physical Quest background launch remains morning-test row 5a. |
| Background heartbeat | PASS | Telemetry kept flowing for minutes while Breachers was the resumed app. |
| Background command reception | PASS | A launch command sent while Breachers was already in the foreground was acked and completed `success`. |
| Catalog refresh | PASS | `GET /api/catalog` reported 18,034 mappings; a live CLI refresh stored 18,100. |
| Sleep/wake recovery | PASS | Repeated idle-sleep and wake cycles: agent stayed online, and foreground reporting recovered on each wake with a fresh `startedAt`. |
| Game A -> Game B switch | NOT TESTED | Only Breachers was launched; no second entitled game was exercised. |
| Wi-Fi reconnect | NOT TESTED | Airplane-mode cycle not performed. |
| Session tracking | NOT TESTED on hardware | Covered by the simulator e2e test only. |
| Reboot recovery | NOT TESTED | No BOOT_COMPLETED receiver exists; the agent currently starts when CafeQuest is opened. |
| Headset app in Turkish | NOT TESTED | EN/TR switch and SharedPreferences pick built and JVM unit-tested; this APK has not been installed on a Quest yet (morning-test row 15). |
| Server discovery (fresh install) | NOT TESTED | UDP probe/reply built and tested on loopback (server and agent JVM tests); not yet run on a Quest or through the café access point (morning-test row 16). |
| Find server button | NOT TESTED | Morning-test row 17. |
| PC IP change healing | NOT TESTED | Agent searches before every retry after 3 failed connects; morning-test row 18. |
| Manual IP stays pinned | NOT TESTED | Unit-tested rule (Manual never searches); morning-test row 19. |

## Bugs found during this hardware run

Both were in the foreground-detection path and are now covered by unit tests
that reproduce the hardware behavior.

1. **Query window stepped over its own events.** The reader advanced
   `queryFromMs` to `now + 1` after every poll. Android flushes usage events in
   batches, so the launch's ACTIVITY_RESUMED (19:20:50, visible in
   `dumpsys usagestats`) was never inside a query window and was lost for good.
   `UsageQueryWindow` now advances only past events it actually saw.
2. **One "current app" slot cannot model Quest.** Quest keeps the immersive game
   and 2D panel apps resumed at the same time. `com.oculus.igvr` (Instagram, a
   third-party package in the inventory) resumed at 19:24:04 and paused at
   19:24:05; that one-second blink overwrote and then cleared a Breachers run
   that had been going since 19:20:50. The tracker now keeps the set of resumed
   managed packages and reports the most recently resumed one still resumed.

## Reported after this run (2026-10-09)

- **Online flickered off for ~1s at a time** while the headset was connected.
  Reproduced against the real server: whenever telemetry stops but the socket
  stays up, the sweep drops it at 15s and the agent's 1s reconnect restores it,
  every ~16s. The hub now pings agents every 5s and counts the pong as
  liveness. Neither the hardware trigger (suspected: sleep freezing the agent's
  telemetry timer) nor the fix is tested on hardware yet; see morning-test row
  13. A spot check reads Online 15 of every 16 seconds, so the Sleep/wake PASS
  above does not rule this out.

## Critical experiment (§50)

1. Did CafeQuest remain connected? **YES** — through game launches, idle sleep,
   and wake cycles.
2. Did CafeQuest receive the command? **YES** — including while a game was the
   resumed app.
3. Did the launch API execute? **YES** — Meta's `launchOtherApp` ran with
   Dashboard App ID `1336716629531597`.
4. What result did Meta return? **`Success`** — parsed to
   `command_result: success`. A second launch of an already-foreground app also
   returned `Success` without emitting a new ACTIVITY_RESUMED.
5. Did the second game actually appear? **NOT TESTED** — no Game A → Game B
   switch was performed.
