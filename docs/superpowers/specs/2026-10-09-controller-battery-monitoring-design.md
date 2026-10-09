# Optional Touch-controller battery monitoring

Date: 2026-10-09 · Status: approved

## Problem

CafeQuest already receives the headset battery from its Android agent and shows
it on each dashboard card. Horizon OS also knows the left and right Touch
controller levels, but the Kotlin background agent has no documented API for
reading them. On the connected Quest 3, `adb shell dumpsys OVRRemoteService`
reports both levels and whether each controller is active or asleep.

Controller monitoring must remain optional. ADB being absent, disconnected, or
misconfigured must never affect headset online status, sessions, game launching,
or the existing headset-battery telemetry.

## Goal and success criteria

- An admin can turn controller-battery monitoring on or off with one global
  dashboard toggle.
- When monitoring is on and wireless ADB is reachable, every matched headset
  card shows separate left and right controller percentages.
- An inactive controller is explicitly presented as a last-known reading rather
  than live data.
- Missing ADB, an unpaired headset, a parse failure, a timeout, or a Horizon OS
  output change produces an unavailable state only for controller batteries.
- Turning monitoring off stops polling, removes controller readings from the
  cards, and disconnects only the wireless ADB endpoints CafeQuest opened.
- The setting survives a server restart, but controller readings do not; fresh
  readings are required after every server start.
- Existing agent, session, launch, and headset-battery tests remain unchanged
  and green.

## Decisions

| Topic | Decision |
|---|---|
| Ownership | The Node server runs the optional collector. The Android agent and device protocol do not change. |
| UI scope | One global **Controller battery monitoring** toggle in the dashboard header; compact **L / R** readings sit beside the existing headset battery. |
| Default | Off for new and existing databases. |
| Source | `adb shell dumpsys OVRRemoteService`, parsed as best-effort Horizon OS diagnostics rather than a stable application contract. |
| Device matching | Match the agent WebSocket's direct LAN IPv4 address to the same address used by wireless ADB. No headset serial number enters the CafeQuest protocol or database. |
| Poll interval | Immediately after enable, then once per minute with no overlapping cycles. Controller batteries change slowly, so faster polling adds process churn without operational value. |
| Persistence | Persist only the global enabled flag. Keep readings and ADB connection ownership in memory so a restart cannot present old data as fresh. |
| Failure boundary | ADB work is outside the agent liveness and command paths. Errors become controller-monitoring status, never headset offline state or failed sessions/launches. |
| Wireless debugging | The toggle controls CafeQuest's collector and its ADB client connections. It does not enable or disable Horizon OS Wireless Debugging or run `adb usb`. |
| Dependencies | No npm package and no companion daemon. Use Node's process APIs and an existing `adb` executable. |

## Design

### 1. Server collector

Add a focused `ControllerBatteryCollector` in the server. It owns one timer,
the endpoints it connected, and an in-memory reading/error map keyed by
CafeQuest device ID.

When enabled, each non-overlapping cycle:

1. Take the currently connected agent devices and their normalized remote IPv4
   addresses from the hub.
2. For each address, run `adb connect <ip>:5555` with a short timeout.
3. If connected, run
   `adb -s <ip>:5555 shell dumpsys OVRRemoteService` with a short timeout.
4. Parse only the two `Paired device` summary lines whose `Type` is `Left` or
   `Right`, accepting an integer battery from 0 through 100 and normalizing the
   controller status to `active` or `inactive`.
5. Replace that device's in-memory reading atomically and push a new dashboard
   snapshot. A failed cycle retains the last successful values with their old
   observation time and marks them unavailable/stale.

Use `execFile`, never a shell command string. The executable is `ADB_PATH` when
configured and otherwise `adb` from `PATH`. Only an address accepted by
Node's IP parser can become an argument. Output and stderr are size-capped,
timeouts kill the child process, and one slow cycle cannot overlap the next.
The implementation may poll the eight café headsets concurrently, but each
headset has at most one active ADB operation.

If `adb` is missing, the enabled intent remains saved and the dashboard reports
`ADB unavailable`; later cycles retry so installing/fixing ADB does not require
toggling the feature off and on.

On disable, cancel the timer, clear readings/errors, run `adb disconnect` only
for IP endpoints whose first `adb connect` response said CafeQuest newly
connected them, and push a snapshot. An `already connected` endpoint is not
claimed. USB devices and ADB connections created outside CafeQuest are left
alone.

### 2. Connection identity and lifecycle

Extend the hub's in-memory agent connection record with the normalized remote
IPv4 address captured from `req.socket.remoteAddress` at the successful hello.
IPv4-mapped IPv6 values such as `::ffff:192.168.1.20` normalize to IPv4.
Loopback, missing, malformed, and native IPv6 addresses are not polled in this
first version and receive `No wireless ADB address`.

The address is never persisted. When an agent reconnects after a DHCP change,
the newest hello replaces the connection and the next collector cycle uses the
new address. The existing newest-socket-wins and online/offline behavior is
unchanged.

`buildApp` creates the collector with injected process runner, clock, and poll
interval hooks for tests. The application's close hook stops it and disconnects
collector-owned endpoints alongside `Hub.stop()`. Test apps default to
monitoring off and never invoke the real `adb` executable.

### 3. Setting and API

Create a small `app_settings` table (`key TEXT PRIMARY KEY`, `value TEXT NOT
NULL`) and store `controller_battery_monitoring` as `true` or `false`. Missing or
invalid values read as false.

Add one admin-authenticated endpoint:

```text
PUT /api/settings/controller-battery-monitoring
{ "enabled": true | false }
```

It validates the exact boolean body, persists the desired state, starts or
stops the collector, and returns the public monitoring state. Repeating the
same request is idempotent. The existing dashboard WebSocket remains the live
source of truth after the response.

The dashboard snapshot gains:

```ts
controllerBatteryMonitoring: {
  enabled: boolean;
  availability: "disabled" | "ready" | "adb_unavailable" | "no_devices";
};
```

Each device gains:

```ts
controllerBattery: {
  left:  { level: number; state: "active" | "inactive" } | null;
  right: { level: number; state: "active" | "inactive" } | null;
  observedAt: string | null;
  status: "available" | "stale" | "unavailable";
  reason: null | "headset_offline" | "no_wireless_address" | "adb_connect_failed" | "dump_failed" | "parse_failed";
} | null;
```

When monitoring is off, `controllerBattery` is `null`. Public errors are stable
status codes/translated phrases; raw ADB stderr, device serials, and diagnostics
output never enter the REST/WebSocket response.

### 4. Dashboard behavior

Place the global toggle in the top bar near the live connection indicator.
Label it **Controller batteries** / **Kontrolcü pilleri** and include concise
help text: disabling it stops CafeQuest monitoring but does not change Wireless
Debugging on the headsets.

- Off: cards keep the existing headset battery only.
- On + available: the battery fact shows the existing headset gauge followed by
  compact `L 100%` and `R 80%` badges.
- Inactive controller: its badge says `last known` in an accessible label and
  uses a subdued visual treatment; percentage remains visible.
- Stale: keep the last values, show `Updated … ago`, and mark them unavailable.
- No successful reading: show `L —  R —` with the relevant translated status.
- Toggling is disabled only while its PUT request is pending. Failure restores
  the server-confirmed position and shows an admin-level error; it does not
  change any device-card controls.

All new English and Turkish text goes through the existing typed message
catalog. The controls are keyboard operable, expose switch semantics and state,
and do not rely on color alone.

### 5. Setup and safety documentation

Document the optional per-headset preparation separately from normal CafeQuest
setup:

1. Connect the headset by USB and authorize debugging.
2. Enable TCP ADB for the current boot (`adb tcpip 5555`).
3. Disconnect USB and verify `adb connect <headset-ip>:5555`.
4. Restrict TCP 5555 to the café PC on the trusted café LAN.

State plainly that the Quest may stop listening after a reboot, IP change, or
OS update, and that the dashboard toggle does not fix that device-side state.
This feature is optional diagnostics, not a management or security boundary.

## Testing

- Parser unit tests: current left/right fixture, reversed order, active and
  inactive status, missing hand, malformed percentage, out-of-range value,
  duplicate hand, unrelated diagnostics, and changed output returning a typed
  parse failure.
- Collector unit tests with a fake process runner and clock: immediate poll,
  one-minute cadence, no overlap, timeout, missing ADB, connect failure,
  successful replacement, stale retention, retry recovery, disable cleanup,
  and no polling while off.
- Store/API tests: default off, persisted on/off, invalid body, idempotence,
  admin authentication, and no real subprocess in test apps.
- Hub tests: IPv4 and IPv4-mapped address normalization, reconnect address
  replacement, no-address fallback, controller fields in REST and WebSocket
  snapshots, and no interaction with online/session/command state.
- Dashboard tests in English and Turkish: global switch pending/success/failure,
  off state, left/right values, inactive/last-known treatment, stale and
  unavailable states, keyboard/ARIA behavior, and existing headset controls
  remaining enabled.
- Full verification: root npm build/typecheck/tests, then a physical Quest 3
  check that compares dashboard values with `dumpsys OVRRemoteService`, sleeps
  and wakes each controller, disconnects ADB during a running session, launches
  a game with ADB absent, toggles off, and restarts the server.

## Out of scope

- Enabling or disabling Wireless Debugging inside Horizon OS.
- Automatic ADB pairing, USB control, QR pairing, or storing ADB credentials.
- Using undocumented binder/private Android APIs from the agent.
- Controller battery alerts, history, charts, or notifications.
- Treating a controller reading as proof that a headset, session, or game is
  healthy.
