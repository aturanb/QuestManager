// Snapshot shapes served by GET /api/devices and /dashboard-ws state pushes.
export type ExpectedGame = { gameId: string; name: string; launchedAt: string };
/** endsAt is null while an unlimited session runs; a stopped one carries when play ended. */
export type SessionInfo = { id: string; startedAt: string; endsAt: string | null; status: string };
export type CommandInfo = { id: string; status: string; error: string | null };
export type InstalledApp = {
  packageName: string;
  label: string;
  versionName: string | null;
  versionCode: number | null;
  name: string;
  metaAppId: string | null;
  source: "manual" | "catalog" | null;
};
export type ForegroundApp = { packageName: string; name: string; startedAt: string };
export type Device = {
  id: string;
  name: string;
  model: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  batteryLevel: number | null;
  charging: boolean | null;
  expectedGame: ExpectedGame | null;
  usageAccessGranted: boolean | null;
  foregroundApp: ForegroundApp | null;
  online: boolean;
  session: SessionInfo | null;
  lastCommand: CommandInfo | null;
  installedApps: InstalledApp[];
};
export type Game = { id: string; name: string; metaAppId: string; enabled: number | boolean };
export type Snapshot = { serverTime: string; devices: Device[] };
