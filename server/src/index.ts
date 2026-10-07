import { buildApp } from "./app.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const portEnv = Number(process.env.PORT);
// Fall back to 3000 when PORT is unset or unusable (e.g. PORT=0/empty leaks
// into some shells); tests pick an ephemeral port via buildApp options.
const port = Number.isInteger(portEnv) && portEnv > 0 ? portEnv : 3000;
const host = process.env.HOST ?? "0.0.0.0";
// Default data dir is relative to the server package root (not cwd): npm runs
// workspace scripts with cwd=server/, which would otherwise nest server/server/.
const dbPath = process.env.DB_PATH
  ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../data/cafequest.db");

const { app } = await buildApp({ dbPath, port, host });
app.listen({ port, host }).catch((err) => {
  app.log.error(err, "failed to start");
  process.exit(1);
});
