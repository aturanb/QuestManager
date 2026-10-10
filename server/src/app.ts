import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { Db } from "./db.js";
import { nowIso, openDb, seedGames } from "./db.js";
import {
  upsertDevice,
  rekeyDevice,
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
  getSession,
  extendSession,
  stopSession,
  activeSessionForDevice,
  sweepExpiredSessions,
  getControllerBatteryMonitoringEnabled,
  setControllerBatteryMonitoringEnabled,
} from "./store.js";
import { ControllerBatteryCollector, defaultAdbRunner, type AdbRunner } from "./controller-battery.js";
import { Hub, AGENT_WS_PATH, CAST_WS_PATH, DASHBOARD_WS_PATH } from "./hub.js";
import type { CastViewer } from "./cast-coordinator.js";
import { HelloSchema, ViewerCastSignalSchema } from "@cafequest/shared";
import { z } from "zod";
import { DEFAULT_GAMES, isPlaceholderAppId, seedConfiguredGames, type ConfigGame } from "./config.js";
import { isAdminAuthorized, isDashboardSocketAuthorized, type AuthConfig } from "./auth.js";
import { defaultCatalogPath, loadAppCatalog } from "./catalog.js";
import { CATALOG_SOURCE_URL, catalogFetchedAt, refreshAppCatalog } from "./catalog-refresh.js";
import { manualGameId, resolveInstalledApp } from "./installed-apps.js";
import { serverDisplayName, startDiscoveryResponder } from "./discovery.js";

/** Viewer signaling frames are tiny; anything larger is rejected as malformed. */
const CAST_WS_MAX_FRAME_BYTES = 70 * 1024;
/** Controller batteries change slowly; a faster cadence only adds process churn. */
const CONTROLLER_BATTERY_POLL_MS = 60_000;

export type AppConfig = {
  dbPath: string;
  port: number;
  host: string;
  /** When set, dashboard REST/WS require ADMIN_API_KEY; else open LAN-POC mode. */
  adminApiKey?: string;
  /** Game catalog seed (defaults to built-in placeholders); DB stays authoritative. */
  games?: ConfigGame[];
  /** Local package-name to Meta App ID cache; defaults to server/data/app-catalog.json. */
  appCatalogPath?: string;
  /** Injected in tests so the catalog refresh route never reaches the network. */
  catalogFetch?: typeof fetch;
  /** UDP port answering headset discovery probes (DISCOVERY_PORT from index.ts); unset = off, tests opt in with 0. */
  discoveryPort?: number;
  /** Optional controller-battery collector overrides; tests inject a fake runner. */
  controllerBattery?: {
    adbPath?: string;
    runner?: AdbRunner;
    now?: () => Date;
    pollIntervalMs?: number;
    settleMs?: number;
  };
  logger?: { level?: string; stream?: NodeJS.WritableStream };
};

export async function buildApp(cfg: AppConfig) {
  const db = openDb(cfg.dbPath);
  seedConfiguredGames(db, cfg.games ?? DEFAULT_GAMES);
  const auth: AuthConfig = { adminApiKey: cfg.adminApiKey };
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

  // --- dashboard REST guard (§35): everything except health needs the admin key ---
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url.startsWith("/api/health")) return;
    if (!isAdminAuthorized(auth, req.headers.authorization)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  const hub = new Hub(app, db, () => appCatalog, () => {});
  hub.start();

  // Optional diagnostics: best-effort ADB reads, entirely outside the agent
  // liveness, session, and command paths. Off unless staff turn it on.
  const controllerBatteryCollector = new ControllerBatteryCollector({
    adbPath: cfg.controllerBattery?.adbPath ?? nonBlank(process.env.ADB_PATH) ?? "adb",
    runner: cfg.controllerBattery?.runner ?? defaultAdbRunner,
    targets: () => hub.controllerBatteryTargets(),
    now: cfg.controllerBattery?.now ?? (() => new Date()),
    pollIntervalMs: cfg.controllerBattery?.pollIntervalMs ?? CONTROLLER_BATTERY_POLL_MS,
    ...(cfg.controllerBattery?.settleMs !== undefined ? { settleMs: cfg.controllerBattery.settleMs } : {}),
    onChange: () => hub.pushDashboardState(),
  });
  hub.setControllerBatteryView(controllerBatteryCollector);
  // The flag survives restarts; readings deliberately do not.
  if (getControllerBatteryMonitoringEnabled(db)) {
    await controllerBatteryCollector.setEnabled(true);
    app.log.info("controller battery monitoring restored (enabled)");
  }

  // Headsets in Auto mode find this server by broadcasting a probe (spec 2026-10-09 §2).
  const discovery = cfg.discoveryPort === undefined
    ? null
    : await startDiscoveryResponder({
        port: cfg.discoveryPort,
        host: cfg.host,
        name: serverDisplayName(),
        httpPort: () => {
          const address = app.server.address();
          return typeof address === "object" && address ? address.port : null;
        },
        log: app.log,
      });

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
        if (hello.data.previousDeviceId && rekeyDevice(db, hello.data.previousDeviceId, deviceId)) {
          app.log.info(
            { previousId: hello.data.previousDeviceId, device: deviceId },
            "device record moved to stable identity"
          );
        }
        let device = upsertDevice(db, {
          id: hello.data.deviceId,
          name: hello.data.deviceName,
          model: hello.data.deviceModel,
          agentVersion: hello.data.agentVersion,
        });
        // Only a name typed on the headset renames an existing record; the
        // agent's default name after a reinstall must never beat the server's.
        const typedName = hello.data.deviceNameSetByStaff ? hello.data.deviceName.trim() : "";
        if (typedName && typedName !== device.name) {
          device = renameDevice(db, device.id, typedName) ?? device;
        }
        app.log.info({ device: device.name, id: device.id }, "device connected");
        // A fresh hello proves liveness now: without this, a reconnecting
        // device keeps its old last_seen_at and the offline sweep drops the
        // new socket before the first telemetry arrives.
        touchDevice(db, device.id, {});
        // Captured once at the accepted hello: in memory only, never persisted.
        hub.addAgentSocket(device.id, socket, hello.data.capabilities ?? [], req.socket.remoteAddress);
        return;
      }
      hub.handleAgentMessage(deviceId, socket, text);
    });

    // Reply to the hub's ping: proves the socket is alive even while the
    // agent's telemetry timer is stalled, so it refreshes liveness too.
    socket.on("pong", () => {
      if (deviceId) touchDevice(db, deviceId, {});
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

  // --- live-view websocket: the single viewer bound to a reserved cast --------
  // Signaling only. The server never receives or stores media; one unguessable
  // session id plus the admin key authorizes exactly one viewer.
  app.get(CAST_WS_PATH, { websocket: true }, (socket: WebSocket, req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    if (!isDashboardSocketAuthorized(auth, query.key)) {
      socket.close(4401, "unauthorized");
      return;
    }
    const sessionId = typeof query.sessionId === "string" ? query.sessionId : "";
    if (!z.string().uuid().safeParse(sessionId).success) {
      socket.close(4400, "invalid-session-id");
      return;
    }
    const viewer: CastViewer = {
      send: (message) => {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          /* already closed; the close handler frees the slot */
        }
      },
      close: (code, reason) => {
        try {
          socket.close(code, reason);
        } catch {
          /* already gone */
        }
      },
    };
    const bound = hub.cast.bindViewer(sessionId, viewer);
    if (!bound.ok) {
      socket.close(bound.error === "CAST_SESSION_ALREADY_BOUND" ? 4409 : 4404, bound.error);
      return;
    }
    socket.on("message", (raw: unknown) => {
      if (typeof raw !== "string" && !Buffer.isBuffer(raw)) {
        socket.close(4400, "binary-not-supported");
        return;
      }
      const text = typeof raw === "string" ? raw : (raw as Buffer).toString("utf8");
      if (Buffer.byteLength(text, "utf8") > CAST_WS_MAX_FRAME_BYTES) {
        socket.close(4400, "oversized-frame");
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        socket.close(4400, "malformed-frame");
        return;
      }
      // Only answers and ICE candidates; an offer from a viewer is malformed here.
      const parsed = ViewerCastSignalSchema.safeParse(json);
      if (!parsed.success) {
        socket.close(4400, "invalid-signal");
        return;
      }
      hub.cast.handleViewerSignal(viewer, parsed.data);
    });
    socket.on("close", () => hub.cast.stop(sessionId, viewer, "viewer_disconnected"));
    socket.on("error", () => hub.cast.stop(sessionId, viewer, "viewer_disconnected"));
  });

  // --- REST: settings ----------------------------------------------------------
  // The global controller-battery switch. Turning it on tells each capable agent
  // to enable Horizon OS Wireless Debugging (the person taps Allow on the headset
  // once per boot); turning it off tells them to switch it back off where they
  // enabled it. CafeQuest's own ADB reads start and stop with it.
  app.put("/api/settings/controller-battery-monitoring", async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_setting_body" });
    // Persist the intent first: a failed ADB start must not lose the choice.
    setControllerBatteryMonitoringEnabled(db, body.data.enabled);
    // Agents act on the flag immediately; they do not wait for ADB to be probed.
    hub.broadcastControllerMonitoring(body.data.enabled);
    await controllerBatteryCollector.setEnabled(body.data.enabled);
    app.log.info({ enabled: body.data.enabled }, "controller battery monitoring changed");
    hub.pushDashboardState();
    return { controllerBatteryMonitoring: controllerBatteryCollector.monitoringState() };
  });

  // --- REST: devices (whole snapshot: serverTime, devices, monitoring state) ----
  app.get("/api/devices", async () => hub.snapshot());

  app.post("/api/devices/:deviceId/rename", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = z.object({ name: z.string().trim().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid name" });
    const updated = renameDevice(db, deviceId, body.data.name);
    if (!updated) return reply.code(404).send({ error: "device not found" });
    hub.announceDeviceName(deviceId, updated.name);
    hub.pushDashboardState();
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
    if (!hub.isDeviceConnected(deviceId)) {
      return reply.code(409).send({ error: "headset offline", detail: "device not connected" });
    }
    if (!resolved.metaAppId && !hub.supportsPackageLaunch(deviceId)) {
      return reply.code(409).send({
        error: "agent_update_required",
        detail: "connected agent did not advertise Android package launching",
      });
    }
    const commandId = hub.queueLaunch(deviceId, {
      gameId: `installed:${resolved.packageName}`,
      name: resolved.name,
      ...(resolved.metaAppId
        ? { metaAppId: resolved.metaAppId }
        : { packageName: resolved.packageName }),
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
    // minutes: null starts an unlimited session; leaving minutes out is still invalid.
    const body = z.object({ minutes: z.number().int().min(1).max(24 * 60).nullable() }).safeParse(req.body);
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
    if (getSession(db, sessionId)?.endsAt === null) return reply.code(409).send({ error: "session has no time limit" });
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

  // --- REST: live view sessions ---------------------------------------------------
  // POST reserves the single global slot but does not contact the headset; the
  // agent is asked only once a viewer binds /cast-ws, which removes the race.
  app.post("/api/casts", async (req, reply) => {
    const body = z.object({ deviceId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_cast_body" });
    if (!getDevice(db, body.data.deviceId)) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
    const result = hub.cast.reserve(body.data.deviceId);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.code(201).send({ sessionId: result.sessionId, status: result.status });
  });

  // Idempotent cleanup for any dashboard holding the admin key: an active,
  // terminal, or foreign session all answer 204 so retries never fail.
  app.delete("/api/casts/:sessionId", async (req, reply) => {
    const params = z.object({ sessionId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_session_id" });
    hub.cast.stop(params.data.sessionId);
    return reply.code(204).send();
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
    // Collector first: it disconnects only the endpoints it connected, while the
    // agent sockets are still up for one last cycle to see them.
    await controllerBatteryCollector.stop();
    hub.stop();
    await discovery?.close();
    db.close();
  });

  return { app, db, hub, discovery, controllerBatteryCollector };
}

/** Empty/whitespace env values count as unset. */
function nonBlank(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : undefined;
}
