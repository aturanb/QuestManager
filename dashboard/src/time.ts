// Server clock is authoritative (§26): remaining = endsAt - serverTime.

import { messages, type Messages } from "./messages";

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

/** "4 min ago" style relative label, in the words of the active language. */
export function formatAgo(
  iso: string | null,
  nowMs: number,
  serverOffsetMs: number,
  words: Messages["time"] = messages.en.time
): string {
  if (!iso) return words.never;
  const sec = Math.max(0, Math.floor((nowMs + serverOffsetMs - new Date(iso).getTime()) / 1000));
  if (sec < 5) return words.justNow;
  if (sec < 60) return words.secondsAgo(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return words.minutesAgo(min);
  return words.hoursAgo(Math.floor(min / 60), min % 60);
}

/** Compact last-seen age: use only the largest whole unit that applies. */
export function formatLastSeenAgo(
  iso: string | null,
  nowMs: number,
  serverOffsetMs: number,
  words: Messages["time"] = messages.en.time
): string {
  if (!iso) return words.never;
  const sec = Math.max(0, Math.floor((nowMs + serverOffsetMs - new Date(iso).getTime()) / 1000));
  if (sec < 60) return words.secondsAgo(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return words.minutesAgo(min);
  const hours = Math.floor(min / 60);
  if (hours < 24) return words.wholeHoursAgo(hours);
  return words.daysAgo(Math.floor(hours / 24));
}
