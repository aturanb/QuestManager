# Headset Card Ordering Implementation Plan

> Execute inline with a test-first workflow. Steps use checkbox syntax for tracking.

**Goal:** Arrange headset cards by dragging, with persistent browser ordering.

**Architecture:** A React ordering hook derives devices from saved IDs. A board
component owns drag state and accessible reorder controls; App supplies existing
DeviceCards and uses the same order for the summary.

**Tech Stack:** React 18, TypeScript, native drag events, localStorage, Vitest.

**Spec:** docs/superpowers/specs/2026-10-23-headset-card-order-design.md

## Constraints and review focus

- Preserve existing dirty files and leave changes uncommitted in this checkout.
- No new dependencies; paired English/Turkish copy.
- Snapshots cannot reset ordering or detach card actions/drafts from device IDs.
- Missing/new devices and malformed/unavailable storage cannot break the board.
- Drops from outside the board and cancelled drags cannot reorder devices.
- Keyboard/tap controls must work at grid boundaries and narrow widths.

### Task 1: Reordering and persistence

- [x] Add failing App integration tests for dragging, reload, live updates,
  selection/action state, keyboard/tap movement, invalid storage and save failure.
- [x] Observe the missing controls fail before product changes.
- [x] Add useDeviceOrder.ts, DeviceBoard.tsx, optional DeviceCard reorder controls,
  App integration, translations and scoped styles.
- [x] Run the focused integration tests and dashboard production build.

### Task 2: Verification

- [x] Run the full workspace suite, production build and git diff --check.
- [x] Inspect desktop/narrow English/Turkish layouts and real browser dragging.
- [x] Review only the task's changes against the pre-existing working tree.

## Execution record

- Working in place preserves the existing Notes feature, which overlaps App,
  messages and styles. No worktree or integration operation is needed.
- Twelve arrangement integration tests pass. Missing drag controls and saved
  order were observed failing before implementation. A separate regression
  assertion failed before accepting drag entry as a valid drop target.
- Native Chrome verification reproduced a fast gesture that reached its target
  before a drag-over event. Accepting drag entry fixed that case; native dragging,
  reload persistence, keyboard movement and tap buttons were then verified.
- English/Turkish desktop layouts and Turkish 375px/740px layouts were inspected.
  At both narrow sizes, document width matched viewport width. Screenshot:
  `/tmp/questmanager-headset-order-preview.png` (disposable fixture devices).
- Final `npm test` passed 499 tests: 35 shared, 173 server, 11 simulator,
  280 dashboard. `npm run build` and `git diff --check` passed. Integration
  tests needed permitted localhost networking; the restricted run hit EPERM.
  Existing jsdom media-play warnings remain in live-view tests, without failures.
- Independent read-only review found no actionable findings and separately
  confirmed the 12 arrangement tests. Existing Notes work remains intact.
- No dependencies, backend settings, live café data or agents changed. Changes
  remain uncommitted; the disposable preview was stopped after verification.
