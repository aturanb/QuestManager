# Known Limitations

- **No agent authentication**: any device on the café LAN can connect to
  `/agent-ws` as a headset. The shared enrollment key was removed on 2026-10-09
  because CafeQuest only ever runs on the café's own network.
- **No store-and-forward**: launching to an offline headset is rejected (409);
  the human must connect the headset first.
- **Dashboard WS key in query string**: browsers cannot set WS headers; the key
  travels as `?key=`. Request logging is disabled server-side to compensate.
- **Removing a headset is not a ban**: `DELETE /api/devices/:id` (the
  dashboard's "Remove headset" on an offline card) drops the device with its
  sessions, commands and app inventory, but a headset that still runs the agent
  comes back on its next hello. A connected headset is refused with 409
  `headset_online`.
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
- **Catalog refresh needs the internet, but sideloaded launch does not**: the
  dashboard's *Update app list* button reaches `raw.githubusercontent.com` to
  identify official Meta apps. On a café LAN with no WAN access it fails and
  keeps the mappings already cached; unmatched apps remain launchable by their
  Android package ID.
- **Direct package launch still needs a physical Quest check**: the agent uses
  Android's Leanback/launcher intent for apps without a Meta App ID. Unit tests
  cover routing and errors, but Quest background-activity policy may differ;
  morning-test row 5a is the acceptance check. Installed helper/service APKs
  without a front-door activity remain visible but fail with
  `TARGET_NOT_LAUNCHABLE` when selected.
- **Model is whatever the headset reports**: the card's **Model** row shows
  Android's `Build.MODEL` from the agent's hello. A Quest 3 reports "Quest 3"
  (seen on hardware); what a Quest 2, Pro or 3S reports is UNVERIFIED. The
  simulator always reports "Quest 3".
- **Turkish covers CafeQuest's own words**: game and device names, server
  error details for codes the dashboard does not know, agent error codes
  (`META_APP_ID_NOT_CONFIGURED`) and Meta SDK messages are shown as sent, after
  a Turkish lead-in such as "Açılamadı: …". The language pick is per browser
  and per headset, not café-wide.
- **Discovery needs one broadcast domain**: headsets find the server only on
  the same subnet, through an access point that passes broadcasts, with inbound
  UDP 3000 allowed on the PC and the server on `HOST=0.0.0.0` (a socket bound to
  one address misses broadcasts). Otherwise use **Manual** with the PC's IP.
  UNVERIFIED on hardware (docs/morning-test.md rows 16–19).
- **A renamed or replaced café PC is not followed automatically**: an Auto
  headset accepts only the PC name it remembers, so after a rename staff press
  **Find server** once per headset. On a fresh install with two servers
  answering (say, a laptop running `npm run dev`), the first answer wins.
- **The live support view is one video-only stream**: no audio, no recording,
  no screenshots, no second viewer and no streaming to two headsets at once.
  A second reservation is refused with `CAST_BUSY` until the active session
  ends, and one headset can never serve two viewers.
- **No reconnect for a cast**: if the browser reloads or the headset's socket
  drops, the session ends and the viewer must reserve again; there is no resume.
  The dashboard keeps the `sessionId` in memory, so a page refresh also loses a
  session that is still reserved (the slot frees itself at the approval or
  negotiation timeout).
- **No TURN and no STUN**: peers connect with host candidates only, so this
  works on one flat café LAN. A cast across subnets, through a VPN, or with
  client isolation on the access point will not connect — and there is no
  fallback relay by design.
- **Consent is per session, and Developer Mode does not remove it**: every new
  request needs a fresh tap on Quest's own `MediaProjection` dialog. A headset
  that nobody is wearing cannot be watched without someone approving on it, and
  CafeQuest never fakes or remembers an approval.
- **The automatic consent prompt needs a one-time app-op and a worn headset**:
  the agent opens Quest's selector over the running game only if
  `adb shell appops set com.cafequest.agent SYSTEM_ALERT_WINDOW allow` was run
  (it survives `adb install -r`); otherwise the diagnostics-screen button is the
  fallback. On an unworn headset sitting behind a Guardian dialog, Horizon OS's
  volumetric window manager logged `Placement request in-flight` and timed out
  10 s per attempt, so a new consent task never opened — only a headset on a
  person's face has been seen to place it quickly. Taking an unanswered prompt
  down again (admin stop, approval timeout) uses a `CLEAR_TOP` re-entry and is
  UNVERIFIED_HARDWARE. If the agent is killed or reinstalled while a selector
  is up, nothing remembers it and the selector stays orphaned in its task; clear
  it with `adb shell dumpsys activity activities` (find the `rootTaskId` of the
  `CastConsentActivity` task) and `adb shell am stack remove <rootTaskId>`.
- **Some apps opt out of capture**: any game or app that sets
  `FLAG_SECURE`/`setSecure` renders black in the support view. CafeQuest asks
  the platform for the screen, so whether a given title is watchable is the
  title's decision, not a setting here. Representative games are UNVERIFIED on
  hardware (docs/morning-test.md row 32).
- **The projection foreground service type is ordered optimistically**: the
  agent requests `dataSync|mediaProjection` just before handing the one-use
  consent result over, and falls back to `dataSync` if the platform refuses the
  type. On Android 14 that transition happens before the projection exists, so a
  refused promotion is possible; the capture path then reports
  `capture_failed` to the dashboard instead of silently showing nothing.
  UNVERIFIED_HARDWARE.
- **Video quality, latency and thermal behavior are unmeasured**: the profile is
  960×540 / 15 FPS / 1.5 Mbps on paper. Picture-within-15s, sub-2s latency, a
  stable 15-minute session, and the battery/thermal impact on a running game are
  all NOT TESTED (docs/morning-test.md rows 21–33).
- **Controller monitoring is best-effort diagnostics**: it reads
  `dumpsys OVRRemoteService` over wireless ADB, which is not a stable
  application API. A Horizon OS update that changes that text produces
  "controller batteries unavailable", never a broken headset; the feature is
  off by default and optional.
- **Wireless Debugging needs one tap per reboot**: Horizon OS resets it on every
  boot and forgets the "always allow on this network" approval, so after a
  reboot someone taps **Allow** on the system dialog (the agent itself does not
  autostart, so this is the same visit as opening CafeQuest). The approval is
  per access point. The one-time per-headset setup is the `pm grant
  ... WRITE_SECURE_SETTINGS` step and USB authorization of the café PC's adb
  key. mDNS discovery is verified on macOS only; on another café PC the
  `<ip>:5555` fallback still works for headsets that have legacy `adb tcpip`.
  When a headset cannot be reached, only controller readings are lost.
- **Controller readings are never stored**: they live in the server's memory and
  are gone after a restart, so a fresh reading is required every time. The only
  persisted value is the global enabled flag.
- **A sleeping controller reads as last known**: Horizon OS keeps reporting the
  last level with the controller inactive, so the badge keeps the percentage and
  says "last known" instead of pretending it is live. Levels move slowly; a
  fresh reading can lag by up to a minute.
- **Only headsets that reach the server by LAN IPv4 can be read**: a loopback,
  IPv6, or missing remote address gets `no_wireless_address`, and the headset is
  otherwise unaffected.
- **ADB is a shared resource**: CafeQuest disconnects only the endpoints it
  newly connected itself. A wireless session someone else opened (or a USB
  session) is read but left running, and if `adb` is missing entirely the
  dashboard simply reports "ADB unavailable".
- **The server's name is the PC's hostname**: a Mac without a fixed `HostName`
  takes its name from the router, and that name can change along with the IP,
  after which Auto headsets stop accepting the server. Fix a Mac's name once
  with `sudo scutil --set HostName <name>` (done on the test Mac:
  `turans-mac`). Windows keeps its computer name, so the café PC is affected
  only if someone renames it.
