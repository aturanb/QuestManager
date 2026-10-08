import { describe, expect, it } from "vitest";
import { bayState, ENDING_MS } from "./bay";
import type { Device } from "./types";

const START = Date.parse("2026-01-01T00:00:00Z");
const END = Date.parse("2026-01-01T01:00:00Z");

function device(status: "active" | "expired" | null, online = true): Device {
  return {
    id: crypto.randomUUID(),
    name: "Quest",
    model: "Quest 3",
    agentVersion: "0.1.0",
    lastSeenAt: null,
    batteryLevel: null,
    charging: null,
    expectedGame: null,
    online,
    session: status
      ? { id: crypto.randomUUID(), startedAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString(), status }
      : null,
    lastCommand: null,
    installedApps: [],
    usageAccessGranted: null,
    foregroundApp: null,
  };
}

describe("bayState", () => {
  it("counts down an active session against its paid length", () => {
    expect(bayState(device("active"), START + 10 * 60_000, 0)).toEqual({
      kind: "playing",
      remainingMs: 50 * 60_000,
      totalMs: 60 * 60_000,
    });
  });

  it("flags the last five minutes as ending", () => {
    expect(bayState(device("active"), END - ENDING_MS, 0).kind).toBe("ending");
    expect(bayState(device("active"), END - ENDING_MS - 1, 0).kind).toBe("playing");
  });

  it("shows time up for an expired session", () => {
    expect(bayState(device("expired"), START, 0)).toEqual({ kind: "timeup", endedAt: new Date(END).toISOString() });
  });

  it("shows time up before the server sweep marks a locally elapsed session expired", () => {
    expect(bayState(device("active"), END + 1000, 0).kind).toBe("timeup");
  });

  it("uses the server clock offset, not the browser clock", () => {
    // Browser runs 10 minutes slow: the server already sees the session as over.
    expect(bayState(device("active"), END - 5 * 60_000, 10 * 60_000).kind).toBe("timeup");
  });

  it("keeps the clock running on an offline headset mid-session", () => {
    expect(bayState(device("active", false), START, 0).kind).toBe("playing");
  });

  it("is free when online with no session and offline otherwise", () => {
    expect(bayState(device(null, true), START, 0)).toEqual({ kind: "free" });
    expect(bayState(device(null, false), START, 0)).toEqual({ kind: "offline" });
  });
});
