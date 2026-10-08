import { ApiError } from "./api";

// Server error codes, in the words staff need at the counter. Unknown codes
// fall through unchanged so nothing is ever hidden.
const STAFF_MESSAGES: Record<string, string> = {
  "headset offline": "Headset is offline. Wait for it to reconnect.",
  headset_online: "This headset is connected. Remove it once it shows offline.",
  "session already active": "A session is already running on this headset.",
  "no active session to extend": "No running session to extend.",
  "no active session to stop": "No running session to stop.",
  app_not_installed: "That game isn't installed on this headset.",
  meta_app_id_unknown: "This app has no Meta App ID yet.",
};

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    // The server's detail names the game and where to set its ID.
    if (e.message === "game_meta_app_id_not_configured") return e.detail ?? "This game has no Meta App ID yet.";
    const known = STAFF_MESSAGES[e.message];
    if (known) return known;
    return e.detail ? `${e.message}: ${e.detail}` : e.message;
  }
  // fetch() rejects with a TypeError when nothing answers at all.
  if (e instanceof TypeError) return "Can't reach the CafeQuest server. Check it's running on the café PC.";
  return e instanceof Error ? e.message : "Request failed.";
}
