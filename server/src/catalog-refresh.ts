import { statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultCatalogPath } from "./catalog.js";

/**
 * Community package-name → Meta App ID list (threethan/MetaMetadata), refreshed
 * daily upstream. This and `scripts/update-catalog.mjs` are the only code paths
 * in CafeQuest that reach the network.
 */
export const CATALOG_SOURCE_URL =
  "https://raw.githubusercontent.com/threethan/MetaMetadata/main/data/known_oculus_apps.json";

/** The real list holds well over this; a smaller response means a bad fetch. */
const MIN_VALID_ENTRIES = 1000;
const PACKAGE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const META_APP_ID = /^\d{5,32}$/;

export type CatalogRefreshResult = { entries: number; fetchedAt: string };

type CatalogRecord = { appName: string; packageName: string; id: string };

function isUsable(entry: unknown): entry is CatalogRecord {
  if (!entry || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  return (
    typeof record.appName === "string" &&
    record.appName.length > 0 &&
    record.appName.length <= 128 &&
    typeof record.packageName === "string" &&
    record.packageName.length <= 255 &&
    PACKAGE_NAME.test(record.packageName) &&
    typeof record.id === "string" &&
    META_APP_ID.test(record.id)
  );
}

/**
 * Download the catalog and replace the local cache atomically.
 *
 * Every failure path (network, HTTP status, shape, too few records) throws
 * before the cache is touched, so a bad refresh always leaves staff with the
 * mappings they had.
 */
export async function refreshAppCatalog(opts: {
  path?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<CatalogRefreshResult> {
  const path = opts.path ?? defaultCatalogPath();
  const doFetch = opts.fetchImpl ?? fetch;

  const response = await doFetch(CATALOG_SOURCE_URL, {
    headers: { "user-agent": "CafeQuest-local-catalog-updater/1" },
  });
  if (!response.ok) throw new Error(`catalog download failed: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("catalog response was not the expected application array");

  const valid = payload.filter(isUsable);
  if (valid.length < MIN_VALID_ENTRIES) {
    throw new Error(`catalog did not contain enough valid package mappings (${valid.length})`);
  }

  const temporary = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(valid)}\n`, "utf8");
  await rename(temporary, path);

  return { entries: valid.length, fetchedAt: new Date().toISOString() };
}

/** Cache-file mtime as ISO, or null when no refresh has ever been stored. */
export function catalogFetchedAt(path = defaultCatalogPath()): string | null {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

/** Re-export for `scripts/update-catalog.mjs`, which has no access to ./catalog.js types. */
export function defaultCatalogPathForCli(): string {
  return defaultCatalogPath();
}
