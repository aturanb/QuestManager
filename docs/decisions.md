# CafeQuest Decisions

## Monorepo layout

Decision: npm workspaces with `shared`, `server`, `quest-simulator`, `dashboard`, `quest-agent`.

Reason: Matches brief §11; shared protocol package prevents duplicating message
shapes (§14 "Do not duplicate arbitrary message shapes").

## Configuration file

Decision: one `cafequest.config.json` (see example) holds user-supplied values:
Meta Dashboard App ID, Quest-side server URL, and the game catalog
(id, name, metaAppId, enabled per §19).

Reason: The user asked for a single config file with placeholder defaults so the
hardware hookup tomorrow is a two-line edit. Game `metaAppId`s stay as obvious
placeholders rather than invented IDs (§19).

## Server-side launch without a real agent

Decision: The server persists commands and, when a device is offline at launch
time, records status `queued` instead of failing hard; the queue is delivered on
the device's next WebSocket connection.

Reason: Makes morning testing forgiving (headset connects after dashboard use)
and keeps HTTP 200 from being misread as proof of launch (§21).

## Offline detection

Decision: A device is OFFLINE when `now - lastSeenAt > 15s` (§15), evaluated by
a server sweep every 5s and included in dashboard state pushes.

## Command timeout

Decision: 10 seconds from command sent to `command_result`, else `timeout` (§21).
