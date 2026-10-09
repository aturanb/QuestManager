# MORNING QUEST TEST (5–10 minutes)

## 0. On the café PC

```bash
npm install
cp .env.example .env # replace the change-me admin key before continuing
npm run catalog:update # refresh the local package-name/App-ID mapping
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
| 12 | Rename the headset on its setup screen without retyping the key: after **Save and connect** it reconnects (the key survived the edit) | |
| 13 | Take the headset off and let it sleep 2 min with the dashboard open: the card stays `Online` throughout, no 1s `Offline` flashes, and the server log has no `device stale; dropping socket` | |
| 14 | Start an **Unlimited** session: the clock counts up and only **Stop** is offered. Press **Stop**: the card turns Free but keeps the played time until the next session starts | |
| 15 | Tap **TR** in the dashboard header and on the headset's CafeQuest screen: both switch to Turkish at once. Refresh the dashboard and force-close and reopen CafeQuest: both are still Turkish | |
| 16 | Fresh install: `adb shell pm clear com.cafequest.agent`, then open CafeQuest without touching any field. It shows `Searching for server…`, then `Connected`, and the server line reads `<PC name> · <PC IP>:3000 · Auto`. (The headset gets a new id: remove its old offline card.) | |
| 17 | **Change setup** → **Find server**: the café PC is listed within ~2 s; **Save and connect** reconnects | |
| 18 | PC IP change: stop the server, give the PC a new IP (switch Wi-Fi ↔ Ethernet, or renew its DHCP lease), start the server. Every Auto headset is back `Online` within ~35 s with nobody touching it, and the server log shows `discovery probe answered` | |
| 19 | Set one headset to **Manual** with the PC's IP → **Save and connect**, then restart the server: the headset reconnects to the same IP and never shows `Searching for server…` | |

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
- **App needs a Meta App ID**: expand the unmatched-app section, copy the
  number at the end of that app's Meta Store URL, and save it locally.
- **Meta login/entitlement prompt**: sign the test Meta account into the
  headset and entitle the game to it.

Record every result in `docs/poc-test-results.md` — never pre-mark PASS.
