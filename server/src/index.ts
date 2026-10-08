import { buildApp } from "./app.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCafeQuestConfig, isPlaceholderAppId } from "./config.js";
import { normKey } from "./auth.js";
import { loadRootEnv, nonBlankEnv } from "./env.js";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadRootEnv();

const portEnv = Number(process.env.PORT);
// Fall back to 3000 when PORT is unset or unusable (e.g. PORT=0/empty leaks
// into some shells); tests pick an ephemeral port via buildApp options.
const port = Number.isInteger(portEnv) && portEnv > 0 ? portEnv : 3000;
const host = nonBlankEnv(process.env.HOST) ?? "0.0.0.0";
// Default data dir is relative to the server package root (not cwd): npm runs
// workspace scripts with cwd=server/, which would otherwise nest server/server/.
const dbPath = nonBlankEnv(process.env.DB_PATH)
  ?? resolve(serverRoot, "data/cafequest.db");

const { config, path: configPath, found } = loadCafeQuestConfig();
const adminApiKey = normKey(process.env.ADMIN_API_KEY);
const deviceEnrollmentKey = normKey(process.env.DEVICE_ENROLLMENT_KEY);

const { app } = await buildApp({
  dbPath, port, host, adminApiKey, deviceEnrollmentKey, games: config.games,
});
app.log.info({ configPath, found }, found ? "loaded cafequest.config.json" : "no cafequest.config.json; using built-in defaults");
if (config.games.length > 0 && config.games.every((g) => isPlaceholderAppId(g.metaAppId))) {
  app.log.warn("every game still has a placeholder Meta App ID: launches will be rejected until real IDs are configured");
}
app.listen({ port, host }).catch((err) => {
  app.log.error(err, "failed to start");
  process.exit(1);
});
