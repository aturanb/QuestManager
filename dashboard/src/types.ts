// Snapshot shapes served by GET /api/devices and /dashboard-ws state pushes.
export type ExpectedGame = { gameId: string; name: string; launchedAt: string };
export type Note = { id: string; content: string; revision: number; createdAt: string; updatedAt: string };
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
  /** Live connection capability (screen_cast_v1); false offline or for older agents. */
  supportsScreenCast: boolean;
  /** Null while controller monitoring is off; never persisted (fresh readings after restart). */
  controllerBattery: DeviceControllerBattery | null;
};
export type Game = { id: string; name: string; metaAppId: string; enabled: number | boolean };

/** Optional controller-battery diagnostics (server ADB collection; off by default). */
export type ControllerBatterySide = { level: number; state: "active" | "inactive" };
export type ControllerBatteryReason =
  | null
  | "headset_offline"
  | "no_wireless_address"
  | "adb_connect_failed"
  | "wireless_debugging_off"
  | "agent_permission_missing"
  | "dump_failed"
  | "parse_failed";
export type DeviceControllerBattery = {
  left: ControllerBatterySide | null;
  right: ControllerBatterySide | null;
  observedAt: string | null;
  status: "available" | "stale" | "unavailable";
  reason: ControllerBatteryReason;
};
export type ControllerBatteryAvailability = "disabled" | "ready" | "adb_unavailable" | "no_devices";
export type ControllerBatteryMonitoringState = {
  enabled: boolean;
  availability: ControllerBatteryAvailability;
};

export type Snapshot = {
  serverTime: string;
  devices: Device[];
  controllerBatteryMonitoring: ControllerBatteryMonitoringState;
};

/** Live-view states relayed on /cast-ws (mirrors the shared protocol enums). */
export type CastSessionStatus = "awaiting_approval" | "negotiating" | "live" | "stopped" | "failed";
export type CastFailureCode =
  | "consent_denied"
  | "approval_timeout"
  | "negotiation_timeout"
  | "projection_stopped"
  | "peer_disconnected"
  | "capture_failed"
  | "internal_error";
/** Stable REST refusals that can end a request before any headset is contacted. */
export type CastRequestError =
  | "DEVICE_NOT_FOUND"
  | "DEVICE_OFFLINE"
  | "CAST_UNSUPPORTED"
  | "CAST_BUSY"
  | "REQUEST_FAILED";
