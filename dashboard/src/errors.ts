import { ApiError } from "./api";
import { messages, type Messages } from "./messages";

// Server error codes, in the words staff need at the counter (messages.tsx).
// Unknown codes fall through unchanged so nothing is ever hidden.
export function friendlyError(e: unknown, t: Messages = messages.en): string {
  if (e instanceof ApiError) {
    if (e.message === "game_meta_app_id_not_configured") return t.errors.gameNeedsAppId(e.detail);
    if (e.message === "catalog_refresh_failed") return t.errors.catalogFailed(e.detail);
    // The only field the session body has is minutes (1–1440).
    if (e.message === "invalid session body") return t.errors.minutes;
    // api.ts words a reply without an error code this way.
    if (e.message === `request failed (${e.status})`) return t.errors.requestFailed(e.status);
    const known = t.errors.codes[e.message];
    if (known) return known;
    return e.detail ? `${e.message}: ${e.detail}` : e.message;
  }
  // fetch() rejects with a TypeError when nothing answers at all.
  if (e instanceof TypeError) return t.errors.unreachable;
  return e instanceof Error ? e.message : t.errors.fallback;
}
