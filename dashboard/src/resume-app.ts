import type { Device } from "./types";

/** The agent app itself; it is what takes the foreground during a manual consent, so it is never "the game". */
export const AGENT_PACKAGE = "com.cafequest.agent";

export type ResumeApp = { packageName: string; name: string };

/** The "Şu an açık" app worth coming back to: online headset, usage access on, and not CafeQuest. */
export function resumableApp(device: Device | undefined): ResumeApp | null {
  if (!device || !device.online || device.usageAccessGranted !== true) return null;
  const app = device.foregroundApp;
  if (!app || app.packageName === AGENT_PACKAGE) return null;
  return { packageName: app.packageName, name: app.name };
}
