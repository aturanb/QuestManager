// cafequest.config.json loading + game seeding (P0-C, brief §19).
// The config file holds the values only the human can supply; the database
// remains the source of truth afterwards, so seeding never clobbers edits.
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";

export const ConfigGameSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  metaAppId: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type ConfigGame = z.infer<typeof ConfigGameSchema>;

export const CafeQuestConfigSchema = z.object({
  metaAppId: z.string().min(1).default("UNCONFIGURED"),
  questServerUrl: z.string().min(1).default("http://localhost:3000"),
  games: z.array(ConfigGameSchema).default([]),
});
export type CafeQuestConfig = z.infer<typeof CafeQuestConfigSchema>;

export const DEFAULT_GAMES: ConfigGame[] = [
  { id: "beat-saber", name: "Beat Saber", metaAppId: "FILL_BEAT_SABER_APP_ID", enabled: true },
  { id: "walkabout-mini-golf", name: "Walkabout Mini Golf", metaAppId: "FILL_WALKABOUT_APP_ID", enabled: true },
  { id: "eleven-table-tennis", name: "Eleven Table Tennis", metaAppId: "FILL_ELEVEN_APP_ID", enabled: true },
];

export function defaultConfig(): CafeQuestConfig {
  return { metaAppId: "UNCONFIGURED", questServerUrl: "http://localhost:3000", games: DEFAULT_GAMES };
}

/** True for empty, UNCONFIGURED, or still-carrying-a-FILL_ marker (§19: never invent IDs). */
export function isPlaceholderAppId(id: string | null | undefined): boolean {
  if (!id || !id.trim()) return true;
  return id === "UNCONFIGURED" || id.includes("FILL_");
}

/** Explicit env override, else cafequest.config.json at the repo root. */
export function defaultConfigPath(): string {
  if (process.env.CAFEQUEST_CONFIG) return process.env.CAFEQUEST_CONFIG;
  // server/dist/src/config.js -> ../../../ = repo root
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../cafequest.config.json");
}

export function loadCafeQuestConfig(configPath?: string): { config: CafeQuestConfig; path: string; found: boolean } {
  const p = configPath ?? defaultConfigPath();
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    return { config: defaultConfig(), path: p, found: false };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`CafeQuest config at ${p} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = CafeQuestConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `CafeQuest config at ${p} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`
    );
  }
  return { config: parsed.data, path: p, found: true };
}

/**
 * Seed configured games: insert missing rows, upgrade a placeholder metaAppId
 * to a real one, but never overwrite a real metaAppId/name the staff set
 * (via dashboard PUT or direct DB edit).
 */
export function seedConfiguredGames(db: Db, games: ConfigGame[]): { inserted: number; upgraded: number } {
  const now = new Date().toISOString();
  let inserted = 0;
  let upgraded = 0;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO games (id, name, meta_app_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const g of games) {
    const r = insert.run(g.id, g.name, g.metaAppId, g.enabled ? 1 : 0, now, now);
    if (r.changes > 0) {
      inserted += 1;
      continue;
    }
    const cur = db.prepare("SELECT meta_app_id AS m FROM games WHERE id = ?").get(g.id) as { m: string } | undefined;
    if (cur && isPlaceholderAppId(cur.m) && !isPlaceholderAppId(g.metaAppId)) {
      db.prepare("UPDATE games SET meta_app_id = ?, updated_at = ? WHERE id = ?").run(g.metaAppId, now, g.id);
      upgraded += 1;
    }
  }
  return { inserted, upgraded };
}
