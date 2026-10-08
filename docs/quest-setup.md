# Quest Setup (per headset)

All values live in the agent's setup screen and persist in DataStore (§38), so
no rebuild is needed when the café PC's IP changes.

A fresh install needs no typing: the APK bakes in defaults for server host,
port, enrollment key, and CafeQuest's Meta App ID, read at build time from the
repo-root `.env` (`CAFE_PC_LAN_HOST`, `PORT`, `DEVICE_ENROLLMENT_KEY`) and from
`cafequest.config.json` (`metaAppId`). Change those files and rebuild to move
every new headset at once. Blank fields on the setup screen keep the value
already stored, so editing one field never clears the others.

## Install

```bash
cd quest-agent
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Foreground-game detection: Android requires this per-package grant in addition
# to the PACKAGE_USAGE_STATS manifest permission. Once per headset; it survives
# `adb install -r` but not an uninstall.
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow
```

Without that grant every card reads **Usage access required** instead of the
current game. Nothing else breaks: battery, sessions, and launching still work.

If `adb devices` shows nothing: put the headset in developer mode (phone app →
Menu → Devices → headset → Developer mode), connect USB, accept the
RSA prompt inside the headset, try another cable/port.

## Configure (on-headset setup screen)

| Field | Example |
|---|---|
| Server host | `192.168.1.50` (café PC LAN IP, not `localhost`) |
| Server port | `3000` |
| Enrollment key | value of `DEVICE_ENROLLMENT_KEY` on the server |
| Device name | `Quest 01` … `Quest 08` |
| Meta App ID | CafeQuest's own Meta Horizon Developer Dashboard App ID (`1336716629531597`) |

Tap **Save and connect**. The diagnostics screen should show `Connected` and the
dashboard card for this headset should flip to Online within ~5s. Saving while the
agent service is already running reloads the host, enrollment key, and Meta App
ID immediately; no process restart is required.

The headset's **Meta App ID** initializes CafeQuest with the Meta SDK. It is not
one of the target-game IDs in `cafequest.config.json`; each game still needs its
own real Meta App ID there.

## Diagnostics controls

- **Reconnect** restarts the agent WebSocket connection.
- **Send test telemetry** refreshes the displayed battery state and sends a
  telemetry frame when connected.
- **Test app launch** retries the most recent game command received from the
  dashboard. Before the first dashboard launch it reports
  `FAILED NO_GAME_COMMAND_RECEIVED` instead of launching an unknown app.

## Troubleshooting

- **Quest cannot reach the PC**: same Wi-Fi band (2.4/5 GHz SSID), PC firewall
  must allow inbound TCP 3000, no client-isolation on the AP.
- **ENROLLMENT_REJECTED on diagnostics**: enrollment key mismatch — compare
  with the server's `.env`, watch for trailing spaces.
- **Online but battery stuck**: telemetry is every 5s; if last-seen ages past
  15s the card goes Offline (§15) — check Wi-Fi, then **Reconnect**.
- **META_APP_ID_NOT_CONFIGURED**: the headset setup screen's Meta App ID is
  blank/placeholder; enter CafeQuest's own Dashboard App ID and save again.
- **Open now says "Usage access required"**: run the `appops` grant above
  for this headset, then **Reconnect**. The next telemetry frame (≤5s) clears it.
- **Open now says "No game open" while a game is running**: the
  agent only names packages from the inventory it reported, so a game installed
  after the last connection is invisible until the next **Reconnect**.
- **Launch does nothing**: game not installed/entitled on *that* headset, or
  its target Meta App ID is still a `FILL_*` placeholder (dashboard shows the
  `game_meta_app_id_not_configured` error).
