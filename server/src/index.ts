import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const dbPath = process.env.DB_PATH ?? "server/data/cafequest.db";

const { app } = await buildApp({ dbPath, port, host });
app.listen({ port, host }).catch((err) => {
  app.log.error(err, "failed to start");
  process.exit(1);
});
