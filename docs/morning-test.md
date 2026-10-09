# MORNING QUEST TEST (5–10 minutes)

## 0. On the café PC

```bash
npm install
cp .env.example .env # replace the change-me admin key before continuing
npm run catalog:update # optional: identify official Meta apps automatically
npm run dev        # server :3000 + dashboard :5173
```

The server loads the root `.env` automatically; the dashboard prompts for
`ADMIN_API_KEY`. Headsets need no key and find the PC on the Wi-Fi by
themselves; the PC firewall must allow inbound TCP 3000 and UDP 3000. Give the
PC a fixed name first (docs/quest-setup.md, "The café PC"): headsets remember
the server by name, and a Mac otherwise takes a name from the router that can
change.

For Manual mode only: the PC's LAN IP (`ipconfig` / `ifconfig`), e.g.
`192.168.1.50`. Dashboard: http://localhost:5173.

## 1. Install the agent

```bash
cd quest-agent && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow   # once per headset
```

The APK bakes in CafeQuest's Meta App ID from `cafequest.config.json`; the
server address is found on the Wi-Fi, so the setup screen needs no typing.

## 2. Configure one headset

Open **CafeQuest** on the Quest. Server is **Auto** and the Meta Dashboard App
ID is prefilled from the build; set the name to `Quest 01` → **Save and
connect**.

| # | Check | PASS / FAIL |
|---|---|---|
| 3 | Dashboard shows `Quest 01` with `Online`, battery XX% | |
| 4 | Start a 60-min session → countdown ticks | |
| 5 | Confirm the game picker lists the headset's matched games under **Installed on this headset**; select one → **Launch** → badge goes `Launching…` → `Launched ✓`, game opens | |
| 5a | Expand **Installed app IDs**: confirm CafeQuest shows Android package ID `com.cafequest.agent`. Select CafeQuest (Android package) while another app is open → **Launch** → `Launched ✓`, CafeQuest opens without a manual Meta mapping | |
| 6 | Leave the game running 2 min: still Online? battery telemetry moving? | |
| 6a | **Open now** names the game actually running and its timer climbs | |
| 6b | Open the Meta universal menu, close it: the game and its timer survive the peek (no reset to 0:00) | |
| 6c | Return to Meta Home: **Open now** becomes `No game open` | |
| 7 | **Critical:** while Beat Saber runs, select **Walkabout** → **Launch**. Does the headset switch games untouched? | |
| 7a | After the switch, **Open now** names Walkabout with a timer restarted from 0 | |
| 8 | Kill the app's network (airplane mode): card goes Offline within ~15s; reconnect keeps identity | |
| 9 | After one dashboard launch, return to CafeQuest and tap **Test app launch**: the last game relaunches and Last result becomes `SUCCESS` | |
| 10 | Start a 1-minute custom session: after expiry, `Time up` remains visible and the card offers new-session controls | |
| 11 | Click **Update app list** at the bottom of the dashboard: the count refreshes and the "updated" label resets to `just now` | |
| 12 | Rename the headset on its setup screen without touching anything else: after **Save and connect** it reconnects to the same server and the Meta App ID is still filled in | |
| 13 | Take the headset off and let it sleep 2 min with the dashboard open: the card stays `Online` throughout, no 1s `Offline` flashes, and the server log has no `device stale; dropping socket` | |
| 14 | Start an **Unlimited** session: the clock counts up and only **Stop** is offered. Press **Stop**: the card turns Free but keeps the played time until the next session starts | |
| 15 | Tap **TR** in the dashboard header and on the headset's CafeQuest screen: both switch to Turkish at once. Refresh the dashboard and force-close and reopen CafeQuest: both are still Turkish | |
| 16 | Fresh install: `adb shell pm clear com.cafequest.agent`, then open CafeQuest without touching any field. It shows `Searching for server…`, then `Connected`, and the server line reads `<PC name> · <PC IP>:3000 · Auto`. (The headset gets a new id: remove its old offline card.) | |
| 17 | **Change setup** → **Find server**: the café PC is listed within ~2 s; **Save and connect** reconnects | |
| 18 | PC IP change: stop the server, give the PC a new IP (switch Wi-Fi ↔ Ethernet, or renew its DHCP lease), start the server. Every Auto headset is back `Online` within ~35 s with nobody touching it, and the server log shows `discovery probe answered` | |
| 19 | Set one headset to **Manual** with the PC's IP → **Save and connect**, then restart the server: the headset reconnects to the same IP and never shows `Searching for server…` | |

## Live support view (screen_cast_v1)

Needs a managed game in the foreground, one headset, and the dashboard open on
the café PC. Use a stopwatch for the timed rows and record real numbers in
`docs/poc-test-results.md`.

| # | Check | PASS / FAIL |
|---|---|---|
| 20 | Card offers **Request live view**; press it while the headset is Online and its CafeQuest panel shows **Live support view** with **Share screen with café staff** | |
| 21 | Tap **Share screen with café staff** → Quest's own screen-sharing dialog appears (not a CafeQuest dialog) | |
| 22 | Approve: picture appears on the dashboard within 15 s of the approval tap. Record seconds | |
| 23 | Return to the game: the game stays visible in the view (status stays Live, no black frame) | |
| 24 | Resolution/orientation: the picture is 960×540-ish, readable for support, and rotates/fits when the headset UI turns | |
| 25 | Approximate latency (two clocks/camera): below ~2 s end-to-end. Record the range | |
| 26 | Leave it running 15 min during a game: no disconnect, no `Offline` flash on the card, the game keeps running | |
| 27 | Battery/thermal: record battery % before/after and whether the headset got hot or the game stuttered | |
| 28 | Dashboard **Stop live view** → view closes and the headset returns to the ordinary diagnostics panel within ~3 s | |
| 29 | Headset panel **Stop sharing** → the dashboard shows the session ended; the headset notification stops saying *sharing is on* | |
| 30 | **Decline** the Quest dialog: the dashboard reports a declined request (no stuck spinner) and the headset panel clears | |
| 31 | Timing: request a view and tap nothing for ~60 s → the dashboard/headset report the request timing out, the headset shows no share panel, and a fresh request asks for consent again | |
| 32 | Game capture compatibility: repeat 21–25 with a second and third game (and a 2D panel app). Note any title that shows black (`FLAG_SECURE`) | |
| 33 | Fresh consent every time: after one completed session, request again → Quest's dialog appears again; a cached/instant start would be a FAIL | |
| 34 | One stream only: with a session Live, press **Request live view** on another Online headset → refused with `busy`; press it again on the same card → also refused | |
| 35 | Sleep test: let the headset sleep mid-session → the session ends and the dashboard frees the slot (no ghost viewer) | |
| 36 | Wi-Fi loss: aircraft-mode the headset mid-session → session ends, card goes Offline, slot is free; restoring Wi-Fi lets a new request succeed | |
| 37 | Viewer refresh: reload the dashboard mid-session → the session ends server-side (no orphan projection; the headset stops sharing) | |
| 38 | Duplicate-device replacement: with a session Live, force a second connection for the same device id (restart the agent) → the old session ends and the slot is free | |
| 39 | App restart: start a session, then force-stop and reopen CafeQuest → projection stops and the dashboard slot frees within seconds | |

## Troubleshooting

- **ADB empty**: developer mode, USB RSA prompt, cable/port.
- **Can't connect**: same Wi-Fi, PC firewall TCP 3000 and UDP 3000, no AP
  client-isolation.
- **No server found**: allow inbound UDP 3000 in the PC firewall and keep
  `HOST=0.0.0.0`; if the access point drops broadcasts, use **Manual** with the
  PC's IP.
- **META_APP_ID_NOT_CONFIGURED**: CafeQuest's own Dashboard App ID is missing
  from the headset setup screen.
- **Launch fails**: game not installed/entitled, or a target game's Meta App ID
  is still a placeholder in `cafequest.config.json`.
- **Installed list missing**: reinstall the newly built APK, then tap
  **Reconnect** in CafeQuest. Inventory is scanned once per connection.
- **Sideloaded app will not launch**: expand **Installed app IDs** and confirm
  the Android package ID is present. A Meta App ID is optional; add one only if
  the app is registered with Meta and direct package launch is unsuitable.
- **Meta login/entitlement prompt**: sign the test Meta account into the
  headset and entitle the game to it.
- **Live view never starts**: nobody approved on the headset, the two devices are
  on different subnets/VPN, or the access point blocks peer traffic. The media
  path has no TURN relay by design (see docs/known-limitations.md).
- **Live view is black**: the running app sets `FLAG_SECURE` and refuses capture.
- **`Request live view` refused**: another session is already Live (`busy`), the
  headset is Offline, or the APK is older than 0.5.0 and does not advertise
  `screen_cast_v1`.

Record every result in `docs/poc-test-results.md` — never pre-mark PASS.
