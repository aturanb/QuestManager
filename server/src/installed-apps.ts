import { createHash } from "node:crypto";
import type { AppCatalog } from "./catalog.js";
import type { Db } from "./db.js";
import { getGameByPackage } from "./store.js";
import type { DeviceAppRow } from "./types.js";

/**
 * Meta system components that Quest installs as ordinary user packages, so the
 * agent's non-system filter lets them through. They are not games and have no
 * Meta App ID; without this the dashboard asks staff for one forever.
 */
const IGNORED_PACKAGES: ReadonlySet<string> = new Set([
  "com.meta.handseducationmodule",
  "com.oculus.accountscenter",
]);

export function isIgnoredPackage(packageName: string): boolean {
  return IGNORED_PACKAGES.has(packageName);
}

export type ResolvedInstalledApp = Omit<DeviceAppRow, "deviceId" | "scannedAt"> & {
  name: string;
  metaAppId: string | null;
  source: "manual" | "catalog" | null;
};

export function resolveInstalledApp(db: Db, catalog: AppCatalog, app: DeviceAppRow): ResolvedInstalledApp {
  const manual = getGameByPackage(db, app.packageName);
  const match = catalog.get(app.packageName);
  return {
    packageName: app.packageName,
    label: app.label,
    versionName: app.versionName,
    versionCode: app.versionCode,
    name: manual?.name ?? match?.name ?? app.label,
    metaAppId: manual?.metaAppId ?? match?.metaAppId ?? null,
    source: manual ? "manual" : match ? "catalog" : null,
  };
}

export function manualGameId(packageName: string): string {
  return `installed-${createHash("sha256").update(packageName).digest("hex").slice(0, 16)}`;
}
