import { describe, expect, it } from "vitest";
import { AGENT_PACKAGE, resumableApp, shouldOfferResume } from "./resume-app";
import type { Device } from "./types";

function quest(over: Partial<Device> = {}): Device {
  return {
    id: "d1",
    name: "Quest 01",
    model: "Quest 3",
    agentVersion: "0.5.0",
    lastSeenAt: null,
    batteryLevel: 80,
    charging: false,
    expectedGame: null,
    usageAccessGranted: true,
    foregroundApp: { packageName: "com.fun.beat", name: "Beat Saber", startedAt: "2026-10-10T10:00:00.000Z" },
    online: true,
    session: null,
    lastCommand: null,
    installedApps: [],
    supportsScreenCast: true,
    controllerBattery: null,
    ...over,
  };
}

describe("resumableApp", () => {
  it("is the app open on an online headset", () => {
    expect(resumableApp(quest())).toEqual({ packageName: "com.fun.beat", name: "Beat Saber" });
  });

  it("never offers CafeQuest itself, which is what hides the game during a cast", () => {
    const foregroundApp = { packageName: AGENT_PACKAGE, name: "CafeQuest", startedAt: "2026-10-10T10:00:00.000Z" };
    expect(resumableApp(quest({ foregroundApp }))).toBeNull();
  });

  it("is nothing when no app is open, usage access is missing, or the headset is offline", () => {
    expect(resumableApp(quest({ foregroundApp: null }))).toBeNull();
    expect(resumableApp(quest({ usageAccessGranted: false }))).toBeNull();
    expect(resumableApp(quest({ online: false }))).toBeNull();
    expect(resumableApp(undefined)).toBeNull();
  });
});

describe("shouldOfferResume", () => {
  const beat = { packageName: "com.fun.beat", name: "Beat Saber" };

  it("offers the remembered app when something else is in front", () => {
    const cafequest = { packageName: AGENT_PACKAGE, name: "CafeQuest", startedAt: "2026-10-10T10:05:00.000Z" };
    expect(shouldOfferResume(beat, quest({ foregroundApp: cafequest }))).toBe(true);
    expect(shouldOfferResume(beat, quest({ foregroundApp: null }))).toBe(true);
  });

  it("stays quiet when the remembered app is already open, or nothing was remembered", () => {
    expect(shouldOfferResume(beat, quest())).toBe(false);
    expect(shouldOfferResume(null, quest({ foregroundApp: null }))).toBe(false);
  });

  it("stays quiet when the headset is gone", () => {
    expect(shouldOfferResume(beat, undefined)).toBe(false);
  });
});
