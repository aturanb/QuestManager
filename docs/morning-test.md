# MORNING QUEST TEST (5–10 minutes)

## 0. On the café PC

```bash
npm install
cp .env.example .env # replace both change-me keys before continuing
npm run catalog:update # refresh the local package-name/App-ID mapping
npm run dev        # server :3000 + dashboard :5173
```

The server loads the root `.env` automatically. The simulator and each headset
must use its `DEVICE_ENROLLMENT_KEY`; the dashboard prompts for
`ADMIN_API_KEY`.

Find the PC's LAN IP (`ipconfig` / `ifconfig`), e.g. `192.168.1.50`.
Dashboard: http://localhost:5173.

## 1. Install the agent

```bash
cd quest-agent && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set com.cafequest.agent GET_USAGE_STATS allow   # once per headset
```

The APK bakes in host/port/enrollment key/Meta App ID from `.env` +
`cafequest.config.json`, so the setup screen should already be filled in.

## 2. Configure one headset

Open **CafeQuest** on the Quest. Host, port, enrollment key, and the Meta
Dashboard App ID are prefilled from the build; set the name to `Quest 01` →
**Save and connect**.

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

## Troubleshooting

- **ADB empty**: developer mode, USB RSA prompt, cable/port.
- **Can't connect**: same Wi-Fi, PC firewall TCP 3000, no AP client-isolation.
- **ENROLLMENT_REJECTED**: key mismatch with server `.env`.
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
