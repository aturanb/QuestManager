# Known Limitations

- **No per-device credentials yet**: one shared `DEVICE_ENROLLMENT_KEY` gates
  enrollment; architecture permits per-device tokens later (§35).
- **No store-and-forward**: launching to an offline headset is rejected (409);
  the human must connect the headset first.
- **Dashboard WS key in query string**: browsers cannot set WS headers; the key
  travels as `?key=`. Request logging is disabled server-side to compensate.
- **Removing a headset is not a ban**: `DELETE /api/devices/:id` (the
  dashboard's "Remove headset" on an offline card) drops the device with its
  sessions, commands and app inventory, but a headset that still has the agent
  and the enrollment key enrolls again on its next hello. A connected headset
  is refused with 409 `headset_online`.
- **Session countdown** is client-rendered from server time; a closed laptop
  lid pauses it until the next state push.
- **Simulator battery** drains 1%/5s tick; not a real discharge model.
- **Hardware-unverified** (see docs/poc-test-results.md): background WS survival,
  background command reception, `launchOtherApp` runtime, Game A→B switching,
  reboot/autostart.
- **Foreground game is best-effort**: it comes from Android `UsageStats`
  ACTIVITY_RESUMED/PAUSED events polled every 5s, and only names packages the
  agent reported in its inventory. A game installed since the last connection
  reads as "No game open" until the agent reconnects. An offline headset shows
  "—" rather than its last report.
- **Unmanaged overlays do not end a run**: the Meta universal menu coming
  forward leaves the current game and its duration intact, by design, so a menu
  peek does not reset the café's "open for" display. The consequence is that a
  game which disappears without an ACTIVITY_PAUSED event can read as still open
  until another managed game starts.
- **UsageStats events batch** (verified on a Quest 3): an ACTIVITY_RESUMED can
  become queryable seconds after it happened. `UsageQueryWindow` therefore only
  advances past events it actually saw, instead of to "now", and rebuilds from a
  24h lookback on the first poll after a start.
- **Several apps are resumed at once on Quest**: the immersive game and 2D panel
  apps each stay resumed on their own panel, so CafeQuest reports the most
  recently resumed managed package that has not paused. A panel app a customer
  opens on top of a game (Instagram, WhatsApp) is itself in the inventory, so it
  will briefly show as the current app while it is open.
- **A sleeping headset pauses its game**: taking the headset off fires
  ACTIVITY_PAUSED, so **Open now** becomes "No game open" and the
  duration restarts when it wakes. The café session timer is unaffected.
- **Online means the socket answers, not that telemetry is fresh**: the hub's
  5s ping keeps a headset online while it answers, even after its telemetry
  stops, so battery and **Open now** can be its last report. Whether a sleeping
  Quest answers pings is UNVERIFIED on hardware (docs/morning-test.md row 13).
- **Usage access needs an adb grant**: `PACKAGE_USAGE_STATS` is not user-grantable
  on Quest, so each headset needs `adb shell appops set com.cafequest.agent
  GET_USAGE_STATS allow` once (see docs/quest-setup.md).
- **Catalog refresh needs the internet**: the dashboard's *Update app list*
  button reaches `raw.githubusercontent.com`. On a café LAN with no WAN access
  it fails and keeps the mappings already cached.
- **Model is whatever the headset reports**: the card's **Model** row shows
  Android's `Build.MODEL` from the agent's hello. A Quest 3 reports "Quest 3"
  (seen on hardware); what a Quest 2, Pro or 3S reports is UNVERIFIED. The
  simulator always reports "Quest 3".
- **Turkish covers CafeQuest's own words**: game and device names, server
  error details for codes the dashboard does not know, agent error codes
  (`META_APP_ID_NOT_CONFIGURED`) and Meta SDK messages are shown as sent, after
  a Turkish lead-in such as "Açılamadı: …". The language pick is per browser
  and per headset, not café-wide.
