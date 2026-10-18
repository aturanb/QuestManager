import * as fs from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** Load a local env file when present. Node preserves already-exported values. */
export function loadEnvFileIfPresent(envPath: string): boolean {
  if (!fs.existsSync(envPath)) return false;
  loadEnvFile(envPath);
  return true;
}

/** Treat unset and whitespace-only optional variables identically. */
export function nonBlankEnv(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/** Locate `.env` from server/dist/src at runtime and load the repository copy. */
export function loadRootEnv(moduleUrl: string = import.meta.url): boolean {
  const envPath = resolve(dirname(fileURLToPath(moduleUrl)), "../../..", ".env");
  return loadEnvFileIfPresent(envPath);
}
