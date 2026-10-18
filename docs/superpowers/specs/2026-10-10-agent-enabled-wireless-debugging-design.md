# Agent-enabled Wireless Debugging for controller batteries

Date: 2026-10-10 · Status: draft, awaiting review
Builds on: `2026-10-09-controller-battery-monitoring-design.md`

## Problem

Controller-battery monitoring reads `dumpsys OVRRemoteService` from the café PC
over wireless ADB. Today that needs `adb tcpip 5555` run over USB on every
headset after **every reboot**, which staff cannot sustain. When the step is
missed the card shows `L —  R —` with the reason only in a tooltip.

Hardware findings on a Quest 3 (user build, 2026-10-10) rule out every
fully-automatic path and fix the shape of this design:

| Attempt | Result |
|---|---|
| Agent app runs `dumpsys OVRRemoteService` itself, `DUMP` granted | `PERMISSION_DENIED` from Meta's service; not an SELinux denial, the service itself refuses non-shell callers |
| Other app-readable channels (input battery, `power_supply`, `dumpsys externalbattery`) | No controller data exposed |
| `adb shell setprop persist.adb.tcp.port 5555` | `SELinux permission check failed` (shell may not set it on this build) |
| Horizon OS Wireless Debugging (`adb_wifi_enabled`) left on | Reset to 0 on reboot; the "always allow on this network" approval is also lost on reboot |
| Agent app with `WRITE_SECURE_SETTINGS` sets `adb_wifi_enabled=1` | **Works**: the headset raises the "Allow wireless debugging on this network?" dialog on an untrusted access point and enables silently on a trusted one |
| Server `adb connect` to the Wireless Debugging endpoint | **Works with no `adb pair`**: the host key already authorized over USB is accepted; `dumpsys OVRRemoteService` returned both controllers |

Two further facts shape the design: the TLS port is random on every enable and
the app cannot read it (`service.adb.tls.port` is empty for an app), so the
server must discover it; and the trust is stored per access point (BSSID), not
per network name.

The agent does not autostart after a reboot (no boot receiver; recorded as
`UNVERIFIED_HARDWARE`), so staff already open CafeQuest on each headset after a
reboot. That moment is when the one remaining human step happens.

## Goal and success criteria

- With the dashboard toggle on, controller levels appear on every headset that
  has had the one-time setup, with **no `adb tcpip` and no USB after a reboot**.
- The only recurring human step is tapping **Allow** on the headset's own
  dialog after a reboot, and the card says so while it is pending.
- Failures are visible on the card as plain text, not only in a hover tooltip:
  a missing one-time grant and a pending approval are distinct.
- A headset someone already ran `adb tcpip 5555` on keeps working unchanged.
- Turning the toggle off switches Wireless Debugging back off, but only where
  CafeQuest turned it on.
- Nothing here can affect headset liveness, sessions, launches, or the existing
  headset-battery telemetry.

## Decisions

| Topic | Decision |
|---|---|
| Who enables ADB | The Android agent, via `Settings.Global` `adb_wifi_enabled`, using a per-headset `WRITE_SECURE_SETTINGS` grant. The server never gains shell on a headset. |
| Trigger | A new server → agent message `controller_monitoring {enabled}`, sent on every agent hello and whenever the dashboard toggle changes. Only agents that advertise the `controller_monitoring_v1` capability receive it. |
| Request cadence | At most **one enable request per boot** (keyed by `Settings.Global.BOOT_COUNT`) unless the setting is already on. A denied dialog is not re-raised by reconnects. A toggle-off→on re-arms it. |
| Ownership | The agent persists whether *it* turned Wireless Debugging on. Turning monitoring off switches it off only if the agent owns it; a setting staff or another tool enabled is left alone. |
| Port discovery | The server asks `adb mdns services` once per cycle and matches entries by headset IP. Endpoint preference: `_adb-tls-connect._tcp`, then `_adb._tcp` (legacy tcpip), then `<ip>:5555`. The final fallback keeps a headset working on a PC where mDNS is unavailable. |
| Status back to the server | One optional telemetry field, `wirelessDebugging: "on" \| "off" \| "not_permitted"`, so the card can tell "tap Allow" from "one-time setup missing". |
| Persistence | Unchanged: only the global enabled flag is stored server-side; readings stay in memory. The agent persists only its ownership flag and last-requested boot count. |
| Pairing | None. The setup relies on the PC's adb key having been authorized over USB once per headset (the same prompt `adb tcpip` already needed). |

## Design

### 1. Wire protocol (three hand-synced places plus tests)

`shared/src/protocol.ts`:

- `CONTROLLER_MONITORING_CAPABILITY = "controller_monitoring_v1"`.
- `ControllerMonitoringSchema`: `{ type: "controller_monitoring", protocolVersion, enabled: boolean }`
  (server → agent).
- `TelemetrySchema` gains optional `wirelessDebugging: z.enum(["on","off","not_permitted"])`
  with `.catch(undefined)`: an unknown future value drops the field instead of
  rejecting the telemetry frame, because a rejected frame would stop the
  liveness refresh. Old agents omit the field; old servers ignore it (the schema
  is not strict, so unknown keys are stripped).

`quest-agent/.../Protocol.kt`: mirror both, add the capability to the default
`Hello.capabilities`, add `ParsedServerMessage.ControllerMonitoring`, and parse
`"controller_monitoring"` in `parseServerMessage`. The JSON config stays
`encodeDefaults = true; explicitNulls = false`.

`dashboard/src/types.ts`: add the two new controller reason codes (below); the
dashboard is not a party to the new message.

### 2. Agent

New `ControllerMonitoringController` with an injected `SecureSettings`
interface (read the setting, write the setting, read the boot count), and a
small preferences-backed store (`ownedByAgent`, `lastRequestBootCount`). A
missing grant is detected from the `SecurityException` Android throws on the
write, so there is no separate permission check.

`apply(enabled)`:

- **enabled = true**
  - setting already `1`: do nothing; ownership unchanged; state `on`.
  - `lastRequestBootCount == bootCount`: do nothing (already asked this boot).
  - otherwise `putInt(adb_wifi_enabled, 1)`. A `SecurityException` means the
    grant is missing: state `not_permitted`, nothing is recorded, so a later
    hello after the grant retries. On success record `lastRequestBootCount` and
    set `ownedByAgent = true` (the setting was off before the write). State is
    re-read from the setting for telemetry: `on` once the user allows, `off`
    while the dialog is pending or after a denial.
  - A reboot resets the setting, so ownership recorded in an earlier boot is
    discarded before any decision.
- **enabled = false**: if `ownedByAgent` and the setting is `1`, write `0`;
  clear `ownedByAgent` and `lastRequestBootCount`. Never touches a setting the
  agent did not enable.

The literal key `"adb_wifi_enabled"` is used because the framework constant is
hidden. `AgentConnection` routes the new parsed message to the controller;
telemetry building reads the controller's current state. Everything is wrapped
so an exception here can never break the connection loop.

Manifest: `<uses-permission android:name="android.permission.WRITE_SECURE_SETTINGS" />`
with a comment naming the one-time `pm grant`.

### 3. Server

`ControllerBatteryCollector`:

- Per cycle, one `adb mdns services` call (same `execFile` runner, short
  timeout, output cap). Parse tab/space-separated lines into
  `ip → {tls?: port, legacy?: port}`; ignore anything that is not a valid IPv4
  `ip:port`. A failure of this call is not a device failure: fall through to the
  `:5555` guess.
- `collectDevice` resolves the endpoint by the preference order above, then runs
  the existing `connect` → `dumpsys` → parse path unchanged. Ownership of
  `adb connect` endpoints (`already connected` is not claimed) is unchanged; the
  random TLS ports simply produce new owned endpoints, and `disconnectOwned`
  keeps cleaning them up best-effort.
- `CollectorTarget` gains `wirelessDebugging: "on" | "off" | "not_permitted" | null`.
  On a connect failure the recorded reason is `agent_permission_missing` when the
  agent reports `not_permitted`, `wireless_debugging_off` when it reports `off`,
  otherwise the existing `adb_connect_failed`. The agent state is consulted only
  after a connect actually failed, so a headset reachable through legacy
  `tcpip` never shows a Wireless Debugging hint just because the setting is off.

`Hub`:

- Stores the latest `wirelessDebugging` from telemetry on the in-memory
  connection record and exposes it through `controllerBatteryTargets()`.
- On hello, if the agent has the capability, sends
  `{type:"controller_monitoring", enabled}` using the collector's current
  `enabled` flag.
- New `broadcastControllerMonitoring(enabled)` sends the same frame to every
  connected capable agent; `app.ts` calls it after the
  `PUT /api/settings/controller-battery-monitoring` handler. A server restart
  needs no broadcast: every agent reconnects and the hello-time frame carries
  the restored flag.

### 4. Dashboard

- Two new reasons in `ControllerBatteryReason`, `messages.tsx` (English and
  Turkish side by side) and the card:
  - `wireless_debugging_off`: EN "Tap Allow on the headset to turn on Wireless
    Debugging" / TR "Kablosuz hata ayıklamayı açmak için gözlükte İzin ver'e
    dokunun".
  - `agent_permission_missing`: EN "One-time setup missing on this headset" / TR
    "Bu gözlükte tek seferlik kurulum eksik".
- The reason is shown as **visible text** on the card when there is no reading
  (not only the `title`), so staff see the action without hovering. The existing
  last-known/stale rendering for headsets that have a reading is unchanged.
- The header help text stops claiming it never touches Wireless Debugging:
  turning it on asks each headset to enable Wireless Debugging (tap Allow once
  after a reboot); turning it off switches it back off where CafeQuest enabled it.

### 5. Setup and documentation

Per headset, once: `adb shell pm grant com.cafequest.agent android.permission.WRITE_SECURE_SETTINGS`
and USB authorization of the café PC's adb key ("Always allow from this
computer"). After a reboot: open CafeQuest and tap **Allow** (always allow on
this network). Update `README.md`, `docs/known-limitations.md`,
`docs/architecture.md`, and the "Controller batteries" paragraph of `CLAUDE.md`
(including the sentence that the switch does not change Wireless Debugging).
Record the hardware table above and the new verification rows in
`docs/poc-test-results.md`.

## Risks and known limitations

- **A dialog can appear in a customer's headset.** Horizon OS shows the Allow
  dialog as a system panel. It only appears on an access point the headset has
  not trusted since its last boot, i.e. the first enable after a reboot or on a
  new access point. The once-per-boot rule keeps it from repeating; enabling the
  toggle while headsets are idle avoids surprising customers.
- **Trust is per access point.** A headset that roams between access points
  asks again at each new one. The café currently has one per headset and can
  consolidate to one.
- **Unverified on the café PC:** `adb mdns services` behaviour on a non-macOS
  host. The `:5555` fallback is the safety net, not proof.
- **The `dumpsys` text is still an unstable contract**, as before.
- Wireless Debugging is a LAN-reachable TLS ADB listener that accepts only
  already-authorized keys. This is within the project's LAN-only POC model, but
  it is a real, if bounded, widening: it is on only while the admin toggle is
  on and only on headsets that were given the one-time grant.

## Testing

- `shared`: schema tests for the new message (valid, wrong type/version, missing
  or non-boolean `enabled`), the telemetry field (each value, absent, invalid),
  and the capability string.
- Kotlin unit tests (JUnit4): controller `apply` with a fake `SecureSettings`:
  enable when off (put + owned), already on (not owned), `SecurityException` →
  `not_permitted`, second enable in the same boot is a no-op, new boot
  re-requests, disable only when owned, ownership survives a store reload,
  never throws. Protocol tests for `parseServerMessage` (valid, bad version,
  non-boolean) and that `Hello` advertises the capability.
- Server collector tests with the fake runner: mDNS parsing (TLS entry, legacy
  entry, both, none, garbage lines), endpoint preference order, `:5555` fallback
  when `mdns` fails, reason mapping for `off`/`not_permitted`/neither, and all
  existing collector tests unchanged and green.
- Hub/API tests: frame sent on hello only to capable agents, broadcast on toggle
  and on startup restore, telemetry field stored and exposed to targets, and no
  effect on online/session/command state.
- Dashboard tests, English and Turkish: both new reasons render as visible text,
  the updated help text, and the existing "leaves no English on a Turkish card"
  test still passing.
- Physical Quest 3 check (rows added to `docs/poc-test-results.md`): grant, USB
  authorize, toggle on, tap Allow, readings appear with no `tcpip`; reboot,
  open CafeQuest, tap Allow, readings return; deny the dialog, card shows the
  pending reason and does not re-prompt on reconnect; toggle off, Wireless
  Debugging switches off; run with the grant missing, card shows the setup reason.

## Out of scope

- Automatically accepting the Allow dialog, or any accessibility automation.
- Making the agent autostart on boot (tracked separately as `UNVERIFIED_HARDWARE`).
- `adb pair` / QR pairing, or storing ADB credentials.
- Having the agent report the TLS port (not readable by an app).
- Alerts, history, or any use of controller readings beyond the card badges.
- Verifying mDNS on Windows or Linux café PCs.
