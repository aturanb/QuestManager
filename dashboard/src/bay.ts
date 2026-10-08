import type { Device } from "./types";
import { remainingMs } from "./time";

/**
 * What a headset means to staff right now. One value drives the card's colored
 * edge, its big readout and the header pips, so they can never disagree.
 */
export type BayState =
  | { kind: "playing" | "ending"; remainingMs: number; totalMs: number }
  | { kind: "timeup"; endedAt: string }
  | { kind: "free" }
  | { kind: "offline" };

export type BayKind = BayState["kind"];

/** The last stretch of a session, when staff should get ready to swap players. */
export const ENDING_MS = 5 * 60_000;

export function bayState(device: Device, now: number, serverOffsetMs: number): BayState {
  const session = device.session;
  if (session) {
    const left = remainingMs(session.endsAt, now, serverOffsetMs);
    if (session.status === "expired" || left <= 0) return { kind: "timeup", endedAt: session.endsAt };
    if (session.status === "active") {
      // Extensions move endsAt, so this is the paid length including them.
      const totalMs = new Date(session.endsAt).getTime() - new Date(session.startedAt).getTime();
      return { kind: left <= ENDING_MS ? "ending" : "playing", remainingMs: left, totalMs };
    }
  }
  // The clock outranks connectivity: an offline headset can still be mid-session.
  return { kind: device.online ? "free" : "offline" };
}
