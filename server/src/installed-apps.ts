import { createHash } from "node:crypto";
import type { AppCatalog } from "./catalog.js";
import type { Db } from "./db.js";
import { getGameByPackage } from "./store.js";
import type { DeviceAppRow } from "./types.js";

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
