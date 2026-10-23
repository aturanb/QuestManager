export type Db = import("better-sqlite3").Database;

export type NoteRow = {
  id: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type DeviceRow = {
  id: string;
  name: string;
  model: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  firstSeenAt: string | null;
  batteryLevel: number | null;
  charging: 0 | 1 | null;
  expectedGameId: string | null;
  expectedGameName: string | null;
  expectedGameStartedAt: string | null;
  usageAccessGranted: 0 | 1 | null;
  foregroundPackageName: string | null;
  foregroundStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GameRow = {
  id: string;
  name: string;
  metaAppId: string;
  packageName: string | null;
  enabled: 0 | 1;
  createdAt: string;
  updatedAt: string;
};

export type DeviceAppRow = {
  deviceId: string;
  packageName: string;
  label: string;
  versionName: string | null;
  versionCode: number | null;
  scannedAt: string;
};

export type SessionRow = {
  id: string;
  deviceId: string;
  startedAt: string;
  /** null while an unlimited session runs; stopping one records when play ended. */
  endsAt: string | null;
  status: "active" | "expired" | "stopped";
  createdAt: string;
  updatedAt: string;
};

export type CommandRow = {
  id: string;
  deviceId: string;
  type: string;
  status: "queued" | "sent" | "received" | "success" | "failed" | "timeout";
  createdAt: string;
  receivedAt: string | null;
  completedAt: string | null;
  error: string | null;
};
