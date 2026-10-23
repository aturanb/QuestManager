# One-Headset Live Support View Implementation Plan

> Update (2026-10-23): the global single-stream restriction is superseded by
> [multiple headset live views](../specs/2026-10-23-multi-device-casting-design.md).
> This original document records the initial implementation.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let café staff request and view one low-bandwidth, video-only Quest headset stream in the CafeQuest dashboard after the wearer approves Quest's capture dialog.

**Architecture:** The Quest agent captures the Horizon OS compositor with Android `MediaProjection` and publishes one video track directly to the requesting browser through WebRTC. A new in-memory server `CastCoordinator` owns the single global session and relays bounded status, SDP, and ICE messages over the existing agent WebSocket plus a dedicated authenticated browser WebSocket; no video or cast state is stored by the server.

**Tech Stack:** Node 22 ESM, TypeScript strict, Zod, Fastify 4, `ws`, `node:test`; React 18, Vite 6, Vitest, Testing Library, browser WebRTC; Kotlin 2.0, Android API 29–34, MediaProjection, `io.getstream:stream-webrtc-android:1.3.9`, OkHttp, coroutines, Compose, JUnit4.

**Spec:** `docs/superpowers/specs/2026-10-09-screen-casting-design.md`

## Global Constraints

- One non-terminal cast globally and one browser viewer for it. A second reservation returns HTTP `409` with `CAST_BUSY`.
- Video only: no audio permissions, microphone, screenshots, recording, playback, or stored history.
- Initial capture profile: `960 × 540`, `15 FPS`, maximum `1_500_000` video bits/s.
- Direct WebRTC media with `RTCConfiguration.iceServers = []`; the server relays signaling only. No STUN, TURN, SFU, internet relay, or WebSocket video.
- Every new capture requires a new Quest `MediaProjection` consent result. Never cache or reuse the result intent.
- Cast state, SDP, ICE, and frames stay in memory and never enter SQLite, files, or normal logs.
- Reuse `ADMIN_API_KEY` for `POST /api/casts`, `DELETE /api/casts/:sessionId`, and `/cast-ws`; do not add a second auth or enrollment system.
- Protocol remains version 1. Older agents and the simulator do not advertise `screen_cast_v1` and must keep connecting normally.
- Browser bind timeout `10_000 ms`, approval timeout `90_000 ms`, negotiation timeout `20_000 ms`.
- Refreshing/closing the viewer, losing either socket, replacing the agent connection, revoking MediaProjection, or stopping explicitly must release the slot idempotently.
- Android service order on targetSdk 34: obtain consent in visible `MainActivity`; promote `AgentService` to `dataSync|mediaProjection`; only then call `getMediaProjection`/start capture.
- Pin Android WebRTC to `io.getstream:stream-webrtc-android:1.3.9`; do not substitute a hosted media service.
- Agent version becomes `0.5.0`, versionCode `5` only when the full agent path and capability are wired.
- All dashboard and headset copy has English and Turkish entries. Turkish never suffixes a headset name.
- Backend tests use `node:test`; dashboard uses Vitest/Testing Library; Android JVM tests must keep `android.*` behind interfaces.
- Gradle commands use JDK 21: `JAVA_HOME=$(/usr/libexec/java_home -v 21)`.
- Rebuild `shared` before server/simulator consumers because `@cafequest/shared` resolves to `shared/dist`.
- Hardware behavior remains `UNVERIFIED_HARDWARE` until the physical acceptance matrix is recorded.
- `docs/decisions.md` stays append-only.

## Review Focus

1. **An ICE candidate reaches the browser before the agent offer has been installed:** queue it and apply it after `setRemoteDescription`, never throw or lose it. Pinned in Task 4 (`queues remote ICE until the offer is installed`).
2. **The Quest consent activity returns after the server already timed out or stopped that session:** discard the one-use result and do not start MediaProjection. Pinned in Task 6 (`late and mismatched grants never create a publisher`) and Task 8 (`a stale activity result is ignored`).
3. **The viewer closes while `createAnswer` or cleanup is already running:** stop/delete/close exactly once and never send an answer for the dead session. Pinned in Task 4 (`close during negotiation is idempotent`) and Task 5 (`closing the modal while connecting releases one session`).
4. **A newer hello replaces an agent socket while that device is live:** stop the old local publisher, close the viewer, free the slot, and do not attach the session to the replacement socket. Pinned in Task 2 (`agent replacement terminates rather than migrates`) and Task 3 (`duplicate hello ends its active cast`).
5. **Malformed, oversized, wrong-direction, or stale signaling arrives from either peer:** reject/ignore it without routing it to another session or logging SDP/ICE. Pinned in Tasks 1–3 (`bounds every signaling shape`, `foreign and late signals never relay`, `cast websocket rejects malformed and oversized frames`).

## File Structure

| File | Responsibility |
|---|---|
| `shared/src/protocol.ts` | Capability, cast status/error/stop enums, bounded WebRTC signals, agent/server/viewer cast schemas |
| `shared/tests/protocol.test.ts` | Protocol-v1 compatibility and cast bounds/direction tests |
| `server/src/cast-coordinator.ts` | One-session in-memory state machine, timeouts, routing, idempotent cleanup |
| `server/tests/cast-coordinator.test.ts` | Pure coordinator lifecycle/ownership/race tests |
| `server/src/hub.ts` | Live capability snapshot, ephemeral agent send, cast-message delegation, agent disconnect cleanup |
| `server/src/app.ts` | Cast REST endpoints and authenticated `/cast-ws` binding |
| `server/tests/casting-routes.test.ts` | Real HTTP/WS route, auth, routing, bounds, and cleanup tests |
| `dashboard/src/api.ts` | Reserve/delete cast REST functions and cast WebSocket URL |
| `dashboard/src/types.ts` | `supportsScreenCast` and cast-view types mirrored from the server |
| `dashboard/src/casting.ts` | Testable browser signaling/state/cleanup controller |
| `dashboard/src/browser-rtc.ts` | Native `RTCPeerConnection` adapter and remote media track |
| `dashboard/src/components/LiveViewModal.tsx` | Accessible live-view states, video element, retry/stop controls |
| `dashboard/src/components/DeviceCard.tsx` | Per-headset request/update-agent action |
| `dashboard/src/App.tsx` | Exactly one local modal/client lifecycle |
| `dashboard/src/messages.tsx`, `errors.ts`, `styles.css` | EN/TR copy, stable error wording, modal/card presentation |
| `quest-agent/.../Protocol.kt` | Kotlin mirror and never-throwing server-frame parser |
| `quest-agent/.../CastingController.kt` | Android-free cast state machine and transport/publisher boundaries |
| `quest-agent/.../CastingState.kt` | UI state/store and shared casting interfaces |
| `quest-agent/.../ProjectionCapture.kt` | One-use MediaProjection/`ScreenCapturerAndroid` resource wrapper |
| `quest-agent/.../WebRtcPublisher.kt` | Peer connection, offer/answer/ICE, bitrate, connection callbacks, cleanup |
| `quest-agent/.../AgentConnection.kt` | Cast transport attached to the current agent socket only |
| `quest-agent/.../AgentService.kt` | Controller ownership, projection foreground-service ordering, notifications |
| `quest-agent/.../MainActivity.kt` | Visible consent launcher and headset approve/stop UI |
| `quest-agent/.../AgentStrings.kt` | English/Turkish casting copy |
| `quest-agent/app/src/main/AndroidManifest.xml`, `build.gradle.kts` | Projection service permission/type, WebRTC dependency, version |
| Docs listed in Task 9 | Operator flow, architecture, limitations, tests, decision log |

## Verified Baseline

At design commit `0828cb4`, before feature code:

- `npm test`: shared `22/22`, server `75/75`, simulator `11/11`, dashboard `134/134`.
- `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`: `90/90` JVM tests.
- Loopback server/simulator tests require sandbox escalation; an in-sandbox run fails with `listen EPERM`, which is an environment restriction rather than a repository failure.

---

### Task 1: Define the compatible cast protocol in TypeScript and Kotlin

**Files:**
- Modify: `shared/src/protocol.ts`
- Modify: `shared/tests/protocol.test.ts`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt`
- Modify: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt`

**Interfaces:**
- Consumes: existing protocol version 1 and open-ended `Hello.capabilities`.
- Produces: `SCREEN_CAST_CAPABILITY = "screen_cast_v1"`; `CastSessionStatus`; `CastFailureCode`; `CastStopReason`; `RtcSignal`; `AgentCastStatus`; `AgentCastSignal`; `CastRequest`; `ServerCastSignal`; `CastStop`; `ViewerCastSignalSchema`; Kotlin `ParsedServerMessage` and `parseServerMessage(raw)`.
- Preserves: `ServerCommandSchema`, `parseLaunchCommand(raw)`, and old hellos/messages unchanged.

- [ ] **Step 1: Add failing shared protocol tests**

Add named cases asserting:

- `screen_cast_v1` is accepted beside `launch_android_package`, while a hello with no capabilities still parses.
- valid offer/answer SDP up to `65_536` characters and ICE candidates up to `4_096` characters parse; one character over each cap fails.
- agent `cast_status`/`cast_signal` require `deviceId` and UUID `sessionId` and parse through `parseAgentMessage`.
- server `cast_request`, `cast_signal`, and `cast_stop` accept only their exact status/signal directions.
- `ViewerCastSignalSchema` accepts answer/ICE but rejects offers.
- legacy launch commands and telemetry still parse.

- [ ] **Step 2: Run the shared test and confirm red**

Run: `npm run build -w shared`

Expected: TypeScript errors for the missing cast exports or failing new assertions.

- [ ] **Step 3: Implement the shared schemas and exported types**

Use these exact discriminators and bounds:

```ts
type RtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };

type CastSessionStatus = "awaiting_approval" | "negotiating" | "live" | "stopped" | "failed";
type CastFailureCode = "consent_denied" | "approval_timeout" | "negotiation_timeout" |
  "projection_stopped" | "peer_disconnected" | "capture_failed" | "internal_error";
type CastStopReason = "viewer_stopped" | "viewer_disconnected" | "approval_timeout" |
  "negotiation_timeout" | "agent_disconnected" | "server_stopping" | "failed";
```

Keep `AgentMessageSchema` discriminated on `type`; add only agent-originated status/signal shapes to it. Keep server-to-agent and viewer schemas separate so direction is enforced.

- [ ] **Step 4: Add failing Kotlin mirror/parser tests**

Add cases proving:

- the default hello still advertises only the existing package-launch capability for now;
- explicit `screen_cast_v1` serializes correctly;
- `parseServerMessage` returns distinct `Launch`, `CastRequest`, `CastSignal`, and `CastStop` variants;
- malformed JSON, wrong versions, bad UUIDs, oversized SDP/ICE, and an invalid signal direction return `null` without throwing;
- `parseLaunchCommand` remains a compatibility wrapper and retains all current behavior.

- [ ] **Step 5: Implement the Kotlin mirror**

Add `CAPABILITY_SCREEN_CAST`, sealed `RtcSignal` variants serialized with the `kind` discriminator, serializable cast frames, and:

```kotlin
sealed interface ParsedServerMessage
fun parseServerMessage(raw: String): ParsedServerMessage?
fun parseLaunchCommand(raw: String): ServerCommand?
```

Validate the same UUID/string bounds as Zod before returning a parsed frame. Do not add the new capability to `Hello`'s default list until Task 8 makes the complete feature usable.

- [ ] **Step 6: Run both protocol suites**

Run: `npm test -w shared`

Expected: all shared tests pass.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests com.cafequest.agent.ProtocolTest`

Expected: `BUILD SUCCESSFUL` and all `ProtocolTest` cases pass.

- [ ] **Step 7: Commit the protocol slice**

```bash
git add shared/src/protocol.ts shared/tests/protocol.test.ts quest-agent/app/src/main/kotlin/com/cafequest/agent/Protocol.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt
git commit -m "feat(casting): define live-view protocol"
```

---

### Task 2: Build the one-session CastCoordinator

**Files:**
- Create: `server/src/cast-coordinator.ts`
- Create: `server/tests/cast-coordinator.test.ts`

**Interfaces:**
- Consumes: Task 1 cast schemas/types.
- Produces: `CAST_VIEWER_BIND_MS = 10_000`, `CAST_APPROVAL_MS = 90_000`, `CAST_NEGOTIATION_MS = 20_000`; `CastAgentPort`; `CastViewer`; `CastCoordinator.reserve`, `.bindViewer`, `.handleAgentStatus`, `.handleAgentSignal`, `.handleViewerSignal`, `.stop`, `.agentDisconnected`, `.stopAll`, `.active`.

Use these result contracts:

```ts
type ReserveResult =
  | { ok: true; sessionId: string; status: "reserved" }
  | { ok: false; error: "DEVICE_OFFLINE" | "CAST_UNSUPPORTED" | "CAST_BUSY" };

type BindResult =
  | { ok: true }
  | { ok: false; error: "CAST_SESSION_NOT_FOUND" | "CAST_SESSION_ALREADY_BOUND" | "DEVICE_OFFLINE" };
```

`CastAgentPort` answers live connection/capability checks and sends a bounded server cast frame. `CastViewer` has `send(message)`, `close(code, reason)`, and is compared by object identity.

- [ ] **Step 1: Write failing coordinator lifecycle tests**

Cover these named behaviors with fake agent/viewer ports and short injected timeout values:

- `reserves only an online capable device and rejects a second global session`.
- `binding the first viewer sends cast_request and starts approval timeout`.
- `approval status starts negotiation timeout and live cancels it`.
- `offer and ICE relay only to the bound viewer; answer and ICE relay only to the bound agent`.
- `foreign and late signals never relay`.
- `viewer close, agent disconnect, explicit stop and stopAll clean up once and release the slot`.
- `agent replacement terminates rather than migrates the session`.
- `bind, approval and negotiation timeouts use their exact failure codes`.
- `terminal agent status reaches the viewer before closure`.
- `SDP and ICE values are absent from logger calls`.

- [ ] **Step 2: Run the new test and confirm red**

Run: `npm run build -w shared && npm run build -w server`

Expected: compile failure because `cast-coordinator.ts` and its exports do not exist.

- [ ] **Step 3: Implement reservation, binding, and state transitions**

Use a single private `ActiveCast | null`, UUID generation, injected timeout durations, and one transition method that rejects out-of-order status. `reserve` starts only the 10-second bind timer; `bindViewer` sends `cast_request` and then starts the 90-second approval timer.

- [ ] **Step 4: Implement direction-aware relay and idempotent termination**

Agent may send only offer/ICE. Viewer may send only answer/ICE. `terminate` must cancel all timers, optionally send `cast_stop`, notify/close a still-open viewer, null the active session before external callbacks, and tolerate repeated calls.

- [ ] **Step 5: Run coordinator tests**

Run: `npm run build -w shared && npm run build -w server && node --test server/dist/tests/cast-coordinator.test.js`

Expected: all coordinator tests pass with no open-handle warning.

- [ ] **Step 6: Commit the coordinator**

```bash
git add server/src/cast-coordinator.ts server/tests/cast-coordinator.test.ts
git commit -m "feat(server): coordinate one live-view session"
```

---

### Task 3: Wire server capabilities, REST, and the cast WebSocket

**Files:**
- Modify: `server/src/hub.ts`
- Modify: `server/src/app.ts`
- Modify: `dashboard/src/types.ts`
- Create: `server/tests/casting-routes.test.ts`
- Modify: `server/tests/security.test.ts`
- Modify: `server/tests/ownership.test.ts`

**Interfaces:**
- Consumes: Task 1 protocol and Task 2 `CastCoordinator`.
- Produces: `Hub.supportsScreenCast`, `Hub.sendCastFrame`, `Hub.cast`; snapshot field `Device.supportsScreenCast: boolean`; `POST /api/casts`; `DELETE /api/casts/:sessionId`; authenticated `/cast-ws`.
- WebSocket close codes: unauthorized `4401`, malformed/oversized `4400`, session not found `4404`, already bound/conflict `4409`, normal terminal `1000`.

- [ ] **Step 1: Write failing route and ownership tests**

With real Fastify/WebSocket connections, cover:

- snapshot capability is false offline/old and true only for the live `screen_cast_v1` connection;
- POST returns `404 DEVICE_NOT_FOUND`, `409 DEVICE_OFFLINE`, `409 CAST_UNSUPPORTED`, or `201 {sessionId,status:"reserved"}`;
- a second POST receives `409 CAST_BUSY`;
- cast WS rejects a missing/wrong admin key and an unknown session with the exact close code;
- binding the viewer makes the capable agent receive one `cast_request`;
- a fake agent offer reaches only that viewer; its answer reaches only the owning agent;
- a cast message whose `deviceId` differs from its socket gets `DEVICE_MISMATCH` and does not relay;
- cast WS rejects binary, invalid JSON, an offer from the viewer, and text over `70 KiB`;
- viewer close, DELETE, agent close, duplicate hello, and app close each release the slot;
- admin key, SDP, and ICE candidate strings never appear in captured logs.

- [ ] **Step 2: Run focused server tests and confirm red**

Run: `npm run build -w shared && npm run build -w server`

Expected: compile failures for the missing Hub members/routes/snapshot field.

- [ ] **Step 3: Attach CastCoordinator to Hub**

Construct it inside `Hub` with callbacks over the existing live `devices` map. Add:

```ts
supportsScreenCast(deviceId: string): boolean
sendCastFrame(deviceId: string, frame: ServerCastMessage): boolean
readonly cast: CastCoordinator
```

Delegate agent cast messages after the existing connection-level `deviceId` check. Call `cast.agentDisconnected(deviceId)` before deleting/replacing a matching socket. Call `cast.stopAll()` before closing sockets in `Hub.stop()`. Add `supportsScreenCast` to every device snapshot from the live connection, never from SQLite.

- [ ] **Step 4: Add REST and `/cast-ws` routes**

`POST /api/casts` accepts exactly `{deviceId: uuid}`; check the DB row before `hub.cast.reserve`. `DELETE` validates a UUID and returns `204` whether that session is active, terminal, or already absent, so repeated browser cleanup stays idempotent. The first authorized `/cast-ws` for a reservation binds; its message and close handlers delegate to the coordinator.

Keep request logging disabled. Decode only UTF-8 text at or below 70 KiB and validate it with Task 1's viewer schema before delegation.

- [ ] **Step 5: Extend the auth/duplicate-socket regression tests**

Add cast REST/WS cases to `security.test.ts`, and make the duplicate-hello case in `ownership.test.ts` assert that an active cast viewer closes and a new reservation succeeds afterward.

- [ ] **Step 6: Run the server suite**

Run: `npm run build -w shared && npm test -w server`

Expected: all server tests pass; no test leaves a cast timer or WebSocket open.

- [ ] **Step 7: Commit server integration**

```bash
git add server/src/hub.ts server/src/app.ts server/tests/casting-routes.test.ts server/tests/security.test.ts server/tests/ownership.test.ts dashboard/src/types.ts
git commit -m "feat(server): expose authenticated live-view signaling"
```

---

### Task 4: Implement the browser WebRTC/signaling client

**Files:**
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/api.test.ts`
- Create: `dashboard/src/browser-rtc.ts`
- Create: `dashboard/src/casting.ts`
- Create: `dashboard/src/casting.test.ts`

**Interfaces:**
- Consumes: server endpoints/messages from Task 3.
- Produces: `requestCast(key, deviceId)`, `stopCast(key, sessionId)`, `castSocketUrl(key, sessionId)`; `BrowserRtcPeer`; `CastClient`; `CastViewState`; `CastClientCallbacks`.

Use these public state shapes:

```ts
type CastViewState =
  | { phase: "connecting" }
  | { phase: "awaiting_approval" }
  | { phase: "negotiating" }
  | { phase: "live" }
  | { phase: "failed"; error: CastFailureCode | CastRequestError };

type CastClientCallbacks = {
  onState(state: CastViewState): void;
  onStream(stream: MediaStream): void;
  onUnauthorized(): void;
};
```

- [ ] **Step 1: Add failing API tests**

Assert POST sends `{deviceId}` and returns the reservation, DELETE has no JSON body/content-type, and `castSocketUrl` uses `ws:`/`wss:`, URL-encodes key/session ID, and includes no other data.

- [ ] **Step 2: Add failing CastClient tests with fake socket/peer adapters**

Cover:

- status frames drive the exact UI phases;
- an offer sets the remote description, creates/sets one answer, and sends that answer;
- local ICE sends; remote ICE adds;
- `queues remote ICE until the offer is installed` and preserves order;
- the first remote track calls `onStream` once;
- failed/disconnected peer states fail and clean up;
- close code `4401` calls `onUnauthorized`;
- malformed, wrong-session, duplicate-offer, and late messages are ignored/fail without throwing;
- `close during negotiation is idempotent`, sends no late answer, closes peer/socket once, stops received tracks once, and calls DELETE once.

- [ ] **Step 3: Run dashboard tests and confirm red**

Run: `npm test -w dashboard -- src/api.test.ts src/casting.test.ts`

Expected: missing exports/modules or failing new assertions.

- [ ] **Step 4: Implement API functions and native peer adapter**

`browser-rtc.ts` wraps one `RTCPeerConnection({iceServers: []})`. Expose async `acceptOffer`, `createAnswer`, `addIce`, and `close` plus callbacks for local ICE, remote track, and connection state. Queueing policy belongs in `CastClient`, not the native adapter.

- [ ] **Step 5: Implement CastClient state, queue, and cleanup**

Validate message discriminator/session ID before acting. Serialize offer handling so ICE received early waits until `setRemoteDescription`. Guard every awaited continuation with a closed/session-generation check. A single private cleanup promise owns peer close, socket close, received-track stop, and optional DELETE.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -w dashboard -- src/api.test.ts src/casting.test.ts`

Expected: all focused tests pass.

Run: `npm run build -w dashboard`

Expected: TypeScript and Vite build succeed with native browser WebRTC types.

- [ ] **Step 7: Commit browser transport**

```bash
git add dashboard/src/api.ts dashboard/src/api.test.ts dashboard/src/browser-rtc.ts dashboard/src/casting.ts dashboard/src/casting.test.ts
git commit -m "feat(dashboard): add live-view WebRTC client"
```

---

### Task 5: Add the dashboard live-view experience

**Files:**
- Create: `dashboard/src/components/LiveViewModal.tsx`
- Create: `dashboard/src/components/LiveViewModal.test.tsx`
- Modify: `dashboard/src/components/DeviceCard.tsx`
- Modify: `dashboard/src/components/DeviceCard.test.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/App.test.tsx`
- Modify: `dashboard/src/messages.tsx`
- Modify: `dashboard/src/errors.ts`
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: `Device.supportsScreenCast`, Task 4 API/`CastClient`.
- Produces: `LiveViewModal`; `DeviceCardProps.onRequestCast(deviceId)` and `castBusy`; App-owned single cast flow.

- [ ] **Step 1: Write failing DeviceCard tests**

Assert:

- online + supported shows enabled **Request live view** and calls `onRequestCast("d1")`;
- offline disables it with the offline explanation;
- online + unsupported shows disabled **Update agent to view**;
- a local active/requesting cast disables every card's live-view action;
- the Turkish-card English-word scan covers supported and unsupported casting states.

- [ ] **Step 2: Write failing modal component tests**

For every `CastViewState`, assert the localized heading/body/status and the correct controls. Also assert `role="dialog"`, `aria-modal="true"`, headset name without Turkish suffixing, Escape/close invokes stop, failed state offers retry, and live state attaches/clears `video.srcObject`.

- [ ] **Step 3: Write failing App lifecycle tests**

Mock Task 4 factories and assert:

- clicking the card opens the modal in `connecting` before POST resolves;
- reservation creates exactly one client for that headset;
- double-click cannot create two POSTs;
- `CAST_BUSY`, offline, unsupported, and consent errors render their localized modal wording;
- `closing the modal while connecting releases one session`;
- retry uses a new reservation/session ID;
- `4401` returns to the existing key prompt;
- unmount stops an active cast exactly once.

- [ ] **Step 4: Run focused UI tests and confirm red**

Run: `npm test -w dashboard -- src/components/DeviceCard.test.tsx src/components/LiveViewModal.test.tsx src/App.test.tsx`

Expected: missing component/props/messages or failing assertions.

- [ ] **Step 5: Implement card and modal**

Keep WebRTC out of components. `LiveViewModal` receives `{deviceName,state,stream,onStop,onRetry,onClose}`. Use one `<video autoPlay muted playsInline>`; an effect assigns `srcObject`, calls `play()` without treating autoplay rejection as stream failure, and clears `srcObject` on cleanup. After 10 seconds in `live` with no track, show non-terminal “No picture yet; this game may block capture” guidance.

- [ ] **Step 6: Integrate one cast lifecycle into App**

Store the selected device, view state, remote stream, and client ref. Open the modal before awaiting `requestCast`. Disable all request buttons while that flow exists. Stop current work before retrying or responding to key invalidation.

- [ ] **Step 7: Add EN/TR copy, errors, and styles**

Add all request/status/error/control text to the typed message table. Map REST codes `DEVICE_NOT_FOUND`, `DEVICE_OFFLINE`, `CAST_UNSUPPORTED`, `CAST_BUSY` and agent failure codes without exposing raw SDP/platform errors. Add a responsive dark overlay/dialog, 16:9 video area, clear focus style, and reduced-motion-safe transitions using existing tokens.

- [ ] **Step 8: Run dashboard suite and build**

Run: `npm test -w dashboard`

Expected: all dashboard tests pass, including the Turkish no-English checks.

Run: `npm run build -w dashboard`

Expected: production build succeeds.

- [ ] **Step 9: Commit dashboard UI**

```bash
git add dashboard/src/components/LiveViewModal.tsx dashboard/src/components/LiveViewModal.test.tsx dashboard/src/components/DeviceCard.tsx dashboard/src/components/DeviceCard.test.tsx dashboard/src/App.tsx dashboard/src/App.test.tsx dashboard/src/messages.tsx dashboard/src/errors.ts dashboard/src/styles.css
git commit -m "feat(dashboard): show one headset live view"
```

---

### Task 6: Implement the Android-free casting controller

**Files:**
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/CastingState.kt`
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/CastingController.kt`
- Create: `quest-agent/app/src/test/kotlin/com/cafequest/agent/CastingControllerTest.kt`

**Interfaces:**
- Consumes: Task 1 Kotlin protocol frames/signals.
- Produces: `CastingPhase`, `CastingUiState`, `CastingStateStore`, `ProjectionGrant`, `CastingTransport`, `CastPublisher`, `CastPublisherFactory`, `PublisherEvents`, `CastingController`.

Use these stable boundaries:

```kotlin
enum class CastingPhase { IDLE, AWAITING_APPROVAL, NEGOTIATING, LIVE, FAILED }
data class CastingUiState(val phase: CastingPhase, val sessionId: String? = null, val error: String? = null)
interface ProjectionGrant
interface CastingTransport {
    fun sendStatus(sessionId: String, status: String, error: String? = null): Boolean
    fun sendSignal(sessionId: String, signal: RtcSignal): Boolean
}
interface CastPublisher {
    suspend fun start()
    suspend fun handle(signal: RtcSignal)
    fun stop()
}
```

`CastPublisherFactory.create(grant, PublisherEvents)` creates but does not start the publisher. `PublisherEvents` reports local signal, connected, and stopped(error?).

- [ ] **Step 1: Write failing controller tests**

Using fake transports, grants, publisher factory, and `runTest`, cover:

- request stores one session, publishes `AWAITING_APPROVAL`, and sends status;
- duplicate same request is idempotent; a different request cannot replace an active one;
- approval only from matching awaiting state creates/starts one publisher and sends `negotiating`;
- `late and mismatched grants never create a publisher`;
- denial sends `failed/consent_denied` and returns to a terminal UI state;
- answer/ICE for the matching negotiating/live session reaches the publisher; offer/wrong session does not;
- publisher local offer/ICE uses the currently attached transport and device ID through Task 1's agent message factory;
- connected sends `live`; publisher callback failure maps only to allowed stable codes;
- server stop, user stop, transport loss, repeated callbacks, and shutdown stop publisher once and return to `IDLE`/`FAILED` as specified;
- attaching a replacement transport never migrates an existing cast.

- [ ] **Step 2: Run focused Android test and confirm red**

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests com.cafequest.agent.CastingControllerTest`

Expected: Kotlin compilation fails because the casting units do not exist.

- [ ] **Step 3: Implement state/store and controller boundaries**

Keep both files free of `android.*` and `org.webrtc.*`. `CastingStateStore` exposes a read-only `StateFlow<CastingUiState>`. Controller methods are:

```kotlin
fun attachTransport(transport: CastingTransport)
fun detachTransport(transport: CastingTransport)
fun onRequest(message: CastRequest)
suspend fun onSignal(message: ServerCastSignal)
fun onStop(message: CastStop)
suspend fun approve(sessionId: String, grant: ProjectionGrant)
fun deny(sessionId: String)
fun stopByUser(sessionId: String)
fun shutdown()
```

Use one mutex for async transitions and a separate idempotent publisher teardown. Clear the active session before invoking publisher/transport callbacks that can re-enter.

- [ ] **Step 4: Run controller and all Android JVM tests**

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests com.cafequest.agent.CastingControllerTest`

Expected: focused test passes.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`

Expected: all existing and new JVM tests pass.

- [ ] **Step 5: Commit controller slice**

```bash
git add quest-agent/app/src/main/kotlin/com/cafequest/agent/CastingState.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/CastingController.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/CastingControllerTest.kt
git commit -m "feat(agent): model live-view lifecycle"
```

---

### Task 7: Implement the MediaProjection WebRTC publisher

**Files:**
- Modify: `quest-agent/app/build.gradle.kts`
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/ProjectionCapture.kt`
- Create: `quest-agent/app/src/main/kotlin/com/cafequest/agent/WebRtcPublisher.kt`
- Create: `quest-agent/app/src/test/kotlin/com/cafequest/agent/WebRtcPublisherTest.kt`

**Interfaces:**
- Consumes: Task 6 publisher boundaries.
- Produces: `AndroidProjectionGrant(resultCode, resultData)`; `CastVideoProfile(960,540,15,1_500_000)`; `ProjectionCapture`; `RtcPeer`; `AndroidRtcPeer`; `WebRtcPublisherFactory`.

- [ ] **Step 1: Pin and resolve the WebRTC dependency**

Add `implementation("io.getstream:stream-webrtc-android:1.3.9")` without changing repositories.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew :app:dependencies --configuration debugRuntimeClasspath`

Expected: Gradle resolves exactly `io.getstream:stream-webrtc-android:1.3.9`; no second `org.webrtc` AAR or duplicate native library appears.

- [ ] **Step 2: Write failing publisher orchestration tests**

Keep the native peer behind `RtcPeer`. With a fake peer, assert:

- start uses the exact support profile and emits one offer;
- local ICE is forwarded in order;
- remote answer/ICE is delegated, but a remote offer is rejected;
- peer `CONNECTED` reports publisher connected;
- `FAILED`, `CLOSED`, projection callback, or explicit stop reports one terminal callback and closes once;
- start failure maps to `capture_failed` without an exception string;
- repeated stop/start on the same publisher cannot reuse the one-use projection grant.

- [ ] **Step 3: Run focused test and confirm red**

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests com.cafequest.agent.WebRtcPublisherTest`

Expected: missing publisher/native-peer interfaces or failing assertions.

- [ ] **Step 4: Implement ProjectionCapture**

Wrap one `ScreenCapturerAndroid(resultData, MediaProjection.Callback)`, one `SurfaceTextureHelper`, and one WebRTC video source. `start(profile)` may be called once; `stop()` releases capturer, helper, and source in reverse order and is idempotent. Never log or persist the result intent.

- [ ] **Step 5: Implement AndroidRtcPeer and publisher**

Initialize one process-safe `PeerConnectionFactory`, `EglBase`, hardware-capable `DefaultVideoEncoderFactory` with software fallback, and one peer connection with empty ICE servers. Add the screen video track, create/set the local offer, trickle ICE, accept only answer/ICE, and set `RtpSender.parameters.encodings[0].maxBitrateBps = 1_500_000` when the encoding exists.

Map peer callbacks to Task 6 events. Close peer, track, capture, EGL/thread resources once. Do not initialize any audio module or add audio tracks.

- [ ] **Step 6: Run tests and assemble**

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests com.cafequest.agent.WebRtcPublisherTest`

Expected: focused tests pass.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleDebug`

Expected: `BUILD SUCCESSFUL`; APK contains the required arm64 WebRTC native library and no duplicate-native error.

- [ ] **Step 7: Commit capture transport**

```bash
git add quest-agent/app/build.gradle.kts quest-agent/app/src/main/kotlin/com/cafequest/agent/ProjectionCapture.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/WebRtcPublisher.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/WebRtcPublisherTest.kt
git commit -m "feat(agent): publish Quest screen over WebRTC"
```

---

### Task 8: Wire Quest consent, foreground service, socket, and headset UI

**Files:**
- Modify: `quest-agent/app/src/main/AndroidManifest.xml`
- Modify: `quest-agent/app/build.gradle.kts`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentService.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentDiagnostics.kt`
- Modify: `quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt`
- Modify: `quest-agent/app/src/test/kotlin/com/cafequest/agent/AgentStringsTest.kt`
- Modify: `quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt`
- Create: `quest-agent/app/src/test/kotlin/com/cafequest/agent/CastingServiceActionTest.kt`
- Create: `quest-agent/app/src/androidTest/kotlin/com/cafequest/agent/MediaProjectionServiceTest.kt`

**Interfaces:**
- Consumes: Tasks 1, 6, and 7.
- Produces: complete `screen_cast_v1` agent; consent/service actions; `AgentRuntime.casting`; pending/live headset UI; projection notification; version `0.5.0`/`5`.

- [ ] **Step 1: Add failing service-action, capability, string, and manifest tests**

Assert:

- `Hello` now advertises both `launch_android_package` and `screen_cast_v1` exactly once;
- intent-action parsing requires matching UUID session ID and a non-null successful result intent; malformed/stale inputs return a no-op action;
- every new casting string has EN/TR implementations and Turkish copy keeps the device name unsuffixed;
- installed service metadata contains both `FOREGROUND_SERVICE_TYPE_DATA_SYNC` and `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`;
- manifest declares `FOREGROUND_SERVICE_MEDIA_PROJECTION` and still declares no audio permission.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest --tests com.cafequest.agent.CastingServiceActionTest --tests com.cafequest.agent.AgentStringsTest --tests com.cafequest.agent.ProtocolTest`

Expected: missing actions/strings/capability or failing assertions.

- [ ] **Step 3: Wire the current agent WebSocket as CastingTransport**

`AgentService` owns one controller across connection replacements and injects it into each `AgentConnection`. On socket open, attach a transport bound to that exact `WebSocket`; on message, switch over `parseServerMessage`; on close/failure/finally, detach that same transport. A replacement connection must stop the active publisher rather than inherit it.

Only now add `CAPABILITY_SCREEN_CAST` to the default hello capability list.

- [ ] **Step 4: Add projection service permission/type and service actions**

Manifest:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<service android:name=".AgentService"
         android:foregroundServiceType="dataSync|mediaProjection"
         android:exported="false" />
```

Add internal actions for approved grant, denied grant, and user stop. For approval: validate session/result; call `ServiceCompat.startForeground` with `DATA_SYNC | MEDIA_PROJECTION`; then call `controller.approve`. When the controller becomes non-live/non-negotiating, post the data-sync-only notification/type. `onDestroy` calls `controller.shutdown()` before destroying connections.

- [ ] **Step 5: Implement notification and visible consent flow**

Notification content reflects waiting/live state and has a `PendingIntent` opening `MainActivity`. In `MainActivity`, register one activity-result launcher using `MediaProjectionManager.createScreenCaptureIntent()` only after the visible **Share screen with café staff** action. Send approved/denied service actions with the current session ID; clear the pending local ID after every result.

`AgentRuntime.casting` exposes the Task 6 store. The diagnostics screen shows:

- awaiting: request explanation + **Share screen with café staff**;
- negotiating/live: status + **Stop sharing**;
- failed: localized stable error + dismiss/retry guidance supplied by the next server request.

- [ ] **Step 6: Handle stale activity results explicitly**

Before promoting the service, compare the result's session ID to the controller's current awaiting session. The test `a stale activity result is ignored` must prove no publisher factory call and no mediaProjection service-type promotion after a server stop/timeout.

- [ ] **Step 7: Bump the agent version and run automated verification**

Set versionName `0.5.0`, versionCode `5`.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest`

Expected: all Android JVM tests pass.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew connectedDebugAndroidTest`

Expected when an Android/Quest target is attached: instrumentation tests pass. If no target is attached, record this as `UNVERIFIED_HARDWARE`; do not replace it with a JVM claim.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleDebug`

Expected: debug APK builds successfully.

- [ ] **Step 8: Commit the complete agent feature**

```bash
git add quest-agent/app/src/main/AndroidManifest.xml quest-agent/app/build.gradle.kts quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentService.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentConnection.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/MainActivity.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentDiagnostics.kt quest-agent/app/src/main/kotlin/com/cafequest/agent/AgentStrings.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/AgentStringsTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/ProtocolTest.kt quest-agent/app/src/test/kotlin/com/cafequest/agent/CastingServiceActionTest.kt quest-agent/app/src/androidTest/kotlin/com/cafequest/agent/MediaProjectionServiceTest.kt
git commit -m "feat(agent): approve and control live screen sharing"
```

---

### Task 9: Complete cross-stack verification, documentation, and physical acceptance

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/quest-setup.md`
- Modify: `docs/morning-test.md`
- Modify: `docs/poc-test-results.md`
- Modify: `docs/known-limitations.md`
- Modify: `docs/decisions.md`

**Interfaces:**
- Consumes: complete Tasks 1–8.
- Produces: truthful operator/setup docs, full automated proof, and measured Quest results when hardware is available.

- [ ] **Step 1: Add an end-to-end signaling regression test**

Extend `server/tests/casting-routes.test.ts` or `quest-simulator/tests/e2e.test.ts` with a fake capable agent plus browser WebSocket that completes request → bind → awaiting → offer → answer → ICE → live → DELETE. Assert the server never receives a binary/media frame, a second reservation is refused while live, and a new reservation succeeds after stop.

The simulator itself continues advertising no cast capability.

- [ ] **Step 2: Run full automated verification**

Run: `npm test`

Expected: shared, server, simulator, and dashboard suites all pass. Run with loopback permission if the sandbox otherwise returns `listen EPERM`.

Run: `npm run build`

Expected: all TypeScript/Vite workspaces build.

Run: `npx tsc -p tsconfig.json`

Expected: whole-repository TypeScript check passes.

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew testDebugUnitTest assembleDebug`

Expected: Android JVM suite and APK build pass.

- [ ] **Step 3: Update architecture and operator documentation**

Document the direct media path, single in-memory coordinator, consent flow, one-viewer limit, LAN host candidates, and exact stop behavior. State plainly that Developer Mode helps installation/debugging but does not remove per-session capture consent.

- [ ] **Step 4: Append decision and limitation records**

Append—not rewrite—decisions for `MediaProjection + direct WebRTC` and `one global video-only stream`. Add known limitations for no audio/recording/reconnect/TURN, per-session consent, and game capture opt-outs.

- [ ] **Step 5: Add physical test rows as NOT TESTED before running them**

Add rows for approval, time-to-picture, resolution/orientation, approximate latency, 15-minute stability, battery/thermal/game impact, both stop paths, denial, sleep, Wi-Fi loss, viewer refresh, duplicate-device replacement, second-device refusal, fresh consent, and representative game capture compatibility.

- [ ] **Step 6: Install and run the physical Quest matrix**

For at least one headset of every café model:

```bash
adb install -r quest-agent/app/build/outputs/apk/debug/app-debug.apk
```

Start the local server/dashboard, request a view while a managed game is foreground, open CafeQuest, approve, return to the game, and measure against:

- picture within `15 s` after approval;
- latency below about `2 s`;
- usable `960×540 / 15 FPS` support view;
- stable `15 min` session;
- stop/cleanup within `3 s`;
- second device blocked until release.

Record the observed model, Horizon OS version, Wi-Fi conditions, game, latency range, battery delta, temperature/performance notes, and pass/fail. If a target is unavailable, leave the row `NOT TESTED`; do not infer a pass.

- [ ] **Step 7: Tune only from measured evidence**

If hardware misses the targets, change one profile dimension at a time in `CastVideoProfile` (first bitrate, then FPS, then resolution), rerun the 15-minute row, and record both measurements. Do not add TURN, audio, multiple streams, or recording as part of tuning.

- [ ] **Step 8: Re-run changed-file and full verification after tuning/docs**

Run the focused suites for any tuned file, then repeat the full commands from Step 2. Confirm `git diff --check` is clean and `git status --short` lists only intended files.

- [ ] **Step 9: Commit documentation and measured results**

```bash
git add CLAUDE.md README.md docs/architecture.md docs/quest-setup.md docs/morning-test.md docs/poc-test-results.md docs/known-limitations.md docs/decisions.md server/tests/casting-routes.test.ts quest-simulator/tests/e2e.test.ts
git commit -m "docs: verify one-headset live support view"
```

Do not describe casting as hardware-ready unless the physical rows passed. Automated/source completion and physical Quest acceptance remain separate release claims.
