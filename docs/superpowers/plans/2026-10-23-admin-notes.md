# Persistent Admin Notes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Add persistent shared notes to the admin dashboard.

**Architecture:** An additive SQLite notes table, CRUD in store.ts, authenticated
Fastify routes, and a self-contained React page using the existing API client,
styles, and translations. Revision checks reject stale edits and deletions.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 18, Vitest, node:test.

**Spec:** docs/superpowers/specs/2026-10-23-admin-notes-design.md

## Global constraints

- Remain in this clean user-provided checkout. Leave changes uncommitted.
- Content is trimmed plain text, 1–5,000 characters. Existing admin auth applies.
- Additive idempotent schema; SQL belongs in store.ts; English/Turkish copy pairs.
- Preserve drafts through save failures, refresh, and page navigation.

## Review focus

- A real file-backed database survives reopen and existing headset data survives.
- Stale clients cannot overwrite or delete a newer note.
- Failure or overlapping requests cannot clear unsaved input or duplicate writes.
- Untrusted multiline content renders as text and wraps on narrow screens.
- Expired credentials return staff to the existing admin-key prompt.

### Task 1: Persistent authenticated API

- [x] Write server/tests/notes.test.ts for CRUD, validation, authorization,
  revisions, and file-backed reopen; observe failure before implementation.
- [x] Add NoteRow in server/src/types.ts, table in server/src/db.ts, and
  listNotes/createNote/getNote/updateNote/deleteNote in server/src/store.ts.
- [x] Add GET/POST /api/notes and PUT/DELETE /api/notes/:noteId in app.ts.
  Note shape: {id, content, createdAt, updatedAt, revision}; POST returns 201,
  PUT returns {note}, DELETE returns {deleted}; malformed input 400,
  missing note 404, stale revision 409.
- [x] Run npm run build -w server and node --test server/dist/tests/notes.test.js.

### Task 2: Dashboard notes UI

- [x] Add failing UI behavior tests and API request coverage.
- [x] Add dashboard Note type, API calls, bilingual notes messages, NotesPage
  component and CSS. Integrate as a dedicated page in App.tsx.
- [x] Run focused dashboard tests and build; verify error retention, CRUD,
  filtering, admin reauthentication, and Turkish labels.

### Task 3: Verification

- [x] Run npm test with permitted localhost networking and npm run build.
- [x] Inspect desktop and narrow layouts against a disposable local server.
- [x] Review the complete diff and run git diff --check. Record results below.

## Execution record

- Follow-up scope: the user requested a separate Notes page with top navigation
  and confirmed the need for Turkish UI support. Implement `/#/notes` with
  Headsets/Notes links, preserve `#bay-*` links, drafts and in-flight saves, and
  adapt the header at phone, tablet and desktop widths.
- Follow-up regression tests were observed failing before implementation:
  navigation/direct-link tests plus the existing CRUD/draft/Turkish tests.

- Baseline sandbox integration tests encounter listen EPERM on 127.0.0.1;
  baseline is being repeated with permitted localhost networking.
- Working in place and leaving changes uncommitted follows the user's request
  to add the feature to this checkout without adding an integration step.

- Baseline with permitted localhost networking: 470 tests passed (35 shared,
  167 server, 11 simulator, 257 dashboard).
- Task 1: six notes API tests passed after the initial missing-route failures.
  File-backed close/reopen retained the note and existing headset record.
- Task 2: nine dashboard notes tests passed after missing-panel failures.
  The refresh/deleted-note case was reproduced and fixed without losing the editor.
- Independent review found two important failure cases: reauthentication could
  unmount unsaved drafts; a lost creation response could duplicate a retry.
  Both were reproduced with failing regression tests and fixed. Drafts now live
  above the auth gate and a stable creation request ID deduplicates retries.
- Final verification: `npm test` passed all 485 tests (35 shared, 173 server,
  11 simulator, 266 dashboard). `npm run build` and `git diff --check` passed.
- Browser smoke against a disposable in-memory backend: create, edit, and reload
  retained the saved note. Desktop and 375px Turkish layouts inspected; measured
  document width 375px with no horizontal overflow. Screenshots in
  `/tmp/questmanager-notes-desktop.jpg` and `/tmp/questmanager-notes-mobile.jpg`.
- Runtime scope: no production database, headset agent, or deployed service was
  changed. The disposable preview was stopped. Changes remain uncommitted.

- Follow-up completed: `NotesPage.tsx` replaces the collapsible panel. App has
  native Headsets/Notes navigation links, direct `/#/notes` loading, and hash
  history handling while preserving existing `#bay-*` links. The page stays
  mounted while hidden so pending saves and drafts survive navigation.
- Follow-up verification: `npm test` passed 487 tests (35 shared, 173 server,
  11 simulator, 268 dashboard). `npm run build` and `git diff --check` passed.
  The initial build caught an unsupported Testing Library test option, which
  was removed before the final successful build.
- Independent follow-up source review found no concrete regressions. Browser
  smoke verified direct Notes loading, Back/Forward, retained drafts, and a
  summary link returning to the correct headset below the sticky header.
- Turkish UI inspected on desktop, 375px phone and 740px tablet; document width
  matched the viewport at both narrow widths. Preview screenshots:
  `/tmp/questmanager-notes-page-tr-desktop.jpg` and
  `/tmp/questmanager-notes-page-tr-mobile.jpg`.
- Follow-up changes remain local and uncommitted. Disposable preview stopped;
  no deployment or production-data change was made.
