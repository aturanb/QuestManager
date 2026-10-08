import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CatalogApp = {
  name: string;
  packageName: string;
  metaAppId: string;
};

export type AppCatalog = ReadonlyMap<string, CatalogApp>;

const PACKAGE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const META_APP_ID = /^\d{5,32}$/;

const VERIFIED_FALLBACK_APPS: CatalogApp[] = [
  { name: "Beat Saber", packageName: "com.beatgames.beatsaber", metaAppId: "2448060205267927" },
  { name: "Walkabout Mini Golf", packageName: "com.MightyCoconut.WalkaboutMiniGolf", metaAppId: "2462678267173943" },
  { name: "Eleven Table Tennis", packageName: "quest.eleven.forfunlabs", metaAppId: "1995434190525828" },
  { name: "Breachers", packageName: "com.TriangleFactory.Breachers", metaAppId: "5740397619319389" },
  { name: "After the Fall", packageName: "com.vertigogames.atf", metaAppId: "2160364850746031" },
];

export function defaultCatalogPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../data/app-catalog.json");
}

export function loadAppCatalog(path = defaultCatalogPath()): Map<string, CatalogApp> {
  const catalog = new Map(VERIFIED_FALLBACK_APPS.map((app) => [app.packageName, app]));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return catalog;
  }
  if (!Array.isArray(raw)) return catalog;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = record.appName;
    const packageName = record.packageName;
    const metaAppId = record.id;
    if (
      typeof name !== "string" || name.length < 1 || name.length > 128 ||
      typeof packageName !== "string" || !PACKAGE_NAME.test(packageName) || packageName.length > 255 ||
      typeof metaAppId !== "string" || !META_APP_ID.test(metaAppId)
    ) continue;
    catalog.set(packageName, { name, packageName, metaAppId });
  }
  return catalog;
}
