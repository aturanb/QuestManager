// Server clock is authoritative (§26): remaining = endsAt - serverTime.

/** ms between a server timestamp and now, compensating clock skew via offset. */
export function remainingMs(endsAtIso: string, nowMs: number, serverOffsetMs: number): number {
  return new Date(endsAtIso).getTime() - (nowMs + serverOffsetMs);
}

/** "42:17" style countdown; clamps past-zero to "0:00". */
export function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/** Elapsed foreground time using the same m:ss style as session countdowns. */
export function formatElapsedSince(startedAtIso: string, nowMs: number, serverOffsetMs: number): string {
  const elapsed = nowMs + serverOffsetMs - new Date(startedAtIso).getTime();
  return formatRemaining(elapsed);
}

/** "4 minutes ago" style relative label for last-seen. */
export function formatAgo(iso: string | null, nowMs: number, serverOffsetMs: number): string {
  if (!iso) return "never";
  const sec = Math.max(0, Math.floor((nowMs + serverOffsetMs - new Date(iso).getTime()) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)}h ${min % 60}m ago`;
}
