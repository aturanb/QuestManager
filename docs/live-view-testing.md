# Testing the Live Support View

How to test the one-headset screen-casting feature (`screen_cast_v1`) end to end:
first the automated proof, then the physical Quest walkthrough with the numbers to
record. Nothing in this file is a claim: the physical rows are still
`NOT TESTED` until someone fills them in (docs/poc-test-results.md).

## Prerequisites

- Café PC: `npm install`, `.env` with an `ADMIN_API_KEY`, `npm run dev`
  (server :3000 + dashboard :5173).
- Headset: agent **0.5.0 or newer** installed
  (`quest-agent/app/build/outputs/apk/debug/app-debug.apk`). Older agents do not
  advertise `screen_cast_v1`: the card shows **Update agent to view** instead of
  **Request live view**, which is the compatible behavior, not a bug.
- Headset and PC on the same Wi-Fi subnet, no AP client isolation, no VPN. The
  media path is direct WebRTC with no STUN/TURN relay, so anything that separates
  the two devices stops the picture even when signaling succeeds.
- Dashboard in Chrome/Edge/Firefox (any browser with WebRTC).

## 1. Automated proof (no headset needed)

```bash
npm run build                 # shared → server → simulator → dashboard
npm test                      # shared 28, server 99, simulator 11, dashboard 177
npx tsc -p tsconfig.json      # whole-repo typecheck
```

Focused suites while iterating:

```bash
npm run build -w shared && npm run build -w server
node --test server/dist/tests/cast-coordinator.test.js   # one-session state machine
node --test server/dist/tests/casting-routes.test.js     # REST + /cast-ws contract
npm test -w dashboard -- src/casting.test.ts src/components/LiveViewModal.test.tsx
cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest
```

What they prove without hardware:

- one global session; a second reservation is `409 CAST_BUSY`, and a fresh one
  succeeds after the first ends;
- the full router: reserve → viewer binds → `cast_request` → offer/answer/ICE →
  `live` → `DELETE` (plus viewer close, agent disconnect, duplicate hello, server
  shutdown and both timeouts);
- a binary/media frame is rejected and relayed nowhere, no SDP/ICE/admin key
  reaches the logs, and a live session writes nothing to SQLite;
- the browser client's state machine, retry/stop wiring and the floating viewer's
  a11y-labeled states;
- the headset side: one pending request, one-use consent, idempotent teardown,
  stale activity results ignored, bitrate/FPS profile values, and both languages.

With a device attached, the manifest is also verified on real hardware:

```bash
cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew connectedDebugAndroidTest
```

`MediaProjectionServiceTest` asserts the installed service carries
`dataSync|mediaProjection`, declares `FOREGROUND_SERVICE_MEDIA_PROJECTION`, and
declares no audio permission. (Note: `InstalledAppScannerInstrumentedTest`
currently fails on a pre-existing self-exclusion assertion unrelated to casting —
see docs/poc-test-results.md.)

## 2. Negative path with the simulator (no hardware)

The simulator never advertises `screen_cast_v1` on purpose:

```bash
npm run simulator -- --count 1 --stable
```

- Its card must **not** offer **Request live view**; it offers **Update agent to
  view** instead, and `POST /api/casts` with its device id answers 409.
- That is the compatibility guarantee for older agents; if a simulator card can
  start a view, something is wrong.

## 3. Physical Quest walkthrough

Install and open the agent, then confirm the headset is Online on the dashboard
with a battery reading.

```bash
cd quest-agent && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow   # unchanged, for Open now
adb shell appops set com.cafequest.agent SYSTEM_ALERT_WINDOW allow # once, for automatic consent prompt
adb shell am start -n com.cafequest.agent/.MainActivity          # also starts the agent service
```

Put a managed game in the foreground, then:

1. Dashboard: press **Request live view** on the card.
2. Headset: Quest's own screen-sharing selector opens over the game by itself
   (CafeQuest's transparent consent activity, allowed to start from the
   background by the `SYSTEM_ALERT_WINDOW` app-op). Without the app-op, or if the
   launch is refused, CafeQuest's diagnostics panel shows **Live support view**
   with **Share screen with café staff** as the fallback.
   → this is morning-test row 20.
3. Headset: choose the screen and press **Share** in Quest's own dialog (not a
   CafeQuest dialog). The temporary activity closes and the game comes back to
   the front → row 21 and row 23. Developer Mode does not replace this dialog,
   and a second session always asks again → row 33. Cancel once as well: the
   game must come back and the dashboard must show the refusal.
4. Approve and start a stopwatch: the dashboard viewer should show the picture
   within 15 s → row 22. Return to the game and confirm the game is visible
   (row 23); note whether the picture is readable and correctly oriented (row 24).
5. Latency: point the headset at a clock/stopwatch and photograph both screens,
   or film the pair; target is below about 2 s → row 25.
6. Leave it running during play for 15 minutes → row 26: no disconnect, no
   `Offline` flash on the card, the game keeps running.
7. Record battery % before/after and whether the headset got warm or the game
   stuttered → row 27.
8. Stop paths: dashboard **Stop live view** (row 28) and headset **Stop sharing**
   (row 29). Each must end the session within ~3 s, close the viewer, and leave the
   headset panel back on the ordinary diagnostics view.
9. Unanswered prompt: request a live view, touch nothing, then press **Stop
   live view** on the dashboard (and, separately, let the 90 s approval window
   expire). The selector must disappear by itself and the game must be in front
   again; the agent re-enters its consent activity with `CLEAR_TOP` to remove it.
   UNVERIFIED_HARDWARE: this was only exercised against a headset nobody was
   wearing (see docs/known-limitations.md).
10. Refuse consent once (row 30) and let one request time out by tapping nothing
   for a minute (row 31): the dashboard must show the failure instead of a stuck
   spinner, and the next request asks for consent again.
11. Launch, reopen and full screen, from the dashboard viewer: while live, pick
    an app in the viewer's **Launch an app** list and press Launch (the stream must
    keep running and the card shows the usual launch status). Minimize and expand
    the viewer: the picture must come back, not stay black. Press **Full screen**
    on the picture: it must fill the display, Escape must leave full screen without
    closing the viewer, and the stream must keep running. Then press **Stop live
    view**: a prompt must offer to reopen the app that was open before (or the one
    staff launched last), and **Yes, open it** must bring it to the front. The
    prompt is asked every time, even if "Şu an açık" still shows the game: Quest
    keeps a game "resumed" behind CafeQuest's consent screens, so usage stats cannot
    say whether it is really in front. UNVERIFIED_HARDWARE.
12. Repeat 2–5 with two more apps, including a 2D panel app (row 32). A black
    frame means that title sets `FLAG_SECURE`; nothing can be changed from the
    CafeQuest side, so record it as-is.
13. Isolation checks: with a session Live, a second card's **Request live view**
    is refused (`busy`) → row 34; sleeping the headset (35), dropping its Wi-Fi
    (36), reloading the dashboard (37), restarting the agent so a duplicate hello
    replaces the socket (38), and force-stopping/reopening CafeQuest (39) must
    each end the session and free the slot with no orphan projection left on the
    headset.

Record every observation in [docs/poc-test-results.md](poc-test-results.md)
(rows 20–39 of [docs/morning-test.md](morning-test.md) are the same checks). Put
the model, Horizon OS version, Wi-Fi conditions, game, measured numbers and
PASS/FAIL — never a bare "works".

## 4. Quick diagnosis

| Symptom | Likely cause |
|---|---|
| **Update agent to view** instead of **Request live view** | APK older than 0.5.0 (no `screen_cast_v1` capability) |
| Card offers the button but the request fails with `busy` | another live view is running; stop it first (one stream globally) |
| Headset never shows the request | agent offline, or the headset's socket reconnected after the reservation |
| Modal reports *Request timed out* | nobody approved on the headset within the approval window |
| Modal reports *Video did not start in time* | approval happened but the peers could not connect: different subnets, VPN, or AP client isolation |
| Picture is black | the app sets `FLAG_SECURE` and refuses capture |
| Modal closes and the headset stops by itself | viewer closed/reloaded, agent reconnected, projection revoked, or the session hit its timeout — all idempotent teardown, by design |
| Server log shows lifecycle lines only | expected: no SDP, ICE, media, key, or controller data is ever logged |

## 5. Deliberately out of scope

No audio, no recording, no screenshots, no second viewer, no multi-headset
streaming, no STUN/TURN/SFU, and no reconnect/resume for a session. A feature
request in those directions is a new design, not a bug in this one; see
[docs/known-limitations.md](known-limitations.md) and
[docs/decisions.md](decisions.md).
