# Multiple headset live views

## Intent and scope

Let café staff watch several headsets simultaneously from the existing dashboard.
The user authorized implementing the server and dashboard changes described in
the preceding feasibility assessment. Keep the APK and `screen_cast_v1` wire
protocol unchanged. Each headset retains its own consent prompt and one viewer.

## Approaches

- Independent direct WebRTC sessions per headset: reuse the existing agent,
  transport, and controls. This is the selected implementation because each
  headset already publishes independently.
- A server media relay or several viewers for one headset would require a larger
  transport change and is outside this request.

## Behavior and boundaries

- The server tracks sessions by session ID and reserves at most one per device.
  A second request for that same device returns `409 CAST_BUSY`; different
  capable, online devices may reserve concurrently, including from other tabs.
- Signaling, timeouts, socket replacement, disconnects, and cleanup remain bound
  to the matching session, device, agent connection, and viewer socket.
- Server shutdown stops every cast. No cast state or media is persisted.
- The dashboard keeps independent pending requests, clients, streams, retries,
  and customer-app resume state per device. Late callbacks or reservations
  cannot revive a closed view or affect a different view.
- Floating viewers share a scrollable responsive dock: two columns on wide
  screens, one on narrow screens. Each viewer retains minimize and fullscreen.
  Escape closes only the focused viewer, or the most recently opened viewer
  when focus is outside the dock. A resume prompt takes precedence over Escape.
- Customer-app resume prompts are queued when several views end; each refers
  to the correct headset. Restarting a view clears prompts for that headset.
- Authorization loss and dashboard unmount stop all locally owned casts.
- Keep the current English/Turkish UI and revise busy text to refer to the
  selected headset. Keep video-only, LAN-only direct WebRTC and existing limits.

## Verification and limits

Exercise two concurrent sessions through the coordinator and real WebSocket
routes, including signaling isolation and cleanup. Exercise independent dashboard
views, pending-request races, retries, resume prompts, keyboard handling, and
unmount/auth cleanup. Run the full workspace test suite and production build.
Physical multi-headset playback, Wi-Fi capacity, and browser decoder capacity
remain hardware validation tasks; automated signaling tests do not prove them.

This document supersedes the one-global-stream restriction in the 2026-10-09
casting design and plan. Other capture, consent, and transport constraints stay
in effect. Update current documentation and append the architectural decision.
