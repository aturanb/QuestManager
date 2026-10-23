# Headset card ordering

Allow staff to arrange the existing headset grid by dragging a dedicated handle.
Move earlier/later buttons and arrow keys on the handle provide keyboard and
single-tap alternatives. Keep normal selection, rename, session, launch and live
view controls independent of dragging. Use the existing responsive grid.

Save the ordered device IDs in this browser's local storage, like the dashboard
language. Live snapshots, renames, status changes and reloads retain that order;
unseen devices append in server order and missing devices are ignored. The header
summary follows the same order. Invalid or unavailable storage must not prevent
the board from working; failed saves leave the current arrangement usable and
show a translated message.

Approaches considered: browser preferences fit this presentation-only change
without a server migration; shared server ordering would add API, persistence and
multi-user conflict handling. Use browser preferences as the implementation
default. Native desktop dragging plus move buttons avoids a new dependency and
provides a touch alternative. All labels and feedback have English/Turkish pairs.

Keep the existing uncommitted Notes work intact. No commit, deployment, agent,
database or runtime-setting changes are part of this task.
