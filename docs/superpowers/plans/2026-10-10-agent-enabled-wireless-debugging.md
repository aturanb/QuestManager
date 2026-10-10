# Agent-enabled Wireless Debugging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With the dashboard's controller-battery toggle on, the Android agent switches Horizon OS Wireless Debugging on by itself and the server finds the headset's random TLS port over mDNS, so controller levels appear without `adb tcpip` or USB after a reboot.

**Architecture:** The server tells each capable agent the monitoring flag (new `controller_monitoring` frame, sent at hello and on every toggle). The agent flips `Settings.Global` `adb_wifi_enabled` (needs a per-headset `WRITE_SECURE_SETTINGS` grant), asks for approval at most once per boot, and reports its Wireless Debugging state in telemetry. The collector resolves each headset's endpoint from one `adb mdns services` call per cycle (TLS service, then legacy `_adb._tcp`, then `<ip>:5555`) and turns a failed connect into an actionable reason using the agent's reported state.

**Tech Stack:** TypeScript (Zod, Fastify, `node:test`), Kotlin (kotlinx.serialization, JUnit4), React + vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-agent-enabled-wireless-debugging-design.md` (read it first; it holds the hardware findings behind every decision).

## Global Constraints

- Capability string is exactly `controller_monitoring_v1`; server → agent frame `type` is exactly `controller_monitoring` with `protocolVersion: 1` and a boolean `enabled`.
- Telemetry gains optional `wirelessDebugging` with values exactly `"on" | "off" | "not_permitted"`. An unknown value must be dropped, never reject the telemetry frame (a rejected frame stops the liveness refresh).
- The wire protocol lives in three hand-synced places: `shared/src/protocol.ts`, `quest-agent/.../Protocol.kt`, `dashboard/src/types.ts`. The Kotlin `Json` config must stay `encodeDefaults = true; explicitNulls = false`.
- The settings key is the literal string `"adb_wifi_enabled"` (the `Settings.Global` constant is hidden API).
- At most one enable request per boot (keyed by `Settings.Global.BOOT_COUNT`); the agent switches Wireless Debugging off only when it owns it; ownership from an earlier boot is discarded.
- mDNS service types: `_adb-tls-connect._tcp` (preferred), `_adb._tcp`; final fallback `<ip>:5555`. Only plain IPv4 `ip:port` values from mDNS may reach an `adb` argument. `execFile` takes argv, never a shell string.
- No raw ADB output, stderr, endpoints, or serials in any API response or log. Controller readings stay in memory only.
- New reason codes exactly `wireless_debugging_off` and `agent_permission_missing`; the agent state is consulted only after a connect actually failed.
- UI text lives in `dashboard/src/messages.tsx`, English and Turkish side by side. Turkish phrases never suffix a device name. Keep the Turkish help text containing `Kablosuz Hata Ayıklama` (an existing App test matches it).
- Backend has no watch mode: rebuild after every edit. `@cafequest/shared` resolves to `shared/dist/src/index.js`, so rebuild `shared` before `server`.
- Android builds need JDK 21: if `java -version` is not 21, prefix Gradle with `JAVA_HOME=$(/usr/libexec/java_home -v 21)`.
- Test apps use `dbPath: ":memory:"` and `port: 0`; tests never run the real `adb`.
- Only commit when told to by the person running this plan (the commit steps below are what to run once they have approved execution).

## Review Focus

Failure modes the spec implies but no obvious test would exercise; each has a pinned test in the task named.

1. **A future/garbage `wirelessDebugging` value or a non-boolean `enabled`** must not break telemetry or liveness, and must not crash the agent's frame parser (Task 1, Task 2, Task 6).
2. **Hostile or garbled `adb mdns services` output** (injection text, loopback, bad ports, extra columns) must never reach an `adb` argument or abort a cycle (Task 5).
3. **Reconnect storms must not re-raise the Allow dialog**: repeated `apply(true)` in one boot writes the setting once; a denied dialog stays denied until the toggle is cycled (Task 3).
4. **A headset working through legacy `adb tcpip` while Wireless Debugging reads "off"** must show readings, not a Wireless Debugging hint (Task 5).
5. **Turning monitoring off must not switch off a Wireless Debugging that staff enabled**, including after a reboot made old ownership stale (Task 3).
6. **Agents without the capability, and agents that connect while the toggle is already on,** get the right frames (none / the current flag) (Task 6).

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/src/protocol.ts` (modify) | Capability constant, `WirelessDebuggingSchema`, telemetry field, `ControllerMonitoringSchema` + types |
| `shared/tests/protocol.test.ts` (modify) | Schema tests |
| `quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt` (modify) | Kotlin mirror: capability, telemetry field, frame, parser branch |
| `quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt` (modify) | Mirror tests |
| `quest-agent/app/src/main/kotlin/com/cafequest/agent/ControllerMonitoringController.kt` (create) | Pure decision logic: `SecureSettings` + `ControllerMonitoringStore` seams, `ControllerMonitoringController`, `WirelessDebuggingState` wire values |
| `quest-agent/app/src/test/kotlin/com/cafequest/agent/ControllerMonitoringControllerTest.kt` (create) | Controller unit tests with fakes |
| `quest-agent/app/src/main/kotlin/com/cafequest/agent/ControllerMonitoringAndroid.kt` (create) | `AndroidSecureSettings`, `PrefsControllerMonitoringStore` |
| `quest-agent/app/src/main/AndroidManifest.xml` (modify) | `WRITE_SECURE_SETTINGS` |
| `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentService.kt`, `AgentConnection.kt` (modify) | Construct the controller, route the frame, report state in telemetry |
| `server/src/controller-battery.ts` (modify) | mDNS parse + endpoint choice, new reasons, `CollectorTarget.wirelessDebugging` |
| `server/tests/controller-battery.test.ts` (modify) | Collector tests |
| `server/src/hub.ts`, `server/src/app.ts` (modify) | Send frames, capture the agent's state, broadcast on toggle |
| `server/tests/controller-monitoring-frames.test.ts` (create) | Hub/app-boundary tests |
| `dashboard/src/types.ts`, `messages.tsx`, `components/DeviceCard.tsx`, `styles.css` (modify) | Reasons, strings, visible hint |
| `dashboard/src/components/DeviceCard.test.tsx`, `ControllerBatteryToggle.test.tsx` (modify) | UI tests |
| `README.md`, `CLAUDE.md`, `docs/quest-setup.md`, `docs/architecture.md`, `docs/known-limitations.md`, `docs/poc-test-results.md` (modify) | Setup, behavior, hardware findings |

---

### Task 1: Shared protocol additions

**Files:**
- Modify: `shared/src/protocol.ts`
- Test: `shared/tests/protocol.test.ts`

**Interfaces:**
- Produces: `CONTROLLER_MONITORING_CAPABILITY` (`"controller_monitoring_v1"`), `WirelessDebuggingSchema`, type `WirelessDebuggingState = "on" | "off" | "not_permitted"`, `ControllerMonitoringSchema`, type `ControllerMonitoring = { type: "controller_monitoring"; protocolVersion: 1; enabled: boolean }`, and `Telemetry.wirelessDebugging?: WirelessDebuggingState`. Tasks 5 and 6 import these from `@cafequest/shared`.

- [ ] **Step 1: Write the failing tests**

In `shared/tests/protocol.test.ts`, add `ControllerMonitoringSchema` and `CONTROLLER_MONITORING_CAPABILITY` to the existing import list from `"../src/protocol.js"`, then append at the end of the file:

```ts
test("controller_monitoring accepts exactly a boolean in the v1 envelope", () => {
  const frame = { type: "controller_monitoring", protocolVersion: 1, enabled: true };
  assert.equal(ControllerMonitoringSchema.safeParse(frame).success, true);
  assert.equal(ControllerMonitoringSchema.safeParse({ ...frame, enabled: false }).success, true);
  for (const bad of [
    { ...frame, enabled: "true" },
    { ...frame, enabled: 1 },
    { ...frame, enabled: null },
    { type: frame.type, protocolVersion: 1 },
    { ...frame, protocolVersion: 2 },
    { ...frame, type: "controller_monitor" },
  ]) {
    assert.equal(ControllerMonitoringSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("hello accepts controller_monitoring_v1 beside the other capabilities", () => {
  assert.equal(CONTROLLER_MONITORING_CAPABILITY, "controller_monitoring_v1");
  const parsed = HelloSchema.safeParse({
    ...hello,
    capabilities: ["launch_android_package", "screen_cast_v1", CONTROLLER_MONITORING_CAPABILITY],
  });
  assert.equal(parsed.success, true);
});

test("telemetry carries wirelessDebugging, and an unknown value never rejects the frame", () => {
  for (const state of ["on", "off", "not_permitted"] as const) {
    const parsed = parseAgentMessage(JSON.stringify({ ...telemetry, wirelessDebugging: state }));
    assert.equal(parsed.ok, true);
    if (parsed.ok && parsed.value.type === "telemetry") assert.equal(parsed.value.wirelessDebugging, state);
  }
  // Absent stays absent: older agents never send it.
  const absent = parseAgentMessage(JSON.stringify(telemetry));
  assert.equal(absent.ok, true);
  if (absent.ok && absent.value.type === "telemetry") assert.equal(absent.value.wirelessDebugging, undefined);
  // A future value must not cost the headset its liveness refresh.
  for (const future of ["paired", "", 7, null, { state: "on" }]) {
    const parsed = parseAgentMessage(JSON.stringify({ ...telemetry, wirelessDebugging: future }));
    assert.equal(parsed.ok, true, JSON.stringify(future));
    if (parsed.ok && parsed.value.type === "telemetry") assert.equal(parsed.value.wirelessDebugging, undefined);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w shared 2>&1 | tail -5`
Expected: FAIL: `TS2305`/`TS2724` errors that `ControllerMonitoringSchema` and `CONTROLLER_MONITORING_CAPABILITY` are not exported.

- [ ] **Step 3: Implement**

In `shared/src/protocol.ts`:

1. After the `SCREEN_CAST_CAPABILITY` line (line 6) add:

```ts
/** Capability that gates the server → agent monitoring frame; older agents omit it. */
export const CONTROLLER_MONITORING_CAPABILITY = "controller_monitoring_v1" as const;
```

2. Immediately above `export const TelemetrySchema` add:

```ts
/** Agent-reported Horizon OS Wireless Debugging state; used only for advisory UI hints. */
export const WirelessDebuggingSchema = z.enum(["on", "off", "not_permitted"]);
```

3. Inside `TelemetrySchema`, after the `usage: UsageStateSchema.optional(),` line add:

```ts
  // Advisory only. An unknown future value drops the field instead of rejecting
  // the frame, because a rejected telemetry frame would stop the liveness refresh.
  wirelessDebugging: WirelessDebuggingSchema.optional().catch(undefined),
```

4. After `CastStopSchema` (before `ViewerCastSignalSchema`) add:

```ts
/** Server → agent: the monitoring flag; the agent turns Wireless Debugging on or off for it. */
export const ControllerMonitoringSchema = z.object({
  type: z.literal("controller_monitoring"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  enabled: z.boolean(),
});
```

5. In the type exports near the end add:

```ts
export type WirelessDebuggingState = z.infer<typeof WirelessDebuggingSchema>;
export type ControllerMonitoring = z.infer<typeof ControllerMonitoringSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w shared 2>&1 | tail -15`
Expected: all tests pass (previous 28 plus 3 new), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add shared/src/protocol.ts shared/tests/protocol.test.ts
git commit -m "feat(protocol): add controller_monitoring frame and wirelessDebugging telemetry"
```

---

### Task 2: Kotlin protocol mirror

**Files:**
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt`
- Test: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt`

**Interfaces:**
- Consumes: the wire shapes from Task 1.
- Produces: `const val CAPABILITY_CONTROLLER_MONITORING`, `Telemetry.wirelessDebugging: String?`, `data class ControllerMonitoringMessage(type, protocolVersion, enabled: Boolean)`, `ParsedServerMessage.ControllerMonitoring(val message: ControllerMonitoringMessage)`. Task 4 consumes all of these.

- [ ] **Step 1: Write the failing tests**

In `ProtocolTest.kt`, replace the body of the test `the default hello advertises package launch and screen cast exactly once` so its first assertion expects the third capability:

```kotlin
    @Test fun `the default hello advertises package launch, screen cast and controller monitoring exactly once`() {
        val json = protocolJson.encodeToString(
            Hello(deviceId = "d", deviceName = "Quest 01", deviceModel = "Quest 3", agentVersion = "0.5.0")
        )
        assertTrue(
            json.contains("\"capabilities\":[\"launch_android_package\",\"screen_cast_v1\",\"controller_monitoring_v1\"]")
        )
        assertEquals(1, Regex(Regex.escape(CAPABILITY_SCREEN_CAST)).findAll(json).count())
        assertEquals(1, Regex(Regex.escape(CAPABILITY_CONTROLLER_MONITORING)).findAll(json).count())
    }
```

Then add these tests inside the `ProtocolTest` class (before its closing brace):

```kotlin
    @Test fun `parseServerMessage reads a controller monitoring frame`() {
        val on = parseServerMessage("""{"type":"controller_monitoring","protocolVersion":1,"enabled":true}""")
        assertTrue(on is ParsedServerMessage.ControllerMonitoring)
        assertTrue((on as ParsedServerMessage.ControllerMonitoring).message.enabled)
        val off = parseServerMessage("""{"type":"controller_monitoring","protocolVersion":1,"enabled":false}""")
        assertFalse((off as ParsedServerMessage.ControllerMonitoring).message.enabled)
    }

    @Test fun `parseServerMessage rejects malformed monitoring frames`() {
        for (raw in listOf(
            """{"type":"controller_monitoring","protocolVersion":1}""",
            """{"type":"controller_monitoring","protocolVersion":1,"enabled":"true"}""",
            """{"type":"controller_monitoring","protocolVersion":1,"enabled":1}""",
            """{"type":"controller_monitoring","protocolVersion":1,"enabled":null}""",
            """{"type":"controller_monitoring","protocolVersion":2,"enabled":true}""",
            """{"type":"controller_monitoring","enabled":true}""",
        )) {
            assertNull(raw, parseServerMessage(raw))
        }
    }

    @Test fun `telemetry carries wirelessDebugging and omits it when unset`() {
        val withState = protocolJson.encodeToString(
            Telemetry(
                deviceId = "d",
                timestamp = "2026-10-10T00:00:00Z",
                battery = Battery(80, false),
                agent = AgentState(true),
                wirelessDebugging = "off",
            )
        )
        assertTrue(withState.contains("\"wirelessDebugging\":\"off\""))
        val without = protocolJson.encodeToString(
            Telemetry(
                deviceId = "d",
                timestamp = "2026-10-10T00:00:00Z",
                battery = Battery(80, false),
                agent = AgentState(true),
            )
        )
        assertFalse(without.contains("wirelessDebugging"))
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd quest-agent && ./gradlew testDebugUnitTest --tests "com.cafequest.agent.ProtocolTest" 2>&1 | tail -15`
Expected: FAIL: compilation errors (`CAPABILITY_CONTROLLER_MONITORING`, `ParsedServerMessage.ControllerMonitoring`, `wirelessDebugging` unresolved).

- [ ] **Step 3: Implement**

In `Protocol.kt`:

1. Add the import `import kotlinx.serialization.json.JsonPrimitive` and `import kotlinx.serialization.json.booleanOrNull` beside the other `kotlinx.serialization.json` imports.
2. After `const val CAPABILITY_SCREEN_CAST = "screen_cast_v1"` add:

```kotlin
const val CAPABILITY_CONTROLLER_MONITORING = "controller_monitoring_v1"
```

3. Change the `Hello` default capabilities to:

```kotlin
    val capabilities: List<String> = listOf(
        CAPABILITY_LAUNCH_ANDROID_PACKAGE,
        CAPABILITY_SCREEN_CAST,
        CAPABILITY_CONTROLLER_MONITORING,
    ),
```

4. Add a field at the end of `Telemetry`:

```kotlin
    val usage: UsageState? = null,
    /** "on" | "off" | "not_permitted"; advisory only (mirrors shared WirelessDebuggingSchema). */
    val wirelessDebugging: String? = null,
```

5. After `CastStopMessage` add:

```kotlin
@Serializable
data class ControllerMonitoringMessage(
    val type: String = "controller_monitoring",
    val protocolVersion: Int = PROTOCOL_VERSION,
    val enabled: Boolean,
)
```

6. Add a variant to `ParsedServerMessage`:

```kotlin
    data class ControllerMonitoring(val message: ControllerMonitoringMessage) : ParsedServerMessage
```

7. In `parseServerMessage`, add this branch before `else -> null`:

```kotlin
        "controller_monitoring" -> {
            // A quoted "true" or a number is not a boolean on this wire.
            val enabled = element["enabled"] as? JsonPrimitive
            if (enabled == null || enabled.isString) return null
            val value = enabled.booleanOrNull ?: return null
            ParsedServerMessage.ControllerMonitoring(ControllerMonitoringMessage(enabled = value))
        }
```

8. `AgentConnection.kt` has a `when` over `ParsedServerMessage` that Kotlin requires to be exhaustive, so main would no longer compile. In its `onMessage`, add this placeholder line directly above `null -> Unit` (Task 4 replaces it with the real handler):

```kotlin
                    is ParsedServerMessage.ControllerMonitoring -> Unit
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd quest-agent && ./gradlew testDebugUnitTest --tests "com.cafequest.agent.ProtocolTest" 2>&1 | tail -15`
Expected: BUILD SUCCESSFUL, the new `ProtocolTest` tests included.

- [ ] **Step 5: Commit**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt
git commit -m "feat(agent): mirror the controller_monitoring frame and wirelessDebugging telemetry"
```

---

### Task 3: Agent decision logic

**Files:**
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/ControllerMonitoringController.kt`
- Test: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ControllerMonitoringControllerTest.kt`

**Interfaces:**
- Produces (Task 4 consumes these exact names):
  - `object WirelessDebuggingState { const val ON = "on"; const val OFF = "off"; const val NOT_PERMITTED = "not_permitted" }`
  - `interface SecureSettings { fun adbWifiEnabled(): Int; fun setAdbWifiEnabled(value: Int); fun bootCount(): Int }` (`setAdbWifiEnabled` throws `SecurityException` without the grant)
  - `interface ControllerMonitoringStore { var ownedByAgent: Boolean; var lastRequestBootCount: Int }` (`-1` = never)
  - `class ControllerMonitoringController(settings: SecureSettings, store: ControllerMonitoringStore)` with `fun apply(enabled: Boolean)` and `fun wireState(): String`

- [ ] **Step 1: Write the failing tests**

Create `ControllerMonitoringControllerTest.kt`:

```kotlin
package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeSettings(
    var wifi: Int = 0,
    var boot: Int = 1,
    var granted: Boolean = true,
) : SecureSettings {
    val writes = mutableListOf<Int>()
    override fun adbWifiEnabled(): Int = wifi
    override fun setAdbWifiEnabled(value: Int) {
        if (!granted) throw SecurityException("WRITE_SECURE_SETTINGS")
        writes += value
        wifi = value
    }
    override fun bootCount(): Int = boot
}

private class FakeStore : ControllerMonitoringStore {
    override var ownedByAgent = false
    override var lastRequestBootCount = -1
}

class ControllerMonitoringControllerTest {
    private fun controller(settings: FakeSettings, store: FakeStore = FakeStore()) =
        ControllerMonitoringController(settings, store)

    @Test fun `enabling while off turns Wireless Debugging on and owns it`() {
        val settings = FakeSettings(wifi = 0)
        val store = FakeStore()
        controller(settings, store).apply(true)
        assertEquals(listOf(1), settings.writes)
        assertTrue(store.ownedByAgent)
        assertEquals(1, store.lastRequestBootCount)
    }

    @Test fun `enabling while staff already turned it on writes nothing and owns nothing`() {
        val settings = FakeSettings(wifi = 1)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        assertTrue(settings.writes.isEmpty())
        assertFalse(store.ownedByAgent)
        assertEquals(WirelessDebuggingState.ON, c.wireState())
    }

    @Test fun `a missing grant reports not_permitted and records nothing so a later grant retries`() {
        val settings = FakeSettings(wifi = 0, granted = false)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        assertEquals(WirelessDebuggingState.NOT_PERMITTED, c.wireState())
        assertFalse(store.ownedByAgent)
        assertEquals(-1, store.lastRequestBootCount)
        settings.granted = true
        c.apply(true)
        assertEquals(listOf(1), settings.writes)
        assertEquals(WirelessDebuggingState.ON, c.wireState())
    }

    @Test fun `reconnect storms never re-raise the dialog within one boot`() {
        val settings = FakeSettings(wifi = 0)
        val c = controller(settings)
        c.apply(true)
        // The person denied the dialog, so the system put the setting back to off.
        settings.wifi = 0
        repeat(5) { c.apply(true) }
        assertEquals("one request per boot", listOf(1), settings.writes)
        assertEquals(WirelessDebuggingState.OFF, c.wireState())
    }

    @Test fun `a new boot asks again`() {
        val settings = FakeSettings(wifi = 0, boot = 1)
        val c = controller(settings)
        c.apply(true)
        settings.wifi = 0
        settings.boot = 2
        c.apply(true)
        assertEquals(listOf(1, 1), settings.writes)
    }

    @Test fun `disabling switches off only what the agent turned on`() {
        val settings = FakeSettings(wifi = 0)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        c.apply(false)
        assertEquals(listOf(1, 0), settings.writes)
        assertFalse(store.ownedByAgent)
        assertEquals(-1, store.lastRequestBootCount)
    }

    @Test fun `disabling leaves a setting staff enabled alone`() {
        val settings = FakeSettings(wifi = 1)
        val c = controller(settings)
        c.apply(true)
        c.apply(false)
        assertTrue(settings.writes.isEmpty())
        assertEquals(1, settings.wifi)
    }

    @Test fun `ownership from an earlier boot is discarded`() {
        val settings = FakeSettings(wifi = 0, boot = 1)
        val store = FakeStore()
        val c = controller(settings, store)
        c.apply(true)
        assertTrue(store.ownedByAgent)
        // Reboot: Horizon OS reset the setting, then staff switched it on by hand.
        settings.boot = 2
        settings.wifi = 1
        c.apply(false)
        assertTrue("staff's setting is not ours any more", settings.writes == listOf(1))
        assertEquals(1, settings.wifi)
    }

    @Test fun `turning monitoring off then on re-arms the request within the same boot`() {
        val settings = FakeSettings(wifi = 0)
        val c = controller(settings)
        c.apply(true)
        settings.wifi = 0 // denied
        c.apply(false)
        c.apply(true)
        assertEquals(listOf(1, 1), settings.writes)
    }

    @Test fun `ownership survives a process restart through the store`() {
        val settings = FakeSettings(wifi = 0)
        val store = FakeStore()
        controller(settings, store).apply(true)
        // A fresh controller over the same store, as after the agent process restarts.
        controller(settings, store).apply(false)
        assertEquals(listOf(1, 0), settings.writes)
    }

    @Test fun `disabling with the grant revoked never throws`() {
        val settings = FakeSettings(wifi = 0)
        val c = controller(settings)
        c.apply(true)
        settings.granted = false
        c.apply(false)
        assertEquals(listOf(1), settings.writes)
    }

    @Test fun `wire state follows the setting`() {
        val settings = FakeSettings(wifi = 1)
        val c = controller(settings)
        assertEquals(WirelessDebuggingState.ON, c.wireState())
        settings.wifi = 0
        assertEquals(WirelessDebuggingState.OFF, c.wireState())
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd quest-agent && ./gradlew testDebugUnitTest --tests "com.cafequest.agent.ControllerMonitoringControllerTest" 2>&1 | tail -12`
Expected: FAIL: unresolved references (`SecureSettings`, `ControllerMonitoringController`, ...).

- [ ] **Step 3: Implement**

Create `ControllerMonitoringController.kt`:

```kotlin
package com.cafequest.agent

/** Wire values of Telemetry.wirelessDebugging (mirrors shared WirelessDebuggingSchema). */
object WirelessDebuggingState {
    const val ON = "on"
    const val OFF = "off"
    const val NOT_PERMITTED = "not_permitted"
}

/** The three Settings.Global operations the controller needs, behind a seam for unit tests. */
interface SecureSettings {
    /** 1 while Horizon OS Wireless Debugging is on, 0 while it is off. */
    fun adbWifiEnabled(): Int

    /** Throws SecurityException when WRITE_SECURE_SETTINGS has not been granted. */
    fun setAdbWifiEnabled(value: Int)

    /** Settings.Global.BOOT_COUNT: changes on every reboot. */
    fun bootCount(): Int
}

/** What must outlive the process: who turned the setting on, and in which boot we last asked. */
interface ControllerMonitoringStore {
    var ownedByAgent: Boolean

    /** -1 until a request has been made. */
    var lastRequestBootCount: Int
}

/**
 * Turns Horizon OS Wireless Debugging on for the server's controller-battery
 * monitoring, without ever re-raising the system "Allow wireless debugging?"
 * dialog more than once per boot and without ever switching off a setting staff
 * enabled themselves. Failures here change only the reported state; nothing
 * throws into the connection loop.
 */
class ControllerMonitoringController(
    private val settings: SecureSettings,
    private val store: ControllerMonitoringStore,
) {
    @Volatile private var denied = false

    @Synchronized
    fun apply(enabled: Boolean) {
        val boot = settings.bootCount()
        // A reboot resets Wireless Debugging, so ownership from an earlier boot is stale.
        if (store.lastRequestBootCount != boot) store.ownedByAgent = false
        if (enabled) enable(boot) else disable()
    }

    private fun enable(boot: Int) {
        if (settings.adbWifiEnabled() == 1) {
            denied = false
            return
        }
        // Already asked this boot: a denied dialog must not come back on every reconnect.
        if (store.lastRequestBootCount == boot) return
        try {
            settings.setAdbWifiEnabled(1)
            store.lastRequestBootCount = boot
            store.ownedByAgent = true
            denied = false
        } catch (_: SecurityException) {
            denied = true
        }
    }

    private fun disable() {
        if (store.ownedByAgent && settings.adbWifiEnabled() == 1) {
            try {
                settings.setAdbWifiEnabled(0)
            } catch (_: SecurityException) {
                // The grant was revoked; leave the setting as it is.
            }
        }
        store.ownedByAgent = false
        store.lastRequestBootCount = -1
        denied = false
    }

    /** The value reported in telemetry: what the setting says now, or that the grant is missing. */
    @Synchronized
    fun wireState(): String = when {
        settings.adbWifiEnabled() == 1 -> WirelessDebuggingState.ON
        denied -> WirelessDebuggingState.NOT_PERMITTED
        else -> WirelessDebuggingState.OFF
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd quest-agent && ./gradlew testDebugUnitTest --tests "com.cafequest.agent.ControllerMonitoringControllerTest" 2>&1 | tail -12`
Expected: BUILD SUCCESSFUL, 11 tests passed.

- [ ] **Step 5: Commit**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/ControllerMonitoringController.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ControllerMonitoringControllerTest.kt
git commit -m "feat(agent): add the Wireless Debugging controller for controller monitoring"
```

---

### Task 4: Agent wiring

**Files:**
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/ControllerMonitoringAndroid.kt`
- Modify: `quest-agent/app/src/main/AndroidManifest.xml`, `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentService.kt`, `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt`

**Interfaces:**
- Consumes: `SecureSettings`, `ControllerMonitoringStore`, `ControllerMonitoringController`, `WirelessDebuggingState` (Task 3); `ParsedServerMessage.ControllerMonitoring`, `Telemetry.wirelessDebugging` (Task 2).
- Produces: a running agent that reacts to the frame and reports `wirelessDebugging`. No new public names beyond the two Android classes.

There is no unit test for this wiring (it needs a `Context`); the logic is covered in Task 3 and the full path in the physical check (Task 8). The compile plus the whole unit suite is this task's gate.

- [ ] **Step 1: Add the Android implementations**

Create `ControllerMonitoringAndroid.kt`:

```kotlin
package com.cafequest.agent

import android.content.Context
import android.provider.Settings

/** Real Settings.Global access. The key is a literal because ADB_WIFI_ENABLED is hidden API. */
class AndroidSecureSettings(private val context: Context) : SecureSettings {
    override fun adbWifiEnabled(): Int = Settings.Global.getInt(context.contentResolver, KEY, 0)

    override fun setAdbWifiEnabled(value: Int) {
        // Throws SecurityException until `pm grant ... WRITE_SECURE_SETTINGS` has been run once.
        Settings.Global.putInt(context.contentResolver, KEY, value)
    }

    override fun bootCount(): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, 0)

    private companion object {
        const val KEY = "adb_wifi_enabled"
    }
}

/** Ownership and the boot of the last request, kept across agent process restarts. */
class PrefsControllerMonitoringStore(context: Context) : ControllerMonitoringStore {
    private val prefs = context.getSharedPreferences("controller_monitoring", Context.MODE_PRIVATE)

    override var ownedByAgent: Boolean
        get() = prefs.getBoolean("ownedByAgent", false)
        set(value) = prefs.edit().putBoolean("ownedByAgent", value).apply()

    override var lastRequestBootCount: Int
        get() = prefs.getInt("lastRequestBootCount", -1)
        set(value) = prefs.edit().putInt("lastRequestBootCount", value).apply()
}
```

- [ ] **Step 2: Declare the permission**

In `AndroidManifest.xml`, after the `SYSTEM_ALERT_WINDOW` `<uses-permission>` line add:

```xml
    <!-- Optional controller-battery diagnostics: lets the agent switch Horizon OS
         Wireless Debugging on for the server. Grant once per headset with
         `adb shell pm grant com.cafequest.agent android.permission.WRITE_SECURE_SETTINGS`. -->
    <uses-permission android:name="android.permission.WRITE_SECURE_SETTINGS" />
```

- [ ] **Step 3: Construct the controller in the service**

In `AgentService.kt`:

1. Below the line `private lateinit var casting: CastingController` add:

```kotlin
    private lateinit var controllerMonitoring: ControllerMonitoringController
```

2. In `onCreate`, directly after the `casting = CastingController(...)` assignment add:

```kotlin
        controllerMonitoring = ControllerMonitoringController(
            settings = AndroidSecureSettings(this),
            store = PrefsControllerMonitoringStore(this),
        )
```

3. In the `AgentConnection(...)` construction, add the argument after `casting = casting,`:

```kotlin
                controllerMonitoring = controllerMonitoring,
```

- [ ] **Step 4: Route the frame and report the state**

In `AgentConnection.kt`:

1. Add a constructor parameter after `private val casting: CastingController? = null,`:

```kotlin
    private val controllerMonitoring: ControllerMonitoringController? = null,
```

2. In `onMessage`, replace the placeholder `is ParsedServerMessage.ControllerMonitoring -> Unit` line that Task 2 added with:

```kotlin
                    // A failure here must never reach the connection loop.
                    is ParsedServerMessage.ControllerMonitoring ->
                        runCatching { controllerMonitoring?.apply(message.message.enabled) }
                            .onFailure { Log.w(LOG_TAG, "controller monitoring apply failed: ${it.message}") }
```

3. In `sendTelemetry`, add the field to the `Telemetry(...)` construction after the `usage = UsageState(...)` argument:

```kotlin
            wirelessDebugging = runCatching { controllerMonitoring?.wireState() }.getOrNull(),
```

- [ ] **Step 5: Run the whole agent test suite and build**

Run: `cd quest-agent && ./gradlew testDebugUnitTest assembleDebug 2>&1 | tail -15`
Expected: BUILD SUCCESSFUL; all existing and new tests pass.

- [ ] **Step 6: Commit**

```bash
git add quest-agent/app/src/main
git commit -m "feat(agent): switch Wireless Debugging on for controller monitoring and report its state"
```

---

### Task 5: Server collector: mDNS endpoint resolution and reasons

**Files:**
- Modify: `server/src/controller-battery.ts`
- Test: `server/tests/controller-battery.test.ts`

**Interfaces:**
- Consumes: `WirelessDebuggingState` from `@cafequest/shared` (Task 1; run `npm run build -w shared` first).
- Produces: `CollectorTarget.wirelessDebugging?: WirelessDebuggingState` (optional, so existing targets stay valid); `export type MdnsEndpoints`; `export function parseMdnsServices(raw: string): MdnsEndpoints`; two new `ControllerBatteryReason` members. Task 6 passes `wirelessDebugging` through the hub's targets; Task 7 mirrors the reason codes.

- [ ] **Step 1: Write the failing tests**

In `server/tests/controller-battery.test.ts`:

1. Add `parseMdnsServices` to the import from `"../src/controller-battery.js"`.
2. In the `FakeAdb` class add these fields next to the others:

```ts
  mdnsImpl: () => string = () => "";
  mdnsThrows = false;
```

and this branch in `runner`, directly before the `if (command === "disconnect")` branch:

```ts
    if (command === "mdns") {
      if (this.mdnsThrows) throw new Error("adb mdns failed");
      return { stdout: this.mdnsImpl(), stderr: "" };
    }
```

3. Append these tests at the end of the file:

```ts
// --- agent-enabled Wireless Debugging: endpoint discovery and reasons ------

const MDNS_REAL = [
  "List of discovered mdns services",
  "adb-2G0YC5ZG8106W2-OgB7Wc\t_adb-tls-connect._tcp\t192.168.1.109:40911",
  "adb-2G0YC5ZG8106W2\t_adb._tcp\t192.168.1.109:5555",
  "",
].join("\n");

test("parseMdnsServices keeps the TLS and legacy endpoint per headset address", () => {
  const found = parseMdnsServices(MDNS_REAL);
  assert.deepEqual([...found.entries()], [["192.168.1.109", { tls: "192.168.1.109:40911", legacy: "192.168.1.109:5555" }]]);
});

test("parseMdnsServices ignores pairing services, headers, and anything that is not a plain IPv4:port", () => {
  const found = parseMdnsServices(
    [
      "List of discovered mdns services",
      "adb-x\t_adb-tls-pairing._tcp\t192.168.1.30:37123",
      "adb-x\t_adb._tcp\t192.168.1.31;reboot:5555",
      "adb-x\t_adb._tcp\t127.0.0.1:5555",
      "adb-x\t_adb._tcp\t[fe80::1]:5555",
      "adb-x\t_adb._tcp\t192.168.1.32:99999",
      "adb-x\t_adb._tcp\t192.168.1.33:0",
      "adb-x\t_adb._tcp\t192.168.1.34:abc",
      "adb-x _adb._tcp 192.168.1.35; reboot:5555",
      "garbage",
      "",
    ].join("\n")
  );
  assert.equal(found.size, 0);
});

test("the TLS endpoint is preferred, and one mdns call serves every headset in the cycle", async () => {
  const h = harness({
    targets: () => [
      { deviceId: "dev-1", address: "192.168.1.109" },
      { deviceId: "dev-2", address: "192.168.1.110" },
    ],
  });
  h.adb.mdnsImpl = () => MDNS_REAL;
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  const argv = h.adb.argv();
  assert.ok(argv.includes("/opt/platform-tools/adb connect 192.168.1.109:40911"), "TLS endpoint wins");
  assert.ok(argv.some((line) => line.includes("-s 192.168.1.109:40911 shell dumpsys OVRRemoteService")));
  assert.ok(argv.includes("/opt/platform-tools/adb connect 192.168.1.110:5555"), "unlisted headset falls back to 5555");
  assert.equal(h.adb.count("mdns"), 1, "discovery runs once per cycle, not per headset");
  await h.collector.setEnabled(false);
});

test("a headset advertising only the legacy service uses that port", async () => {
  const h = harness();
  h.adb.mdnsImpl = () => "adb-x\t_adb._tcp\t192.168.1.109:5556\n";
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.ok(h.adb.argv().includes("/opt/platform-tools/adb connect 192.168.1.109:5556"));
  await h.collector.setEnabled(false);
});

test("a failing mdns call never fails the cycle: the 5555 guess still reads the headset", async () => {
  const h = harness();
  h.adb.mdnsThrows = true;
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.ok(h.adb.argv().includes("/opt/platform-tools/adb connect 192.168.1.109:5555"));
  assert.equal(h.collector.deviceState("dev-1")?.status, "available");
  await h.collector.setEnabled(false);
});

test("hostile mdns text never reaches an adb argument", async () => {
  const h = harness();
  h.adb.mdnsImpl = () => "adb-x\t_adb._tcp\t192.168.1.109;reboot:5555\nadb-y _adb._tcp 192.168.1.109; rm -rf /:5555\n";
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.ok(!h.adb.argv().some((line) => line.includes(";")), "no argument carries mdns-supplied shell text");
  assert.ok(h.adb.argv().includes("/opt/platform-tools/adb connect 192.168.1.109:5555"));
  await h.collector.setEnabled(false);
});

test("a headset with no wireless address causes no mdns call at all", async () => {
  const h = harness({ targets: () => [{ deviceId: "dev-1", address: null }] });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.equal(h.adb.count("mdns"), 0);
  await h.collector.setEnabled(false);
});

test("a failed connect is explained by what the agent reported, and only then", async () => {
  const cases: Array<[CollectorTarget["wirelessDebugging"], string]> = [
    ["off", "wireless_debugging_off"],
    ["not_permitted", "agent_permission_missing"],
    ["on", "adb_connect_failed"],
    [undefined, "adb_connect_failed"],
  ];
  for (const [reported, reason] of cases) {
    const h = harness({ targets: () => [{ deviceId: "dev-1", address: "192.168.1.109", wirelessDebugging: reported }] });
    h.adb.connectThrows = true;
    await h.collector.setEnabled(true);
    await h.collector.pollNow();
    assert.equal(h.collector.deviceState("dev-1")?.reason, reason, String(reported));
    await h.collector.setEnabled(false);
  }
});

test("a headset readable through legacy tcpip shows readings even while Wireless Debugging reads off", async () => {
  const h = harness({ targets: () => [{ deviceId: "dev-1", address: "192.168.1.109", wirelessDebugging: "off" }] });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  const state = h.collector.deviceState("dev-1");
  assert.equal(state?.status, "available");
  assert.equal(state?.reason, null);
  await h.collector.setEnabled(false);
});

test("a stale reading keeps its values and takes the actionable reason when the agent says off", async () => {
  let reported: CollectorTarget["wirelessDebugging"] = "on";
  const h = harness({ targets: () => [{ deviceId: "dev-1", address: "192.168.1.109", wirelessDebugging: reported }] });
  await h.collector.setEnabled(true);
  await h.collector.pollNow();
  assert.equal(h.collector.deviceState("dev-1")?.status, "available");
  h.adb.connectThrows = true;
  reported = "off";
  await h.collector.pollNow();
  const state = h.collector.deviceState("dev-1");
  assert.equal(state?.status, "stale");
  assert.equal(state?.reason, "wireless_debugging_off");
  assert.equal(state?.left?.level, 100);
  await h.collector.setEnabled(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w shared && npm run build -w server 2>&1 | tail -8`
Expected: FAIL: `parseMdnsServices` not exported; `wirelessDebugging` not in `CollectorTarget`.

- [ ] **Step 3: Implement**

In `server/src/controller-battery.ts`:

1. Add below the `node:child_process` import:

```ts
import type { WirelessDebuggingState } from "@cafequest/shared";
```

2. Extend the reason union:

```ts
export type ControllerBatteryReason =
  | null
  | "headset_offline"
  | "no_wireless_address"
  | "adb_connect_failed"
  | "wireless_debugging_off"
  | "agent_permission_missing"
  | "dump_failed"
  | "parse_failed";
```

3. Replace the `CollectorTarget` type:

```ts
/**
 * One live agent connection: where its socket came from, if it is pollable, and
 * what its Horizon OS Wireless Debugging looked like at the last telemetry.
 */
export type CollectorTarget = {
  deviceId: string;
  address: string | null;
  wirelessDebugging?: WirelessDebuggingState;
};
```

4. Below `const MAX_OUTPUT_BYTES = ...` add:

```ts
const MDNS_TIMEOUT_MS = 3_000;
const MDNS_TLS_SERVICE = "_adb-tls-connect._tcp";
const MDNS_LEGACY_SERVICE = "_adb._tcp";
```

5. Below `normalizeRemoteIpv4` add:

```ts
/** Wireless ADB endpoints a headset advertises over mDNS, keyed by its IPv4. */
export type MdnsEndpoints = Map<string, { tls?: string; legacy?: string }>;

/**
 * Parse `adb mdns services`. Only the two connectable ADB service types are
 * kept, and only when the endpoint is a plain IPv4 with a numeric port, so
 * nothing else in the output can ever become an argument to `adb`.
 */
export function parseMdnsServices(raw: string): MdnsEndpoints {
  const found: MdnsEndpoints = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const service = parts[1];
    const endpoint = parts[2] ?? "";
    if (service !== MDNS_TLS_SERVICE && service !== MDNS_LEGACY_SERVICE) continue;
    const split = endpoint.lastIndexOf(":");
    if (split === -1) continue;
    const ip = normalizeRemoteIpv4(endpoint.slice(0, split));
    const portText = endpoint.slice(split + 1);
    if (!ip || !/^\d{1,5}$/.test(portText)) continue;
    const port = Number(portText);
    if (port < 1 || port > 65_535) continue;
    const entry = found.get(ip) ?? {};
    if (service === MDNS_TLS_SERVICE) {
      if (!entry.tls) entry.tls = `${ip}:${port}`;
    } else if (!entry.legacy) {
      entry.legacy = `${ip}:${port}`;
    }
    found.set(ip, entry);
  }
  return found;
}

/** TLS Wireless Debugging first, then a legacy tcpip service, then the 5555 guess. */
function endpointFor(address: string, endpoints: MdnsEndpoints): string {
  const found = endpoints.get(address);
  return found?.tls ?? found?.legacy ?? `${address}:${ADB_TCP_PORT}`;
}
```

6. In `runCycle`, replace the `await Promise.all(...)` line with:

```ts
    // One mDNS listing serves every headset; skipped when nobody is pollable.
    const endpoints: MdnsEndpoints = targets.some((target) => target.address)
      ? await this.discoverEndpoints()
      : new Map();
    if (generation !== this.generation) return;
    // Headsets are polled concurrently; each device still runs one operation at
    // a time because a cycle is single-flight.
    await Promise.all(targets.map((target) => this.collectDevice(target, generation, endpoints)));
```

and delete the two comment lines that previously preceded the removed `Promise.all` line (the "Headsets are polled concurrently..." comment now lives in the replacement).

7. Change `collectDevice`'s signature and endpoint, and use the new failure reason in both connect-failure sites:

```ts
  private async collectDevice(target: CollectorTarget, generation: number, endpoints: MdnsEndpoints): Promise<void> {
    if (generation !== this.generation) return;
    if (!target.address) {
      this.recordFailure(target.deviceId, "no_wireless_address", generation);
      return;
    }
    const endpoint = endpointFor(target.address, endpoints);
    try {
      const connected = await this.options.runner(
        this.options.adbPath,
        ["connect", endpoint],
        CONNECT_TIMEOUT_MS
      );
      const text = `${connected.stdout}\n${connected.stderr}`.toLowerCase();
      if (!text.includes("connected to") || /\b(failed|cannot|unable|refused)\b/.test(text)) {
        this.recordFailure(target.deviceId, this.connectFailureReason(target), generation);
        return;
      }
      // "already connected to X" belongs to whoever connected it (another tool,
      // an earlier session, USB): CafeQuest must not disconnect that.
      if (!text.includes("already connected")) this.owned.add(endpoint);
    } catch {
      this.recordFailure(target.deviceId, this.connectFailureReason(target), generation);
      return;
    }
```

(Leave the rest of the method, from `let stdout: string;` onward, exactly as it is.)

8. Add these two private methods next to `adbAvailable`:

```ts
  /**
   * Why a connect failed, in the words the agent's own report allows. Only
   * consulted after a real failure, so a headset readable through legacy tcpip
   * never earns a Wireless Debugging hint merely because the setting is off.
   */
  private connectFailureReason(target: CollectorTarget): ControllerBatteryReason {
    if (target.wirelessDebugging === "not_permitted") return "agent_permission_missing";
    if (target.wirelessDebugging === "off") return "wireless_debugging_off";
    return "adb_connect_failed";
  }

  /** mDNS is a discovery aid only: without it the legacy 5555 guess still works. */
  private async discoverEndpoints(): Promise<MdnsEndpoints> {
    try {
      const listing = await this.options.runner(this.options.adbPath, ["mdns", "services"], MDNS_TIMEOUT_MS);
      return parseMdnsServices(listing.stdout);
    } catch {
      return new Map();
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/controller-battery.test.js server/dist/tests/controller-battery-api.test.js 2>&1 | tail -15`
Expected: all pass, including every pre-existing collector and API test (they must stay unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add server/src/controller-battery.ts server/tests/controller-battery.test.ts
git commit -m "feat(controller-battery): discover Wireless Debugging endpoints over mDNS and explain failed connects"
```

---

### Task 6: Hub frames, agent state, and broadcast

**Files:**
- Modify: `server/src/hub.ts`, `server/src/app.ts`
- Create: `server/tests/controller-monitoring-frames.test.ts`

**Interfaces:**
- Consumes: `CONTROLLER_MONITORING_CAPABILITY`, `PROTOCOL_VERSION`, `ControllerMonitoring`, `WirelessDebuggingState` from `@cafequest/shared` (Task 1); `CollectorTarget.wirelessDebugging` (Task 5).
- Produces: `Hub.broadcastControllerMonitoring(enabled: boolean): void`; `controllerBatteryTargets()` entries now carry `wirelessDebugging` only when the agent has reported one (so existing deep-equal assertions stay valid).

- [ ] **Step 1: Write the failing tests**

Create `server/tests/controller-monitoring-frames.test.ts`:

```ts
// The monitoring frame, the agent's wirelessDebugging report, and the actionable
// reasons, through the real app boundary. Fake sockets only; no real adb runs.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice } from "../src/store.js";
import type { AdbRunner } from "../src/controller-battery.js";

const ADMIN = "monitoring-frames-key-123";
const CAPABLE = ["launch_android_package", "controller_monitoring_v1"];

let connectFails = true;
const runner: AdbRunner = async (_executable, args) => {
  const [command] = args;
  if (command === "version") return { stdout: "Android Debug Bridge version 1.0.41\n", stderr: "" };
  if (command === "connect") {
    if (connectFails) throw new Error("adb connect failed");
    return { stdout: `connected to ${args[1] ?? ""}\n`, stderr: "" };
  }
  return { stdout: "", stderr: "" };
};

const { app, db, hub, controllerBatteryCollector } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  adminApiKey: ADMIN,
  controllerBattery: { adbPath: "adb", runner, pollIntervalMs: 60_000 },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
after(() => app.close());

type FakeSocket = { sent: string[]; send: (d: string) => void; close: () => void; ping: () => void };
function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    send: (data) => {
      socket.sent.push(String(data));
    },
    close: () => {},
    ping: () => {},
  };
  return socket;
}

function frames(socket: FakeSocket): Array<{ type: string; enabled?: boolean }> {
  return socket.sent.map((raw) => JSON.parse(raw)).filter((f) => f.type === "controller_monitoring");
}

function putMonitoring(enabled: boolean) {
  return fetch(`${base}/api/settings/controller-battery-monitoring`, {
    method: "PUT",
    headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

function connect(capabilities: string[], ip = "192.168.1.60") {
  const id = randomUUID();
  upsertDevice(db, { id, name: `Quest ${id.slice(0, 4)}` });
  const socket = fakeSocket();
  hub.addAgentSocket(id, socket as never, capabilities, ip);
  return { id, socket };
}

/**
 * The switch (or a connect) may leave a cycle already running that started before
 * the latest change. The first await lets it finish; the second runs a cycle that
 * is guaranteed to start after it, so it sees every device and report made so far.
 */
async function freshCycle() {
  await controllerBatteryCollector.pollNow();
  await controllerBatteryCollector.pollNow();
}

function telemetry(deviceId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "telemetry",
    protocolVersion: 1,
    deviceId,
    timestamp: new Date().toISOString(),
    battery: { level: 77, charging: false },
    agent: { foreground: true },
    ...extra,
  });
}

test("a capable agent is told the current flag at hello; an agent without the capability gets nothing", async () => {
  await putMonitoring(false);
  const capable = connect(CAPABLE);
  const legacy = connect(["launch_android_package"]);
  assert.deepEqual(frames(capable.socket), [{ type: "controller_monitoring", protocolVersion: 1, enabled: false }]);
  assert.deepEqual(frames(legacy.socket), []);
});

test("an agent connecting while monitoring is already on is told immediately", async () => {
  await putMonitoring(true);
  const late = connect(CAPABLE);
  assert.equal(frames(late.socket)[0]?.enabled, true);
  await putMonitoring(false);
});

test("flipping the switch reaches every connected capable agent and no other", async () => {
  await putMonitoring(false);
  const a = connect(CAPABLE, "192.168.1.61");
  const b = connect(CAPABLE, "192.168.1.62");
  const legacy = connect(["launch_android_package"], "192.168.1.63");
  await putMonitoring(true);
  await putMonitoring(false);
  for (const agent of [a, b]) {
    assert.deepEqual(
      frames(agent.socket).map((f) => f.enabled),
      [false, true, false],
      "hello flag, then on, then off"
    );
  }
  assert.deepEqual(frames(legacy.socket), []);
});

test("the agent's wirelessDebugging report turns a failed connect into an actionable reason", async () => {
  connectFails = true;
  await putMonitoring(true);
  const { id, socket } = connect(CAPABLE, "192.168.1.70");
  const expectations: Array<[string, string]> = [
    ["off", "wireless_debugging_off"],
    ["not_permitted", "agent_permission_missing"],
    ["on", "adb_connect_failed"],
  ];
  for (const [reported, reason] of expectations) {
    hub.handleAgentMessage(id, socket as never, telemetry(id, { wirelessDebugging: reported }));
    await freshCycle();
    const device = hub.snapshot().devices.find((d: { id: string }) => d.id === id);
    assert.equal(device?.controllerBattery?.reason, reason, reported);
  }
  await putMonitoring(false);
});

test("a reachable headset shows no Wireless Debugging hint even while the agent reports off", async () => {
  connectFails = false;
  await putMonitoring(true);
  const { id, socket } = connect(CAPABLE, "192.168.1.71");
  hub.handleAgentMessage(id, socket as never, telemetry(id, { wirelessDebugging: "off" }));
  await freshCycle();
  const device = hub.snapshot().devices.find((d: { id: string }) => d.id === id);
  assert.notEqual(device?.controllerBattery?.reason, "wireless_debugging_off");
  assert.notEqual(device?.controllerBattery?.reason, "agent_permission_missing");
  connectFails = true;
  await putMonitoring(false);
});

test("an unknown wirelessDebugging value never blocks telemetry or liveness", async () => {
  const { id, socket } = connect(CAPABLE, "192.168.1.72");
  hub.handleAgentMessage(id, socket as never, telemetry(id, { wirelessDebugging: "from_the_future" }));
  const errors = socket.sent.map((raw) => JSON.parse(raw)).filter((f) => f.type === "error");
  assert.deepEqual(errors, [], "the frame was accepted");
  const device = hub.snapshot().devices.find((d: { id: string }) => d.id === id);
  assert.equal(device?.batteryLevel, 77, "battery telemetry still landed");
  assert.equal(device?.online, true);
  assert.ok(
    !hub.controllerBatteryTargets().find((t) => t.deviceId === id)?.wirelessDebugging,
    "the unknown value is dropped, not stored"
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w shared && npm run build -w server 2>&1 | tail -8 && node --test server/dist/tests/controller-monitoring-frames.test.js 2>&1 | tail -20`
Expected: FAIL: no frames are sent, `wirelessDebugging` is not stored, reasons stay `adb_connect_failed`.

- [ ] **Step 3: Implement the hub changes**

In `server/src/hub.ts`:

1. Extend the `@cafequest/shared` import with `CONTROLLER_MONITORING_CAPABILITY`, `PROTOCOL_VERSION`, `type ControllerMonitoring`, `type WirelessDebuggingState`.

2. Add a field to `DeviceConn`:

```ts
  /** The agent's last reported Horizon OS Wireless Debugging state; in memory only. */
  wirelessDebugging: WirelessDebuggingState | null;
```

3. Replace the `this.devices.set(deviceId, {...});` call in `addAgentSocket` with:

```ts
    const conn: DeviceConn = {
      socket,
      deviceId,
      capabilities: new Set(capabilities),
      remoteAddress: normalizeRemoteIpv4(remoteAddress),
      wirelessDebugging: null,
    };
    this.devices.set(deviceId, conn);
    // A reconnecting agent learns the current flag at once, so a server restart
    // or a toggle made while it was offline still reaches it.
    this.sendControllerMonitoring(conn, this.controllerBattery?.monitoringState().enabled ?? false);
```

4. Add these methods beside `sendCastFrame`:

```ts
  /** One monitoring frame to one agent that advertised the capability; false if not sent. */
  private sendControllerMonitoring(conn: DeviceConn, enabled: boolean): boolean {
    if (!conn.capabilities.has(CONTROLLER_MONITORING_CAPABILITY)) return false;
    const frame: ControllerMonitoring = { type: "controller_monitoring", protocolVersion: PROTOCOL_VERSION, enabled };
    try {
      conn.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  /** Tell every connected capable agent the monitoring flag (called when the switch flips). */
  broadcastControllerMonitoring(enabled: boolean): void {
    for (const conn of this.devices.values()) this.sendControllerMonitoring(conn, enabled);
  }
```

5. In `handleAgentMessage`, inside the `if (msg.type === "telemetry") {` block, right after the `setExpectedGame(...)` line add:

```ts
      // Advisory UI hint only; guard on the socket so a replaced connection's late frame is ignored.
      const conn = this.devices.get(deviceId);
      if (conn && conn.socket === socket) conn.wirelessDebugging = msg.wirelessDebugging ?? null;
```

6. Replace `controllerBatteryTargets()` with:

```ts
  /** Live connection addresses for the optional ADB collector; never persisted. */
  controllerBatteryTargets(): readonly CollectorTarget[] {
    return [...this.devices.values()].map((conn) => ({
      deviceId: conn.deviceId,
      address: conn.remoteAddress,
      // Present only once the agent has reported one: absent means "unknown".
      ...(conn.wirelessDebugging ? { wirelessDebugging: conn.wirelessDebugging } : {}),
    }));
  }
```

- [ ] **Step 4: Broadcast from the settings route**

In `server/src/app.ts`, replace the comment above the route and add the broadcast so the handler reads:

```ts
  // --- REST: settings ----------------------------------------------------------
  // The global controller-battery switch. Turning it on tells each capable agent
  // to enable Horizon OS Wireless Debugging (the person taps Allow on the headset
  // once per boot); turning it off tells them to switch it back off where they
  // enabled it. CafeQuest's own ADB reads start and stop with it.
  app.put("/api/settings/controller-battery-monitoring", async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_setting_body" });
    // Persist the intent first: a failed ADB start must not lose the choice.
    setControllerBatteryMonitoringEnabled(db, body.data.enabled);
    // Agents act on the flag immediately; they do not wait for ADB to be probed.
    hub.broadcastControllerMonitoring(body.data.enabled);
    await controllerBatteryCollector.setEnabled(body.data.enabled);
    app.log.info({ enabled: body.data.enabled }, "controller battery monitoring changed");
    hub.pushDashboardState();
    return { controllerBatteryMonitoring: controllerBatteryCollector.monitoringState() };
  });
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/controller-monitoring-frames.test.js server/dist/tests/controller-battery.test.js server/dist/tests/controller-battery-api.test.js 2>&1 | tail -15`
Expected: all pass, including every pre-existing controller-battery test unchanged.

- [ ] **Step 6: Commit**

```bash
git add server/src/hub.ts server/src/app.ts server/tests/controller-monitoring-frames.test.ts
git commit -m "feat(server): send the monitoring flag to agents and use their Wireless Debugging report"
```

---

### Task 7: Dashboard reasons, visible hint, help text

**Files:**
- Modify: `dashboard/src/types.ts`, `dashboard/src/messages.tsx`, `dashboard/src/components/DeviceCard.tsx`, `dashboard/src/styles.css`, `dashboard/src/api.ts` (comment), `dashboard/src/components/ControllerBatteryToggle.tsx` (comment)
- Test: `dashboard/src/components/DeviceCard.test.tsx`, `dashboard/src/components/ControllerBatteryToggle.test.tsx`

**Interfaces:**
- Consumes: the two new reason codes (Task 5).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

In `DeviceCard.test.tsx`, add inside the `describe("DeviceCard controller batteries", ...)` block (before its closing `});`):

```tsx
  it("shows the Wireless Debugging action as visible text, not only a tooltip", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "wireless_debugging_off" },
      }),
    })} />);
    expect(screen.getByText("Tap Allow on the headset to turn on Wireless Debugging")).toBeInTheDocument();
  });

  it("shows the missing one-time setup as visible text", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "agent_permission_missing" },
      }),
    })} />);
    expect(screen.getByText("One-time setup missing on this headset")).toBeInTheDocument();
  });

  it("keeps an offline headset quiet: no visible hint for headset_offline", () => {
    render(<DeviceCard {...props({
      device: device({
        online: false,
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "headset_offline" },
      }),
    })} />);
    expect(screen.queryByText("The headset is not connected")).not.toBeInTheDocument();
  });

  it("adds no hint beside an existing reading", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: {
          left: { level: 95, state: "inactive" },
          right: { level: 75, state: "inactive" },
          observedAt: at(4 * 60_000),
          status: "stale",
          reason: "wireless_debugging_off",
        },
      }),
    })} />);
    expect(screen.queryByText("Tap Allow on the headset to turn on Wireless Debugging")).not.toBeInTheDocument();
  });

  it("speaks Turkish for both new hints", () => {
    const { rerender } = renderTurkish(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "wireless_debugging_off" },
      }),
    })} />);
    expect(screen.getByText("Kablosuz hata ayıklamayı açmak için gözlükte İzin ver'e dokunun")).toBeInTheDocument();
    rerender(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "agent_permission_missing" },
      }),
    })} />);
    expect(screen.getByText("Bu gözlükte tek seferlik kurulum eksik")).toBeInTheDocument();
  });
```

In `ControllerBatteryToggle.test.tsx`, replace line 20's expectation:

```tsx
    expect(toggle).toHaveAccessibleDescription(/turn on Wireless Debugging/i);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w dashboard -- src/components/DeviceCard.test.tsx src/components/ControllerBatteryToggle.test.tsx 2>&1 | tail -20`
Expected: FAIL: new texts not found and the help-text assertion fails (type errors for the new reason codes may also surface).

- [ ] **Step 3: Implement**

1. `dashboard/src/types.ts`: extend the union:

```ts
export type ControllerBatteryReason =
  | null
  | "headset_offline"
  | "no_wireless_address"
  | "adb_connect_failed"
  | "wireless_debugging_off"
  | "agent_permission_missing"
  | "dump_failed"
  | "parse_failed";
```

2. `dashboard/src/messages.tsx`, English block:
   - Replace the two comment lines above `controller: {` with:
     `// Optional controller diagnostics. On asks each headset to enable Wireless Debugging; off switches it back off where CafeQuest enabled it.`
   - Replace `help` with:

```tsx
    help:
      "Reads the left and right Touch controller levels over wireless ADB. On asks each headset to turn on Wireless Debugging (tap Allow on the headset once after a reboot); off turns it back off where CafeQuest turned it on.",
```

   - Add to `reasons` (keep the existing entries):

```tsx
      wireless_debugging_off: "Tap Allow on the headset to turn on Wireless Debugging",
      agent_permission_missing: "One-time setup missing on this headset",
```

3. `messages.tsx`, Turkish block:
   - Replace `help` with:

```tsx
    help:
      "Sol ve sağ Touch kontrolcü seviyelerini kablosuz ADB üzerinden okur. Açıkken her gözlükten Kablosuz Hata Ayıklama'yı açması istenir (yeniden başlatmadan sonra gözlükte bir kez İzin ver'e dokunun); kapatınca CafeQuest'in açtığı yerlerde tekrar kapatılır.",
```

   - Add to `reasons`:

```tsx
      wireless_debugging_off: "Kablosuz hata ayıklamayı açmak için gözlükte İzin ver'e dokunun",
      agent_permission_missing: "Bu gözlükte tek seferlik kurulum eksik",
```

4. `dashboard/src/components/DeviceCard.tsx`, in `ControllerBadges`: after the `const updated = ...` line add:

```tsx
  // With no reading at all the reason is shown as text, so staff see the action
  // without hovering. An offline headset is already obvious from its card.
  const hint =
    !battery.left && !battery.right && battery.reason && battery.reason !== "headset_offline"
      ? c.reasons[battery.reason]
      : null;
```

   and render it just before the `{updated && ...}` line:

```tsx
      {hint && <span className="controller-hint">{hint}</span>}
```

5. `dashboard/src/styles.css`: after the `.controller-updated { ... }` rule add:

```css
.controller-hint { flex-basis: 100%; text-align: right; font-size: 0.75rem; color: var(--chalk-dim); }
```

6. Update the two stale comments: `dashboard/src/api.ts` (the doc comment saying the switch "never enables or disables headset Wireless Debugging") and `dashboard/src/components/ControllerBatteryToggle.tsx` (the comment saying it does "not touch Wireless Debugging inside Horizon OS"). Reword each to: "Turning it on asks each headset to enable Wireless Debugging; turning it off switches it off again where CafeQuest enabled it."

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w dashboard 2>&1 | tail -15`
Expected: all dashboard tests pass, including the Turkish help assertion in `App.test.tsx` (it matches `Kablosuz Hata Ayıklama`) and the "leaves no English on a Turkish card" tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src
git commit -m "feat(dashboard): show the Wireless Debugging hint on the card and update the switch help"
```

---

### Task 8: Docs, hardware record, full verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/quest-setup.md`, `docs/architecture.md`, `docs/known-limitations.md`, `docs/poc-test-results.md`

**Interfaces:** none; this task records behavior the earlier tasks built and the hardware findings from 2026-10-10.

- [ ] **Step 1: README.md**

Replace the second paragraph of the "Controller batteries (optional)" section (the one starting `It needs one optional per-headset step`) with:

```md
It needs two one-time steps per headset (docs/quest-setup.md): grant the agent
`WRITE_SECURE_SETTINGS` over USB, and authorize the café PC's adb key (the USB
"Always allow" prompt). With the switch on, the agent turns Horizon OS Wireless
Debugging on by itself and the server finds the port over mDNS, so there is no
`adb tcpip` and no USB after a reboot. After a headset reboot, open CafeQuest
and tap **Allow** once on the "Allow wireless debugging on this network?"
dialog. A headset that already has `adb tcpip 5555` running keeps working.
Turning the switch off turns Wireless Debugging back off where CafeQuest turned
it on. Nothing about this feature can affect online status, sessions, or game
launching, and controller readings are never stored: they live in memory and
are refreshed after every server start.
```

- [ ] **Step 2: docs/quest-setup.md**

Replace the whole "Optional: controller batteries" section body (from `Reading the Touch controller levels is optional...` through the sentence ending `...does not enable or disable` and its continuation, i.e. up to the next `##` heading) with:

````md
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
````

In the troubleshooting list, replace the bullet *"Controller badges show *Couldn't connect to the headset over ADB*..."* (and its continuation lines) with:

```md
- **Controller badges show *Couldn't connect to the headset over ADB***: neither
  Wireless Debugging nor legacy TCP ADB is reachable. Make sure the switch is
  on and the headset's agent is connected; if the agent has not asked yet, open
  CafeQuest on the headset.
- **A card says *Tap Allow on the headset to turn on Wireless Debugging***: the
  agent asked and the system dialog is waiting. Put the headset on and tap
  **Allow** (always allow for this network).
- **A card says *One-time setup missing on this headset***: run the
  `pm grant ... WRITE_SECURE_SETTINGS` step above over USB.
```

- [ ] **Step 3: docs/architecture.md**

In the "Optional controller batteries" section, leave the intro and the existing bullets as they are and add these two bullets directly after the **Matching** bullet:

```md
- **Enabling ADB**: the agent, not the server, turns Horizon OS Wireless
  Debugging on. The server sends `controller_monitoring {enabled}` (capability
  `controller_monitoring_v1`) at every agent hello and whenever the switch
  flips; the agent writes `Settings.Global adb_wifi_enabled` using a one-time
  `WRITE_SECURE_SETTINGS` grant, asks at most once per boot, and switches it off
  again only if it turned it on. It reports `wirelessDebugging`
  (`on|off|not_permitted`) in telemetry; the server uses it only to explain a
  connect that already failed (`wireless_debugging_off`,
  `agent_permission_missing`).
- **Endpoint discovery**: the TLS port is random per enable and unreadable by an
  app, so each cycle runs one `adb mdns services` and picks, per headset IP,
  `_adb-tls-connect._tcp`, then `_adb._tcp`, then `<ip>:5555`. Only plain IPv4
  `ip:port` values from that listing can become an argument.
```

and replace the final paragraph (`ADB_PATH (optional...` through `(docs/quest-setup.md).`) with:

```md
`ADB_PATH` (optional, see `.env.example`) points at a specific `adb` when it is
not on `PATH`. The one-time per-headset setup (the `pm grant` and the USB adb
authorization) is in docs/quest-setup.md.
```

- [ ] **Step 4: CLAUDE.md**

In the "Controller batteries" paragraph, replace the sentence `The dashboard switch does not enable/disable Horizon OS Wireless Debugging.` with:

```md
Turning the switch on makes each capable agent enable Horizon OS Wireless
Debugging itself (`controller_monitoring` frame, one-time `WRITE_SECURE_SETTINGS`
grant, at most one request per boot, switched off again only where the agent
turned it on); the collector finds the random TLS port with `adb mdns
services`, falling back to `<ip>:5555`.
```

The "hand-synced places" rule already covers the new frame, so nothing else in `CLAUDE.md` changes.

- [ ] **Step 5: docs/known-limitations.md**

Replace the bullet `**Wireless ADB is per-headset and per-boot**` (its whole text through `only controller readings are lost.`) with:

```md
- **Wireless Debugging needs one tap per reboot**: Horizon OS resets it on every
  boot and forgets the "always allow on this network" approval, so after a
  reboot someone taps **Allow** on the system dialog (the agent itself does not
  autostart, so this is the same visit as opening CafeQuest). The approval is
  per access point. The one-time per-headset setup is the `pm grant
  ... WRITE_SECURE_SETTINGS` step and USB authorization of the café PC's adb
  key. mDNS discovery is verified on macOS only; on another café PC the
  `<ip>:5555` fallback still works for headsets that have legacy `adb tcpip`.
  When a headset cannot be reached, only controller readings are lost.
```

- [ ] **Step 6: docs/poc-test-results.md**

Insert this section above `## Optional controller batteries, 2026-10-09`:

```md
## Agent-enabled Wireless Debugging, 2026-10-10

Quest model: Quest 3 (adb serial `2G0YC5ZG8106W2`), Horizon OS on Android 14.

### Hardware findings (these decided the design)

| Attempt | Result | Notes |
|---|---|---|
| Agent app runs `dumpsys OVRRemoteService`, `DUMP` granted | FAIL | `PERMISSION_DENIED` from Meta's service even inside the real app process; no SELinux denial logged |
| Other app-readable channels | FAIL | No controller `power_supply` node, `dumpsys externalbattery` empty, no input battery monitor |
| `adb shell setprop persist.adb.tcp.port 5555` | FAIL | `SELinux permission check failed` (`shell` may not set it on this build) |
| `adb_wifi_enabled` left on across a reboot | FAIL | Reset to 0; the "always allow on this network" approval was also lost |
| `settings put global adb_wifi_enabled 1` from the shell, network untrusted | PASS | Raises the "Allow wireless debugging on this network?" dialog; value reads 0 until approved |
| Agent app with `WRITE_SECURE_SETTINGS` sets `adb_wifi_enabled=1`, network trusted | PASS | `before=0 putOk=true after=1`, TLS service appears in `adb mdns services` |
| `adb connect` to the mDNS `_adb-tls-connect._tcp` endpoint with no `adb pair` | PASS | The key already authorized over USB is accepted; `dumpsys` returned Left/Right levels |
| App reading the TLS port (`service.adb.tls.port`) | FAIL | Empty for an app; the server must discover it over mDNS |
| Trust scope | Observed | Stored per access point (BSSID), not per network name; the headset roamed to a second BSSID and asked again |

### Physical check of the implemented feature

Run after Tasks 1-7 are built and the APK is installed
(`adb install -r quest-agent/app/build/outputs/apk/debug/app-debug.apk`).

| Check | Result | Notes |
|---|---|---|
| Grant `WRITE_SECURE_SETTINGS`, turn the switch on, tap Allow, readings appear with no `tcpip` | NOT TESTED | |
| Reboot, open CafeQuest, tap Allow, readings return | NOT TESTED | |
| Deny the dialog: card shows the pending reason and reconnects do not re-prompt | NOT TESTED | |
| Switch off: Wireless Debugging turns off on a headset where the agent enabled it | NOT TESTED | |
| Switch off with Wireless Debugging enabled by hand: it stays on | NOT TESTED | |
| Run without the grant: card shows *One-time setup missing on this headset* | NOT TESTED | |
| Headset with legacy `adb tcpip 5555` and Wireless Debugging off still shows readings | NOT TESTED | |
```

- [ ] **Step 7: Full verification**

Run each and confirm:

```bash
npm run build 2>&1 | tail -5
npx tsc -p tsconfig.json 2>&1 | tail -5
npm test 2>&1 | tail -25
cd quest-agent && ./gradlew testDebugUnitTest assembleDebug 2>&1 | tail -8
cd .. && git status --short
```

Expected: build and typecheck clean; `npm test` passes in shared, server, simulator and dashboard with 0 failures; the Gradle build is successful; `git status` shows only the files listed in this plan.

- [ ] **Step 8: Physical check on the Quest 3 (needs a person at the headset)**

Install the APK, run `adb shell pm grant com.cafequest.agent android.permission.WRITE_SECURE_SETTINGS`, then walk the table above row by row, updating each `NOT TESTED` to `PASS` or `FAIL` with a note. Do not mark a row PASS without observing it.

- [ ] **Step 9: Commit**

```bash
git add README.md CLAUDE.md docs
git commit -m "docs: document agent-enabled Wireless Debugging and record the hardware findings"
```
