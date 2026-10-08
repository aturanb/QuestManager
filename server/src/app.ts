import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { Db } from "./db.js";
import { nowIso, openDb, seedGames } from "./db.js";
import {
  upsertDevice,
  touchDevice,
  getDevice,
  renameDevice,
  deleteDevice,
  listGames,
  getGame,
  upsertGame,
  getGameByPackage,
  getDeviceApp,
  createSession,
  extendSession,
  stopSession,
  activeSessionForDevice,
  sweepExpiredSessions,
} from "./store.js";
import { Hub, AGENT_WS_PATH, DASHBOARD_WS_PATH, sendAgentError } from "./hub.js";
import { HelloSchema } from "@cafequest/shared";
import { z } from "zod";
import { DEFAULT_GAMES, isPlaceholderAppId, seedConfiguredGames, type ConfigGame } from "./config.js";
import { isAdminAuthorized, isDashboardSocketAuthorized, isEnrolled, type AuthConfig } from "./auth.js";
import { defaultCatalogPath, loadAppCatalog } from "./catalog.js";
import { CATALOG_SOURCE_URL, catalogFetchedAt, refreshAppCatalog } from "./catalog-refresh.js";
import { manualGameId, resolveInstalledApp } from "./installed-apps.js";

export type AppConfig = {
  dbPath: string;
  port: number;
  host: string;
  /** When set, dashboard REST/WS require ADMIN_API_KEY; else open LAN-POC mode. */
  adminApiKey?: string;
  /** When set, agent hello must carry DEVICE_ENROLLMENT_KEY; else open enrollment. */
  deviceEnrollmentKey?: string;
  /** Game catalog seed (defaults to built-in placeholders); DB stays authoritative. */
  games?: ConfigGame[];
  /** Local package-name to Meta App ID cache; defaults to server/data/app-catalog.json. */
  appCatalogPath?: string;
  /** Injected in tests so the catalog refresh route never reaches the network. */
  catalogFetch?: typeof fetch;
  logger?: { level?: string; stream?: NodeJS.WritableStream };
};

export async function buildApp(cfg: AppConfig) {
  const db = openDb(cfg.dbPath);
  seedConfiguredGames(db, cfg.games ?? DEFAULT_GAMES);
  const auth: AuthConfig = { adminApiKey: cfg.adminApiKey, deviceEnrollmentKey: cfg.deviceEnrollmentKey };
  const appCatalogPath = cfg.appCatalogPath ?? defaultCatalogPath();
  // Reassigned by POST /api/catalog/refresh; route closures read the live binding.
  let appCatalog = loadAppCatalog(appCatalogPath);
  const app = Fastify({
    // Never log request lines: dashboard WS keys travel in the query string.
    disableRequestLogging: true,
    logger: cfg.logger?.stream
      ? { level: cfg.logger.level ?? "info", stream: cfg.logger.stream }
      : { level: cfg.logger?.level ?? "info" },
  });
  await app.register(websocket);
  app.log.info({ appCatalogEntries: appCatalog.size, appCatalogPath }, "local app catalog loaded");
  if (auth.adminApiKey) {
    app.log.info("ADMIN_API_KEY set: dashboard REST/WebSocket require authorization");
  } else {
    app.log.warn("ADMIN_API_KEY not set: dashboard API is open (LAN POC mode)");
  }
  if (!auth.deviceEnrollmentKey) {
    app.log.warn("DEVICE_ENROLLMENT_KEY not set: agent enrollment is open (LAN POC mode)");
  }

  // --- dashboard REST guard (§35): everything except health needs the admin key ---
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url.startsWith("/api/health")) return;
    if (!isAdminAuthorized(auth, req.headers.authorization)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  const hub = new Hub(app, db, () => appCatalog, () => {});
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
        if (!isEnrolled(auth, hello.data.enrollmentKey)) {
          sendAgentError(socket, "ENROLLMENT_REJECTED", "invalid or missing enrollment key");
          socket.close(4401, "enrollment-rejected");
          app.log.warn("agent enrollment rejected");
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
        // A fresh hello proves liveness now: without this, a reconnecting
        // device keeps its old last_seen_at and the offline sweep drops the
        // new socket before the first telemetry arrives.
        touchDevice(db, device.id, {});
        hub.addAgentSocket(device.id, socket);
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
  app.get(DASHBOARD_WS_PATH, { websocket: true }, (socket: WebSocket, req) => {
    const key = (req.query as Record<string, unknown> | undefined)?.key;
    if (!isDashboardSocketAuthorized(auth, key)) {
      socket.close(4401, "unauthorized");
      return;
    }
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

  // Clears a stale headset off the board, with its sessions, commands and app
  // inventory. A connected headset is refused: its socket would stay registered
  // with no device row behind it until it reconnected and enrolled again.
  app.delete("/api/devices/:deviceId", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const device = getDevice(db, deviceId);
    if (!device) return reply.code(404).send({ error: "device_not_found" });
    if (hub.isDeviceConnected(deviceId)) {
      return reply.code(409).send({
        error: "headset_online",
        detail: "this headset is connected; remove it once it shows offline",
      });
    }
    deleteDevice(db, deviceId);
    app.log.info({ device: device.name, id: deviceId }, "device removed");
    hub.pushDashboardState();
    return { deleted: deviceId };
  });

  // --- REST: games ------------------------------------------------------------
  app.get("/api/games", async () => ({ games: listGames(db) }));

  app.put("/api/games/:gameId", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = z
      .object({
        name: z.string().min(1).max(64),
        metaAppId: z.string().min(1).max(128),
        packageName: z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/).max(255).nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid game body" });
    if (body.data.packageName) {
      const existing = getGameByPackage(db, body.data.packageName);
      if (existing && existing.id !== gameId) {
        return reply.code(409).send({ error: "package_already_mapped" });
      }
    }
    const game = upsertGame(db, { id: gameId, ...body.data });
    return { game };
  });

  const packageNameSchema = z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/).max(255);

  // Manual correction for a package the community catalog did not identify.
  app.put("/api/devices/:deviceId/apps/:packageName", async (req, reply) => {
    const params = z.object({ deviceId: z.string().uuid(), packageName: packageNameSchema }).safeParse(req.params);
    const body = z.object({ name: z.string().min(1).max(128), metaAppId: z.string().regex(/^\d{5,32}$/) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_app_mapping" });
    if (!getDevice(db, params.data.deviceId)) return reply.code(404).send({ error: "device_not_found" });
    const installed = getDeviceApp(db, params.data.deviceId, params.data.packageName);
    if (!installed) return reply.code(400).send({ error: "app_not_installed" });
    const existing = getGameByPackage(db, params.data.packageName);
    upsertGame(db, {
      id: existing?.id ?? manualGameId(params.data.packageName),
      name: body.data.name,
      metaAppId: body.data.metaAppId,
      packageName: params.data.packageName,
      enabled: true,
    });
    hub.pushDashboardState();
    return { app: resolveInstalledApp(db, appCatalog, installed) };
  });

  app.post("/api/devices/:deviceId/launch-installed", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = z.object({ packageName: packageNameSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_launch_body" });
    if (!getDevice(db, deviceId)) return reply.code(404).send({ error: "device_not_found" });
    const installed = getDeviceApp(db, deviceId, body.data.packageName);
    if (!installed) return reply.code(400).send({ error: "app_not_installed" });
    const resolved = resolveInstalledApp(db, appCatalog, installed);
    if (!resolved.metaAppId) return reply.code(400).send({ error: "meta_app_id_unknown" });
    if (!hub.isDeviceConnected(deviceId)) {
      return reply.code(409).send({ error: "headset offline", detail: "device not connected" });
    }
    const commandId = hub.queueLaunch(deviceId, {
      gameId: `installed:${resolved.packageName}`,
      name: resolved.name,
      metaAppId: resolved.metaAppId,
    });
    if (!commandId) return reply.code(409).send({ error: "headset offline" });
    return reply.code(202).send({ commandId, status: "sent" });
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
    if (game.packageName && !getDeviceApp(db, deviceId, game.packageName)) {
      return reply.code(400).send({ error: "app_not_installed" });
    }
    if (isPlaceholderAppId(game.metaAppId)) {
      return reply.code(400).send({
        error: "game_meta_app_id_not_configured",
        detail: `game "${game.name}" still has a placeholder Meta App ID; set a real one in cafequest.config.json or via PUT /api/games/${game.id}`,
      });
    }
    if (!hub.isDeviceConnected(deviceId)) {
      return reply.code(409).send({ error: "headset offline", detail: "device not connected" });
    }
    const commandId = hub.queueLaunch(deviceId, {
      gameId: game.id,
      name: game.name,
      metaAppId: game.metaAppId,
    });
    if (!commandId) {
      return reply.code(409).send({ error: "headset offline", detail: "device disconnected before send" });
    }
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
  // --- REST: community app catalog ---------------------------------------------
  // The one route that reaches the network. A refresh never leaves staff worse
  // off: on any failure the cache file and the loaded mappings stay as they were.
  let refreshInFlight: Promise<{ entries: number; fetchedAt: string }> | null = null;

  app.get("/api/catalog", async () => ({
    entries: appCatalog.size,
    fetchedAt: catalogFetchedAt(appCatalogPath),
    source: CATALOG_SOURCE_URL,
  }));

  app.post("/api/catalog/refresh", async (_req, reply) => {
    // A double-clicked button must not start a second download.
    // Captured locally: `refreshInFlight` is cleared on settle, so re-reading the
    // field after the await could hand a second caller null.
    const pending = (refreshInFlight ??= refreshAppCatalog({
      path: appCatalogPath,
      fetchImpl: cfg.catalogFetch,
    })
      .then((result) => {
        appCatalog = loadAppCatalog(appCatalogPath);
        app.log.info({ entries: result.entries }, "app catalog refreshed");
        return result;
      })
      .finally(() => {
        refreshInFlight = null;
      }));
    try {
      const result = await pending;
      hub.pushDashboardState();
      return { entries: result.entries, fetchedAt: result.fetchedAt, source: CATALOG_SOURCE_URL };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown catalog refresh failure";
      app.log.error({ err: error }, "app catalog refresh failed");
      return reply.code(502).send({ error: "catalog_refresh_failed", detail });
    }
  });

  app.get("/api/health", async () => ({ ok: true, serverTime: nowIso() }));

  app.addHook("onClose", async () => {
    hub.stop();
    db.close();
  });

  return { app, db, hub };
}
