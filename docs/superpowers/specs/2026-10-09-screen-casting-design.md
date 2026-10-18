# One-headset live support view

Date: 2026-10-09 · Status: approved, ready for implementation

## Problem

When a customer needs help inside a game, café staff can see that the headset is
online and which managed game is open, but they cannot see what the customer is
seeing. Staff must put on the headset, rely on a verbal description, or open a
separate developer casting tool. That is too slow for routine support.

## Goal and success criteria

Let a worker request a low-bandwidth live view of one headset from the existing
CafeQuest dashboard. The customer or worker approves the request inside the
headset, then the selected headset's view appears in the browser.

- Exactly one headset can stream at a time across the CafeQuest server.
- The stream is video-only, live-only, and available only on the café LAN.
- The wearer explicitly approves every capture session in Quest's system UI.
- After approval, usable video appears within 15 seconds under normal café LAN
  conditions.
- The initial target is about 960×540 at 15 FPS with a 1–1.5 Mbps bitrate cap.
- End-to-end latency should stay below about two seconds on the café network.
- Closing the viewer, pressing Stop, losing either peer, or revoking projection
  ends capture and frees the global slot within three seconds.
- Existing launch, telemetry, session, discovery, and simulator behavior stays
  compatible with older agents.

These latency and timing values are physical acceptance targets, not claims
until they have been measured on every Quest model used by the café.

## Constraints and decisions

| Topic | Decision |
|---|---|
| Capture API | Android `MediaProjection`, which Meta documents for Quest casting and screen sharing. |
| Consent | Required for every new session. Developer Mode does not bypass the system consent token for a normal sideloaded app. |
| Transport | Direct WebRTC from the headset to the requesting browser. The Node server relays control and signaling only, never video frames. |
| Android WebRTC | Pin `io.getstream:stream-webrtc-android:1.3.9`, a maintained prebuilt libWebRTC distribution exposing `org.webrtc.ScreenCapturerAndroid`. The first Android task verifies artifact resolution and Quest compatibility before deeper integration. |
| Scope | One global stream and one viewer. A second request receives `409 CAST_BUSY`. |
| Quality | Video only, about 960×540, 15 FPS, and 1–1.5 Mbps. The WebRTC encoder may adapt lower when the LAN or headset requires it. |
| Network | LAN host ICE candidates only for v1; no public STUN, TURN, internet relay, or remote viewing. |
| Storage | Cast sessions, SDP, ICE candidates, and video are ephemeral and never written to SQLite or files. |
| Authentication | Reuse the current `ADMIN_API_KEY` on the REST and browser WebSocket endpoints. Do not add device enrollment, certificates, or a second auth system. |
| Encryption | Use WebRTC's built-in DTLS-SRTP. Do not add separate media encryption infrastructure. |
| Browser lifecycle | Refreshing or closing the viewing tab ends the stream. V1 does not reconnect a viewer to an existing capture. |
| Audio and recording | Excluded. No microphone, game audio, screenshots, or recording controls. |
| Simulator | Advertises no casting capability. Casting is disabled for simulated and older agents. |

Alternatives rejected:

- Relaying JPEG or H.264 data through the existing WebSockets would make the
  server a media relay, add custom framing/playback work, and increase latency
  and server bandwidth.
- Driving MQDH or scrcpy through wireless ADB would depend on developer desktop
  tooling and brittle process/window control instead of the CafeQuest agent.
- An SFU, TURN server, or internet streaming service is unnecessary for a
  single viewer on the same café LAN.

## User experience

### Dashboard

An online device card whose connected agent advertises `screen_cast_v1` gets a
**Request live view** action. Older agents show a disabled **Update agent to
view** action; offline headsets cannot request a stream.

Selecting **Request live view** opens a modal immediately. The modal is the
only cast viewer and moves through these states:

1. **Connecting** — reserves the server slot and connects its cast WebSocket.
2. **Waiting for headset approval** — tells staff to have the customer open
   CafeQuest and approve screen sharing.
3. **Starting video** — consent succeeded and WebRTC negotiation is running.
4. **Live** — shows the headset name, `<video>` element, connection indicator,
   and **Stop live view**.
5. **Failed** — shows a localized explanation and **Try again**. Retry creates
   a completely new session and requires new consent.

Closing the modal while a request or live stream exists stops the server
session. A browser navigation or WebSocket close has the same effect. While
this dashboard owns a cast, its other live-view actions are disabled. Another
dashboard may still attempt a request, but the server is authoritative and
returns `CAST_BUSY`.

All new UI text is added to `dashboard/src/messages.tsx` in English and
Turkish. Stable error codes are translated at render time; raw platform errors
are not displayed.

### Headset

A remote request never forces `MainActivity` over the running game. Android
restricts background activity launches, and an unexpected foreground switch
would disrupt the customer.

When the agent receives a request it:

- records one pending request in process memory;
- reports `awaiting_approval` to the server;
- updates its foreground notification to say that a live-view request is
  waiting; and
- exposes a prominent **Share screen with café staff** action when CafeQuest is
  opened.

The customer or worker opens CafeQuest, taps that action, and then accepts the
Quest system capture dialog. Denial reports `consent_denied` and clears the
request. Approval is passed to `AgentService`, which promotes its foreground
service to the combined `dataSync|mediaProjection` types before libWebRTC asks
for the `MediaProjection` object.

While live, the diagnostics screen and persistent notification say that the
screen is being shared and offer **Stop sharing**. All strings have English and
Turkish implementations in `AgentStrings.kt`.

## Architecture

### 1. Shared agent protocol

The protocol remains version 1 and adds the capability
`screen_cast_v1`. Capability negotiation prevents the server from sending cast
frames to an older APK.

Casting is not forced into the persisted `launch_app` command lifecycle. It
uses separate, ephemeral frames:

Server to agent:

- `cast_request { sessionId, expiresAt }`
- `cast_signal { sessionId, signal }`
- `cast_stop { sessionId, reason }`

Agent to server:

- `cast_status { deviceId, sessionId, status, error? }`
- `cast_signal { deviceId, sessionId, signal }`

`status` is one of `awaiting_approval`, `negotiating`, `live`, `stopped`, or
`failed`. Errors are stable bounded codes, not exception strings:
`consent_denied`, `approval_timeout`, `negotiation_timeout`,
`projection_stopped`, `peer_disconnected`, `capture_failed`, or
`internal_error`.

`signal` is a discriminated union of:

- `offer { sdp }`
- `answer { sdp }`
- `ice { candidate, sdpMid?, sdpMLineIndex? }`

The agent is always the WebRTC offerer because it creates the outgoing video
track after consent. SDP is capped at 64 KiB, ICE candidates at 4 KiB, and
session IDs are UUIDs. Agent-originated frames carry `deviceId` to preserve the
existing protocol-v1 invariant, but the server ownership-checks it against the
agent socket and never uses an untrusted ID to select a routing destination.

`shared/src/protocol.ts` remains the Zod source of truth and
`quest-agent/.../Protocol.kt` remains its hand-maintained Kotlin mirror. Both
get parser and bounds tests.

### 2. Server CastCoordinator

New `server/src/cast-coordinator.ts` owns the single in-memory session. It has
no SQL dependency. `Hub` delegates parsed agent cast frames to it and exposes a
bounded ephemeral-send method for coordinator-to-agent frames.

The live agent connection already retains advertised capabilities. Dashboard
snapshots gain `supportsScreenCast`, derived from that live connection rather
than stored in SQLite, so the device card can distinguish an offline headset
from an online headset running an older APK.

Session states:

```text
reserved -> awaiting_approval -> negotiating -> live
    |               |                |           |
    +---------------+----------------+-----------+-> stopped | failed
```

There is at most one non-terminal session. A session contains only:

- UUID and target device ID;
- current state and stable error code;
- creation, approval-expiry, and negotiation-expiry timestamps;
- the bound agent socket identity;
- the bound browser WebSocket; and
- timer handles needed for cleanup.

The coordinator never stores SDP or ICE after relaying it. It validates session
ownership and state before every relay and ignores late messages from a
terminal or replaced socket.

New authenticated endpoints:

- `POST /api/casts` with `{ deviceId }` validates online status, capability,
  and the global slot, then returns `{ sessionId, status: "reserved" }`.
- `DELETE /api/casts/:sessionId` is idempotent for any dashboard holding the
  existing admin key and stops the session if it is still active.
- `/cast-ws?key=<admin-key>&sessionId=<uuid>` binds the requesting browser to
  the reserved session.

The POST reserves the slot but does not contact the headset yet. The first
authorized browser socket presenting that unguessable session ID becomes its
sole viewer. Only after that socket connects does the coordinator send
`cast_request`; this eliminates the race where a fast approval produces an
offer before a viewer is ready. Failure to bind a browser within 10 seconds
cancels the reservation. Approval then has 90 seconds, and negotiation has 20
seconds.

The browser socket accepts only `answer` and `ice` signals for its bound
session. It receives cast status plus agent `offer` and `ice` signals. The
existing request-logging prohibition stays in place so the admin key query is
not logged.

Terminal cleanup is one idempotent operation. It cancels timers, sends
`cast_stop` when the agent is still connected, closes the browser cast socket,
releases references, and makes the global slot available. It runs for explicit
Stop, viewer close, agent disconnect/replacement, timeout, failed status, and
server shutdown.

### 3. Android casting boundary

New focused units keep Android and WebRTC details out of the connection loop:

- `CastingController` owns the pure session state machine, the pending request,
  timeout validation, and start/stop orchestration.
- `WebRtcPublisher` wraps `PeerConnectionFactory`, `PeerConnection`, the video
  source/track, ICE callbacks, bitrate configuration, and SDP operations.
- `ProjectionCapture` wraps `ScreenCapturerAndroid` and the
  `MediaProjection.Callback` cleanup signal.
- `AgentRuntime.casting` exposes observable casting state and user actions to
  Compose without making UI composables depend on socket or WebRTC classes.

`AgentConnection` parses cast frames and delegates them to the controller. The
controller sends status and signaling through a small injected transport
interface implemented by the current connection. If the agent connection is
replaced or lost, the controller stops capture rather than leaving an orphaned
projection.

`MainActivity` registers the screen-capture activity-result contract. It asks
for consent only in response to the visible **Share screen** action. A successful
result starts `AgentService` with an internal action and the one-use result
data. The service first calls `startForeground` with the combined
`dataSync|mediaProjection` type, then gives the result data to the controller.

The manifest adds `FOREGROUND_SERVICE_MEDIA_PROJECTION`; `AgentService`
declares `dataSync|mediaProjection`. Stopping a cast returns its notification
and active type to data sync only. No `RECORD_AUDIO` or microphone service type
is added.

WebRTC uses a hardware-capable encoder factory where Horizon OS supports one,
with a software fallback supplied by libWebRTC. The publisher requests
960×540/15 FPS and caps the active video sender at 1.5 Mbps. Codec negotiation
may select H.264 or VP8; the design does not depend on one codec until hardware
testing proves a need to constrain it.

The agent version advances from 0.4.0/code 4 to 0.5.0/code 5.

### 4. Dashboard viewer

New `dashboard/src/casting.ts` owns the browser-side state machine,
`RTCPeerConnection`, dedicated WebSocket, SDP answer, trickled ICE, remote
track, and cleanup. React components consume its state rather than calling
WebRTC APIs directly.

When the agent offer arrives, the browser:

1. creates one `RTCPeerConnection` with an empty `iceServers` list;
2. sets the remote offer;
3. creates and sets its answer;
4. sends the answer through the cast socket;
5. relays subsequent ICE candidates; and
6. attaches the first remote video track to the modal's `<video autoplay
   muted playsInline>` element.

The media stream is never copied into application state. Cleanup nulls
`srcObject`, stops received tracks, closes the peer connection and cast socket,
and calls the idempotent DELETE endpoint when appropriate.

The browser reports ICE/peer failure to the server before closing when
possible. V1 does not issue `restartIce()` or attempt to keep capture alive
through a page refresh; **Try again** follows the full consent flow.

## Failure behavior

| Condition | Result |
|---|---|
| Device offline | POST returns `409 DEVICE_OFFLINE`; no session allocated. |
| Old/simulator agent | POST returns `409 CAST_UNSUPPORTED`; dashboard asks for an APK update. |
| Another cast active | POST returns `409 CAST_BUSY`; active session is untouched. |
| Browser never binds | Reservation ends after 10 s; no request reaches the headset. |
| No headset approval | Agent/server clear the request after 90 s with `approval_timeout`. |
| Consent denied | Agent reports `consent_denied`; both sides clean up. |
| WebRTC not live in 20 s | Session fails with `negotiation_timeout`. |
| Viewer socket/tab closes | Server sends `cast_stop` and immediately frees the slot. |
| Agent disconnects or is replaced | Server closes the viewer; agent cleanup runs locally on connection loss. |
| MediaProjection revoked or another projection starts | Android callback stops capture and reports `projection_stopped`. |
| ICE/peer connection fails | Either peer reports `peer_disconnected`; no automatic retry. |
| Game blocks capture | The viewer shows no-video guidance; compatibility stays unverified until a physical test records it. |
| Server shuts down | Coordinator stops its active agent/viewer pair before sockets close. |

Cleanup is idempotent on every component because several failures may arrive at
once. Late status or signaling for a terminal session is ignored and cannot
affect a later session.

## Testing

### Shared protocol

Node tests and mirrored Kotlin JVM tests cover every cast frame, capability,
status, error and signaling variant; UUID and size bounds; missing or surplus
fields; malformed JSON; unknown future messages; and old launch-only agents.

### Server

Unit tests for `CastCoordinator` use fake agent and viewer transports and a fake
clock. They cover:

- single global allocation and `CAST_BUSY`;
- offline and unsupported rejection;
- the browser-bind, approval, and negotiation timeouts;
- binding signals to the allocated agent and viewer only;
- stale, foreign, duplicate, and out-of-order messages;
- consent failure and explicit Stop;
- viewer close, agent disconnect/replacement, and server shutdown;
- idempotent cleanup and slot reuse; and
- no SDP, ICE, or admin key in captured logs.

Route/WebSocket tests cover admin-key enforcement, POST/DELETE response shapes,
invalid session IDs, binary/oversized frames, and a complete fake
agent-to-browser signaling exchange without carrying media through the server.

### Android agent

JVM tests keep platform objects behind interfaces and cover:

- the pure casting state machine and legal transitions;
- one pending request and rejection of mismatched session IDs;
- approval, denial, expiry, disconnect, callback stop, and duplicate cleanup;
- status/error mapping without leaking exception strings;
- signal parsing and offer/answer/ICE routing; and
- diagnostics and English/Turkish casting words.

An instrumented smoke test verifies manifest/service-type wiring and that a
mocked successful activity result reaches the projection boundary. Automated
tests do not claim that Quest's compositor or a game produces usable frames.

### Dashboard

Vitest and Testing Library cover:

- action availability for online, offline, supported, and older agents;
- modal states and localized text;
- POST, cast-socket binding, offer/answer/ICE routing, and remote-track attach;
- Stop, modal close, page cleanup, timeout, consent denial, busy response, and
  retry creating a new session; and
- cleanup exactly once even when WebSocket and peer failures race.

Browser WebRTC primitives are injected behind a small adapter so these tests do
not depend on jsdom implementing `RTCPeerConnection`.

### Physical Quest acceptance

Run on at least one headset of every Quest model in the café and record results
in `docs/poc-test-results.md`:

1. Request while a managed game is foreground; open CafeQuest and approve.
2. Confirm compositor video appears in the dashboard within 15 seconds.
3. Verify the view is oriented/cropped usefully at the requested dimensions.
4. Measure approximate latency and confirm controls/text are readable.
5. Return to the game and keep the stream usable for 15 minutes.
6. Observe headset battery, thermals, game smoothness, and Wi-Fi stability.
7. Stop from dashboard and headset; verify notification and slot cleanup.
8. Repeat denial, headset sleep, Wi-Fi loss, viewer refresh, agent reconnect,
   and a second-device request.
9. Test representative games and record any game that blocks or blanks capture.
10. Start a second session and confirm Quest requires fresh consent.

The initial acceptance targets are video within 15 seconds after approval,
under about two seconds of latency, and full cleanup within three seconds.
Hardware results override assumptions and may justify lowering resolution,
frame rate, or bitrate before rollout.

## Documentation

- `CLAUDE.md`: casting capability, ephemeral protocol, service permission,
  commands, and hardware-proof boundary.
- `docs/architecture.md`: one-session coordinator and direct media path.
- `docs/quest-setup.md`: no extra ADB grant; how staff request and approve a
  live view; Developer Mode alone does not grant capture consent.
- `docs/morning-test.md`: casting happy path and failure checks.
- `docs/poc-test-results.md`: new `NOT TESTED` rows before physical execution.
- `docs/known-limitations.md`: one viewer/headset, LAN-only host candidates,
  per-session consent, no reconnect/audio/recording, and game capture opt-outs.
- `docs/decisions.md`: append the MediaProjection/WebRTC and one-global-stream
  decisions without rewriting earlier entries.
- `README.md`: concise operator-facing description after hardware proof, with
  unverified behavior labeled until then.

## Out of scope

- More than one simultaneous headset or viewer.
- Audio, microphone, screenshots, recording, playback, or stored history.
- Internet access, remote support, public STUN, TURN, an SFU, or a media relay.
- Automatic stream restart, tab-refresh recovery, or reusing projection consent.
- ADB, MQDH, scrcpy, root, system-app privileges, or bypassing Quest consent.
- Remote controller input or interaction with the customer's game.
- Guaranteed compatibility with games that disable capture.
- Replacing the existing LAN/admin-key security model.
