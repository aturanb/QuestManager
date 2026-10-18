# Quest Setup (per headset)

Setup values live in the agent's setup screen and persist in DataStore (§38).
The headset identity does not depend on DataStore: it is derived from Android's
app-signing-key/user/device-scoped ID, so clearing app data or reinstalling the
same signed APK reconnects to the same dashboard card and keeps its server-side
name and history.

The headset's name belongs to the server. Rename a headset from the **Rename**
link on its dashboard card; the headset's own screen follows within seconds.
Typing a different name in **Change setup → Device name** renames it on the
dashboard too. A fresh install's default name ("Quest A1B2") never replaces a
name staff already set.

A fresh install needs no typing: in **Auto** mode (the default) the headset finds
the café PC on the Wi-Fi by itself and follows it when the PC's IP changes. The
only value baked into the APK is CafeQuest's Meta App ID, read at build time from
`cafequest.config.json` (`metaAppId`); change it and rebuild to move every new
headset at once. Blank fields on the setup screen keep the value already stored,
so editing one field never clears the others.

## The café PC

Headsets remember the server by its name (the PC's hostname, shown on the
diagnostics screen), so give the PC a name that never changes **before** any
headset connects to it:

- **Windows** (the café PC): Settings → System → About → **Rename this PC**, e.g.
  `CAFE-PC`, then restart. Windows keeps that name across networks and reboots.
- **Mac** (testing): `sudo scutil --set HostName <name>` once. Without it macOS
  takes its name from the router, and that name can change along with the IP.

The PC firewall must allow inbound TCP 3000 (dashboard and headsets) and UDP 3000
(discovery). On Windows, the first `npm run dev` asks whether to let Node.js
through: allow it, and set the café network to **Private** (Settings → Network &
internet → your Wi-Fi or Ethernet → Network profile type). The prompt only
allows Private networks by default, so on a Public network both ports stay
blocked. If someone clicked Cancel, tick Node.js under "Allow an app through
Windows Firewall". A hand-made TCP-only port rule does not cover discovery. Keep
`HOST=0.0.0.0` in `.env` (the default).

**Moving the server to another PC** (say, from the test Mac to the café's Windows
PC): Auto headsets keep looking for the old name. On each headset press **Change
setup** → **Find server** → pick the new PC → **Save and connect**, once.

## Install

```bash
cd quest-agent
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Foreground-game detection: Android requires this per-package grant in addition
# to the PACKAGE_USAGE_STATS manifest permission. Once per headset; it survives
# `adb install -r` but not an uninstall.
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow
# Lets an admin live-view request bring up Quest's system screen-sharing prompt
# while a game is open. Once per headset; it survives `adb install -r`.
adb shell appops set com.cafequest.agent SYSTEM_ALERT_WINDOW allow
```

Use the same APK signing key for every rebuild of this installation. A factory
reset, a different headset user, or a different signing key creates a new
Android-scoped identity and therefore a new dashboard card. The current
upgrade migrates the installed agent's former random ID on its first connection.
For this one-time upgrade, install with `adb install -r`, open CafeQuest, and
wait for it to connect before clearing its data or uninstalling it. After that
first connection, clears and reinstalls keep the same card. Older stale cards
that predate the active ID still need one manual removal.

Without that grant every card reads **Usage access required** instead of the
current game. Nothing else breaks: battery, sessions, and launching still work.

If `adb devices` shows nothing: put the headset in developer mode (phone app →
Menu → Devices → headset → Developer mode), connect USB, accept the
RSA prompt inside the headset, try another cable/port.

## Configure (on-headset setup screen)

| Field | Example |
|---|---|
| Device name | `Quest 01` … `Quest 08` |
| Server | **Auto** (default): found on the Wi-Fi; **Find server** searches now and lists every PC that answered. **Manual** (debugging): host `192.168.1.50` (the café PC's LAN IP from `ipconfig` / `ifconfig`, not `localhost`) and port `3000`; a Manual headset never searches. |
| Meta App ID | CafeQuest's own Meta Horizon Developer Dashboard App ID (`1336716629531597`) |

Tap **Save and connect**. The diagnostics screen should show `Connected` with a
server line like `CAFE-PC · 192.168.1.50:3000 · Auto`, and the dashboard card for
this headset should flip to Online within ~5s. Saving while the agent service is
already running reloads the server and Meta App ID immediately; no process
restart is required.

The headset's **Meta App ID** initializes CafeQuest with the Meta SDK. It is not
one of the target-game IDs in `cafequest.config.json`; each game still needs its
own real Meta App ID there.

## Live support view (screen sharing)

Staff can open one headset's screen on the dashboard (**Request live view** on
the card) to help a customer. Nothing extra is installed or granted: the feature
ships in the same APK, and Quest asks for its own capture consent every time.

- On the headset the diagnostics screen shows **Live support view**. When staff
  request a view, the panel explains the request and offers **Share screen with
  café staff**; a tap opens Quest's screen-sharing dialog. Approving starts the
  view; declining (or ignoring the dialog until the request times out) ends it.
- While a session runs, the panel and the ongoing notification say so, and
  **Stop sharing** ends it from the headset. Staff can also stop from the
dashboard, and the view ends by itself if the browser closes, the Wi-Fi drops,
  or the headset's agent reconnects.
- Developer Mode is about installing and debugging the APK. It does **not**
  remove Quest's per-session capture consent, and it is not a way to watch a
  headset without someone approving on it.
- The notification switches to *Live-view request waiting* / *Screen sharing
  with café staff is on* so a headset in a charging bay shows why it is asking
  for a tap.

## Optional: controller batteries

Reading the Touch controller levels is optional and separate from normal setup.
Per headset, once:

```bash
# 1. Connect the headset by USB and, if asked, tick "Always allow from this
#    computer" for the café PC's adb key (authorize debugging).
adb devices
# 2. Let the agent switch Wireless Debugging on for the server.
adb shell pm grant com.cafequest.agent android.permission.WRITE_SECURE_SETTINGS
```

Then turn on **Controller batteries** in the dashboard header. The agent asks
Horizon OS to enable Wireless Debugging; on the headset, tap **Allow** (choose
always allow for this network) when the "Allow wireless debugging on this
network?" dialog appears. The first enable after every headset reboot shows it
again, and the agent does not autostart after a reboot, so the visit is the same
one you already make to open CafeQuest. Each card then shows `L`/`R` badges next
to the headset battery; a controller that is asleep or otherwise inactive keeps
its percentage and is labelled `last known`.

Notes: the approval is stored per access point, so a headset that roams between
access points asks again at each new one. The dialog is a system panel and can
appear in front of a game, so turn the switch on while headsets are idle. The
legacy path still works: a headset with `adb tcpip 5555` running is read
without Wireless Debugging. Wireless Debugging is a LAN-reachable ADB listener
that accepts only already-authorized keys, which is within this project's
LAN-only model; it is on only while the switch is on.

## Diagnostics controls

- **Reconnect** restarts the agent WebSocket connection.
- **Send test telemetry** refreshes the displayed battery state and sends a
  telemetry frame when connected.
- **Test app launch** retries the most recent game command received from the
  dashboard. Before the first dashboard launch it reports
  `FAILED NO_GAME_COMMAND_RECEIVED` instead of launching an unknown app.

## Troubleshooting

- **No live view appears after approving**: both devices must be on the same
  subnet — the media path is direct WebRTC with no relay. Client isolation on
  the access point, a VPN, or a second subnet blocks it (the dashboard then
  reports the session ending). The dashboard also needs a browser with WebRTC
  (the café PC's Edge/Chrome/Firefox all work).
- **The live view is black**: that app sets `FLAG_SECURE` and refuses capture.
  Nothing can be changed from CafeQuest's side.
- ***Request timed out* / Video did not start in time**: nobody approved on
  the headset, or the two peers could not reach each other. Re-request from the
  dashboard; a fresh request always asks for consent again.
- **Quest cannot reach the PC**: same Wi-Fi band (2.4/5 GHz SSID), PC firewall
  must allow inbound TCP 3000 and UDP 3000, no client-isolation on the AP.
- **Stays on "Searching for server…" or "No server found"**: allow inbound UDP
  3000 in the PC firewall, keep `HOST=0.0.0.0` in `.env` (the default), and check
  the headset is on the café PC's Wi-Fi subnet. Some access points drop
  broadcasts: switch the headset to **Manual** and type the PC's IP.
- **Joined the wrong server** (a laptop running `npm run dev` answered first on a
  fresh install): **Change setup** → **Find server** → pick the café PC → **Save
  and connect**. The headset remembers that PC's name from then on.
- **Café PC renamed or replaced**: Auto headsets keep looking for the old name.
  Press **Find server** once on each headset and pick the new PC.
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
- **Controller badges show `L — R —` with *ADB unavailable***: `adb` is not
  installed on the café PC (or `ADB_PATH` in `.env` is wrong). Fix it and wait
  for the next cycle; no need to toggle the switch.
- **Controller badges show *No wireless ADB address***: the headset's agent is
  not connected, or it connected from a loopback/IPv6 address. Reconnect the
  headset.
- **Controller badges show *Couldn't connect to the headset over ADB***: neither
  Wireless Debugging nor legacy TCP ADB is reachable. Make sure the switch is
  on and the headset's agent is connected; if the agent has not asked yet, open
  CafeQuest on the headset.
- **A card says *Tap Allow on the headset to turn on Wireless Debugging***: the
  agent asked and the system dialog is waiting. Put the headset on and tap
  **Allow** (always allow for this network).
- **A card says *One-time setup missing on this headset***: run the
  `pm grant ... WRITE_SECURE_SETTINGS` step above over USB.
- **Badges say *last known***: that controller is asleep. The percentage is the
  last one Horizon OS reported, not live data.
