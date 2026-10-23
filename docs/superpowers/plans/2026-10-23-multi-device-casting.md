# Multiple headset casting implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Watch several headsets concurrently without updating the APK.

**Architecture:** Replace the global server slot with session and device indexes.
Keep independent dashboard flows per device and render viewers in a responsive dock.

**Tech Stack:** TypeScript, Fastify/WebSocket, React, CSS, node:test, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-multi-device-casting-design.md`

## Global constraints

- Keep the APK and `screen_cast_v1` wire protocol unchanged.
- One session and one viewer per headset; same-device conflicts remain `CAST_BUSY`.
- No media relay, persistence, recording, audio, or new dependencies.
- Keep all auth, signaling identity, consent, and timeout boundaries.
- Leave changes uncommitted for user review; do not deploy or change live services.

## Review focus

- Two pending reservations completing in reverse order stay with their headsets.
- A stale callback or close cannot affect a retried session.
- Disconnect, timeout, and stop of one session leave other sessions running.
- Escape and queued game-resume prompts target one headset at a time.
- Authorization loss and unmount clean up clients and late reservations.

### Task 1: Server session isolation

**Files:** `server/src/cast-coordinator.ts`, `server/tests/cast-coordinator.test.ts`,
`server/tests/casting-routes.test.ts`, `server/tests/ownership.test.ts`, `server/src/app.ts`.

**Interfaces:** Preserve reserve/bind/signal/stop signatures and HTTP/WS messages.
Change the read-only `active` diagnostic to an array of `ActiveCastInfo`.

- [x] Add failing concurrent-device coordinator tests for relay, ownership,
  independent stop/disconnect/timeouts, and shutdown.
- [x] Run focused tests and confirm the global slot causes failures.
- [x] Index casts by session and device; keep connection/viewer identity checks
  and idempotent cleanup. Adapt existing diagnostic assertions.
- [x] Add real two-agent/two-viewer route coverage and revise the global-slot test.
- [x] Run coordinator, route, and ownership tests; expect no failures.

### Task 2: Dashboard session isolation and dock

**Files:** `dashboard/src/App.tsx`, new `dashboard/src/useLiveViews.ts`,
`dashboard/src/App.test.tsx`, `dashboard/src/components/LiveViewModal.tsx`,
`dashboard/src/components/LiveViewModal.test.tsx`, `dashboard/src/styles.css`,
`dashboard/src/messages.tsx`, `dashboard/src/api.ts`.

**Interfaces:** Hook accepts devices, API key, auth callback, optional cast factory;
returns views, resume prompts, start/end/retry/dismiss actions. Existing clients
and viewer controls keep their current interfaces except optional Escape scope.

- [x] Add failing UI tests for two views, reverse pending responses, independent
  retry/close, stale callbacks, resume queues, auth cleanup, and unmount.
- [x] Confirm the single-view code fails the new cases.
- [x] Extract per-device flow ownership into the hook, retaining synchronous
  duplicate guards and request-generation identity checks.
- [x] Render independent viewers in a responsive dock, scope Escape, update
  busy copy in both languages, and keep per-headset launch controls.
- [x] Run dashboard tests and production build; expect no failures.

### Task 3: Documentation and final verification

**Files:** README, CLAUDE, architecture, decisions, live-view-testing, morning-test,
and supersession pointers in the original casting design/plan.

**Interfaces:** No runtime interfaces; document current behavior and hardware checks.

- [x] Update the active one-global-stream descriptions and append a decision.
- [x] Run `npm test`, `npm run build`, and `git diff --check`; expect all to pass.
- [x] Review the complete uncommitted diff with a fresh reviewer; address
  correctness findings and rerun checks affected by any fixes.
- [x] Record hardware validation as pending and deliver the feature branch.

## Execution record

- Coordinator tests first failed at the old global allocation, then passed after
  introducing per-session and per-device indexes. Real two-agent/two-viewer
  WebSocket tests and ownership checks passed (33 focused server tests).
- Dashboard tests first failed at the one-view guard, then passed with per-device
  flow ownership. Independent review found that retry and quick reopen could
  race the previous session's cleanup. Three failing regressions reproduced it;
  per-device cleanup barriers fixed it without blocking another headset.
- Full workspace tests passed: 35 shared, 176 server, 11 simulator, 294 dashboard
  (516 total). The production build passed after correcting an extra field in
  a test fixture; no runtime protocol or APK change was required.
- Chrome layout verification used three synthetic viewer panels at desktop and
  390 x 844. Two columns were visible on desktop; mobile used one column, scrolled
  to the third viewer, and had document width 390 with no horizontal overflow.
  The temporary preview file, browser tab, and local preview service were removed.
- Live multi-headset playback and practical Wi-Fi/browser capacity remain
  `UNVERIFIED_HARDWARE`; the physical walkthrough is in `docs/live-view-testing.md`.
- Branch: `feature/multi-device-casting`. Changes remain uncommitted and undeployed.
