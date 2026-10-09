import type { Device } from "./types";
import { remainingMs } from "./time";

/**
 * What a headset means to staff right now. One value drives the card's colored
 * edge, its big readout and the header pips, so they can never disagree.
 */
export type BayState =
  | { kind: "playing" | "ending"; remainingMs: number; totalMs: number }
  | { kind: "unlimited"; playedMs: number }
  | { kind: "timeup"; endedAt: string }
  // playedMs: a stopped unlimited session's length, kept up until the next session.
  | { kind: "free" | "offline"; playedMs?: number };

export type BayKind = BayState["kind"];

/** The last stretch of a session, when staff should get ready to swap players. */
export const ENDING_MS = 5 * 60_000;

export function bayState(device: Device, now: number, serverOffsetMs: number): BayState {
  const session = device.session;
  if (session?.status === "active" && session.endsAt === null) {
    return { kind: "unlimited", playedMs: now + serverOffsetMs - new Date(session.startedAt).getTime() };
  }
  if (session && session.status !== "stopped" && session.endsAt !== null) {
    const left = remainingMs(session.endsAt, now, serverOffsetMs);
    if (session.status === "expired" || left <= 0) return { kind: "timeup", endedAt: session.endsAt };
    if (session.status === "active") {
      // Extensions move endsAt, so this is the paid length including them.
      const totalMs = new Date(session.endsAt).getTime() - new Date(session.startedAt).getTime();
      return { kind: left <= ENDING_MS ? "ending" : "playing", remainingMs: left, totalMs };
    }
  }
  // The clock outranks connectivity: an offline headset can still be mid-session.
  const kind = device.online ? "free" : "offline";
  // The server only keeps a stopped session on the board when it was unlimited.
  if (session?.status === "stopped" && session.endsAt !== null) {
    return { kind, playedMs: new Date(session.endsAt).getTime() - new Date(session.startedAt).getTime() };
  }
  return { kind };
}
