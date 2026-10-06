import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { Db } from "./db.js";
import { nowIso, openDb, seedGames } from "./db.js";
import {
  upsertDevice,
  getDevice,
  renameDevice,
  listGames,
  getGame,
  upsertGame,
  createSession,
  extendSession,
  stopSession,
  activeSessionForDevice,
  sweepExpiredSessions,
} from "./store.js";
import { Hub, AGENT_WS_PATH, DASHBOARD_WS_PATH } from "./hub.js";
import { HelloSchema } from "@cafequest/shared";
import { z } from "zod";

export type AppConfig = {
  dbPath: string;
  port: number;
  host: string;
};

export async function buildApp(cfg: AppConfig) {
  const db = openDb(cfg.dbPath);
  seedGames(db);
  const app = Fastify({ logger: { level: "info" } });
  await app.register(websocket);

  const hub = new Hub(app, db, () => {});
  hub.start();

  // --- device websocket -----------------------------------------------------
  app.get(AGENT_WS_PATH, { websocket: true }, (socket: WebSocket, req) => {
    let deviceId: string | null = null;

    socket.on("message", (raw: unknown) => {
      if (typeof raw !== "string" && !Buffer.isBuffer(raw)) return;
      const text = typeof raw === "string" ? raw : (raw as Buffer).toString("utf8");
      // The first valid hello identifies the connection; telemetry follows.
      if (deviceId === null) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          socket.send(JSON.stringify({ type: "error", protocolVersion: 1, code: "MALFORMED_MESSAGE", message: "invalid JSON" }));
          return;
        }
        const probe = (json as any)?.protocolVersion;
        if (probe !== 1) {
          socket.send(JSON.stringify({ type: "error", protocolVersion: 1, code: "UNSUPPORTED_PROTOCOL_VERSION", message: `unsupported protocolVersion ${String(probe)}; server speaks 1` }));
          return;
        }
        const hello = HelloSchema.safeParse(json);
        if (!hello.success) {
          socket.send(JSON.stringify({ type: "error", protocolVersion: 1, code: "MALFORMED_MESSAGE", message: "first message must be a valid hello" }));
          return;
        }
        deviceId = hello.data.deviceId;
        const device = upsertDevice(db, {
          id: hello.data.deviceId,
          name: hello.data.deviceName,
          model: hello.data.deviceModel,
          agentVersion: hello.data.agentVersion,
        });
        app.log.info({ device: device.name, id: device.id }, "device connected");
        hub.addAgentSocket(device.id, socket);
        hub.deliverQueuedCommands(device.id);
        return;
      }
      hub.handleAgentMessage(deviceId, socket, text);
    });

    socket.on("close", () => {
      if (deviceId) hub.removeAgentSocket(deviceId, socket);
    });
    socket.on("error", () => {
      if (deviceId) hub.removeAgentSocket(deviceId, socket);
    });
  });

  // --- dashboard websocket ----------------------------------------------------
  app.get(DASHBOARD_WS_PATH, { websocket: true }, (socket: WebSocket) => {
    hub.addDashboardSocket(socket);
    socket.on("close", () => hub.removeDashboardSocket(socket));
    socket.on("error", () => hub.removeDashboardSocket(socket));
  });

  // --- REST: devices (enriched snapshot shape: online, expectedGame, session) ----
  app.get("/api/devices", async () => {
    const snap = hub.snapshot();
    return { serverTime: snap.serverTime, devices: snap.devices };
  });

  app.post("/api/devices/:deviceId/rename", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = z.object({ name: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid name" });
    const updated = renameDevice(db, deviceId, body.data.name);
    if (!updated) return reply.code(404).send({ error: "device not found" });
    return { device: updated };
  });

  // --- REST: games ------------------------------------------------------------
  app.get("/api/games", async () => ({ games: listGames(db) }));

  app.put("/api/games/:gameId", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = z
      .object({
        name: z.string().min(1).max(64),
        metaAppId: z.string().min(1).max(128),
        enabled: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid game body" });
    const game = upsertGame(db, { id: gameId, ...body.data });
    return { game };
  });

  // --- REST: launch ------------------------------------------------------------
  app.post("/api/devices/:deviceId/launch", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = z.object({ gameId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid launch body" });
    const device = getDevice(db, deviceId);
    if (!device) return reply.code(404).send({ error: "device not found" });
    const game = getGame(db, body.data.gameId);
    if (!game || !game.enabled) return reply.code(400).send({ error: "game not found or disabled" });
    if (!hub.isDeviceConnected(deviceId)) {
      return reply.code(409).send({ error: "headset offline", detail: "device not connected" });
    }
    const commandId = hub.queueLaunch(deviceId, {
      gameId: game.id,
      name: game.name,
      metaAppId: game.metaAppId,
    });
    return reply.code(202).send({ commandId, status: "sent", note: "HTTP 202 is not proof of launch; wait for command_result" });
  });

  // --- REST: sessions -----------------------------------------------------------
  app.post("/api/devices/:deviceId/sessions", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = z.object({ minutes: z.number().int().min(1).max(24 * 60) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid session body" });
    const device = getDevice(db, deviceId);
    if (!device) return reply.code(404).send({ error: "device not found" });
    const existing = activeSessionForDevice(db, deviceId);
    if (existing) return reply.code(409).send({ error: "session already active", session: existing });
    const session = createSession(db, deviceId, body.data.minutes);
    app.log.info({ device: device.name, sessionId: session.id, minutes: body.data.minutes }, "session started");
    return reply.code(201).send({ session });
  });

  app.post("/api/sessions/:sessionId/extend", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = z.object({ minutes: z.number().int().min(1).max(4 * 60) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid extend body" });
    const session = extendSession(db, sessionId, body.data.minutes);
    if (!session) return reply.code(409).send({ error: "no active session to extend" });
    return { session };
  });

  app.post("/api/sessions/:sessionId/stop", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = stopSession(db, sessionId);
    if (!session) return reply.code(409).send({ error: "no active session to stop" });
    return { session };
  });

  app.get("/api/sessions", async () => {
    sweepExpiredSessions(db);
    const rows = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT 200").all();
    return { sessions: rows };
  });

  // --- REST: health ---------------------------------------------------------------
  app.get("/api/health", async () => ({ ok: true, serverTime: nowIso() }));

  app.addHook("onClose", async () => {
    hub.stop();
    db.close();
  });

  return { app, db, hub };
}
