# CafeQuest POC Results

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
| Background heartbeat | PASS | Telemetry kept flowing for minutes while Breachers was the resumed app. |
| Background command reception | PASS | A launch command sent while Breachers was already in the foreground was acked and completed `success`. |
| Catalog refresh | PASS | `GET /api/catalog` reported 18,034 mappings; a live CLI refresh stored 18,100. |
| Sleep/wake recovery | PASS | Repeated idle-sleep and wake cycles: agent stayed online, and foreground reporting recovered on each wake with a fresh `startedAt`. |
| Game A -> Game B switch | NOT TESTED | Only Breachers was launched; no second entitled game was exercised. |
| Wi-Fi reconnect | NOT TESTED | Airplane-mode cycle not performed. |
| Session tracking | NOT TESTED on hardware | Covered by the simulator e2e test only. |
| Reboot recovery | NOT TESTED | No BOOT_COMPLETED receiver exists; the agent currently starts when CafeQuest is opened. |

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
