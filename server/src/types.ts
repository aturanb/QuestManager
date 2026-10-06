export type Db = import("better-sqlite3").Database;

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
  createdAt: string;
  updatedAt: string;
};

export type GameRow = {
  id: string;
  name: string;
  metaAppId: string;
  enabled: 0 | 1;
  createdAt: string;
  updatedAt: string;
};

export type SessionRow = {
  id: string;
  deviceId: string;
  startedAt: string;
  endsAt: string;
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
