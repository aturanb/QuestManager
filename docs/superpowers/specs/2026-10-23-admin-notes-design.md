# Persistent admin notes

Add a shared café Notes page for freeform records such as games purchased for
Quest 02, installed games, and equipment reminders. This is an implementation
proposal based on the user's request; the user confirmed shared café notes.

## Approach

Use the existing Fastify API and SQLite database. Browser-only storage would
keep notes on one browser; headset-linked notes would add structure the examples
do not require. A shared list lets staff mention any headset or game in plain
text and remains available from any authorized browser.

## Behavior

- A dedicated Notes page (`/#/notes`) and Headsets page (`/#/`) reached from the
  top navigation. The user requested this layout after the initial panel.
  Entering Notes loads server data; switching pages preserves drafts and pending
  requests. Direct links, reloads, and browser back/forward select the right page.
- Existing `#bay-*` summary links still select and scroll to the headset board.
  Notes uses normal page scrolling and a responsive single/two-column layout.
- Add, edit, delete after inline confirmation, search, and refresh. Newest updates
  appear first. Content is plain text, 1–5,000 characters after trimming.
- Save explicitly; show pending, empty, success, and error states. Failed saves
  retain drafts, including through admin reauthentication. A stable creation
  request ID deduplicates retries after an ambiguously failed response. All
  controls and messages support English and Turkish.
- A note has a UUID, content, createdAt, updatedAt, and integer revision. Edits
  and deletes require the current revision; stale writes return 409 and keep
  the user's draft so another browser's changes are not silently overwritten.
- Notes use the existing admin authentication. No headset or game foreign key;
  deleting a headset must not delete historical notes.
- Add the table idempotently on database open; preserve all existing records.
  No dependency, Android agent, deployment, or credential changes.

## Verification

Exercise real API CRUD, invalid input, authentication, stale revisions, and
file-backed persistence across app close/reopen. Exercise dashboard editing,
search, deletion, retained drafts on failure, and Turkish copy. Run the full
workspace suite and production build, then visually inspect both pages and the
top navigation on desktop and narrow screens in English and Turkish.
