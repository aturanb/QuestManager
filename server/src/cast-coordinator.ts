import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type AgentCastSignal,
  type AgentCastStatus,
  type CastFailureCode,
  type CastFrameToViewer,
  type CastSessionStatus,
  type CastStopReason,
  type ServerCastMessage,
  type ViewerCastSignal,
} from "@cafequest/shared";

/** A browser must bind the reservation within this window or it is cancelled. */
export const CAST_VIEWER_BIND_MS = 10_000;
/** The headset owner has this long to approve Quest's capture dialog. */
export const CAST_APPROVAL_MS = 90_000;
/** WebRTC negotiation must reach `live` within this window after approval. */
export const CAST_NEGOTIATION_MS = 20_000;

/** Minimal logger surface; Fastify's logger satisfies it. Never logs signaling payloads. */
export type CastLog = {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

/**
 * Everything the coordinator needs from the live agent side. The connection
 * token is compared by object identity so a replaced socket can never inherit
 * or steer a session.
 */
export type CastAgentPort = {
  /** Identity of the live agent connection, or null when the device is offline. */
  agentConnection(deviceId: string): object | null;
  supportsScreenCast(deviceId: string): boolean;
  /** Returns false when the frame could not be handed to a live socket. */
  sendCastFrame(deviceId: string, frame: ServerCastMessage): boolean;
};

/** The single browser viewer socket; compared by object identity. */
export type CastViewer = {
  send(message: CastFrameToViewer): void;
  close(code: number, reason: string): void;
};

export type ReserveResult =
  | { ok: true; sessionId: string; status: "reserved" }
  | { ok: false; error: "DEVICE_OFFLINE" | "CAST_UNSUPPORTED" | "CAST_BUSY" };

export type BindResult =
  | { ok: true }
  | { ok: false; error: "CAST_SESSION_NOT_FOUND" | "CAST_SESSION_ALREADY_BOUND" | "DEVICE_OFFLINE" };

/** Timer injection keeps timeout tests deterministic without real clocks. */
export type CastTimerScheduler = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type CastCoordinatorOptions = {
  agent: CastAgentPort;
  log: CastLog;
  now?: () => number;
  randomUUID?: () => string;
  bindTimeoutMs?: number;
  approvalTimeoutMs?: number;
  negotiationTimeoutMs?: number;
  timers?: CastTimerScheduler;
};

type SessionState = "reserved" | "awaiting_approval" | "negotiating" | "live";

type ActiveCast = {
  sessionId: string;
  deviceId: string;
  state: SessionState;
  agentToken: object;
  viewer: CastViewer | null;
  expiresAt: number;
  bindTimer: unknown | null;
  approvalTimer: unknown | null;
  negotiationTimer: unknown | null;
};

export type ActiveCastInfo = { sessionId: string; deviceId: string; state: SessionState };

type TerminateOptions = {
  reason: CastStopReason;
  failure?: CastFailureCode;
  viewerStatus?: CastSessionStatus;
  sendStop?: boolean;
};

const defaultTimers: CastTimerScheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * Owns independent in-memory live-view sessions, at most one per headset.
 * Each relays bounded status and WebRTC signaling between its agent and viewer.
 * SDP, ICE, and media are never stored. Terminal cleanup releases only that
 * session's device slot and is idempotent.
 */
export class CastCoordinator {
  private readonly casts = new Map<string, ActiveCast>();
  private readonly deviceSessions = new Map<string, string>();
  private readonly agent: CastAgentPort;
  private readonly log: CastLog;
  private readonly now: () => number;
  private readonly newSessionId: () => string;
  private readonly bindTimeoutMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly negotiationTimeoutMs: number;
  private readonly timers: CastTimerScheduler;

  constructor(options: CastCoordinatorOptions) {
    this.agent = options.agent;
    this.log = options.log;
    this.now = options.now ?? (() => Date.now());
    this.newSessionId = options.randomUUID ?? (() => randomUUID());
    this.bindTimeoutMs = options.bindTimeoutMs ?? CAST_VIEWER_BIND_MS;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? CAST_APPROVAL_MS;
    this.negotiationTimeoutMs = options.negotiationTimeoutMs ?? CAST_NEGOTIATION_MS;
    this.timers = options.timers ?? defaultTimers;
  }

  /** Read-only view used by tests and diagnostics; never contains signaling data. */
  get active(): ActiveCastInfo[] {
    return [...this.casts.values()].map(({ sessionId, deviceId, state }) => ({ sessionId, deviceId, state }));
  }

  reserve(deviceId: string): ReserveResult {
    if (this.deviceSessions.has(deviceId)) return { ok: false, error: "CAST_BUSY" };
    const token = this.agent.agentConnection(deviceId);
    if (!token) return { ok: false, error: "DEVICE_OFFLINE" };
    if (!this.agent.supportsScreenCast(deviceId)) return { ok: false, error: "CAST_UNSUPPORTED" };
    const sessionId = this.newSessionId();
    const cast: ActiveCast = {
      sessionId,
      deviceId,
      state: "reserved",
      agentToken: token,
      viewer: null,
      expiresAt: 0,
      bindTimer: null,
      approvalTimer: null,
      negotiationTimer: null,
    };
    this.casts.set(sessionId, cast);
    this.deviceSessions.set(deviceId, sessionId);
    cast.bindTimer = this.timers.set(() => this.expireBind(sessionId), this.bindTimeoutMs);
    this.log.info({ device: deviceId, sessionId, state: cast.state }, "live view reserved");
    return { ok: true, sessionId, status: "reserved" };
  }

  /**
   * Binds the first browser socket presenting the reservation. Only now is the
   * headset asked, which removes the race where a fast approval produced an
   * offer before a viewer existed.
   */
  bindViewer(sessionId: string, viewer: CastViewer): BindResult {
    const cast = this.casts.get(sessionId);
    if (!cast) return { ok: false, error: "CAST_SESSION_NOT_FOUND" };
    if (cast.state !== "reserved" || cast.viewer) return { ok: false, error: "CAST_SESSION_ALREADY_BOUND" };
    const token = this.agent.agentConnection(cast.deviceId);
    if (!token || token !== cast.agentToken) {
      this.terminate(cast, { reason: "agent_disconnected", failure: "peer_disconnected" });
      return { ok: false, error: "DEVICE_OFFLINE" };
    }
    cast.viewer = viewer;
    cast.state = "awaiting_approval";
    cast.expiresAt = this.now() + this.approvalTimeoutMs;
    this.clearTimer(cast.bindTimer);
    cast.bindTimer = null;
    const sent = this.agent.sendCastFrame(cast.deviceId, {
      type: "cast_request",
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      expiresAt: new Date(cast.expiresAt).toISOString(),
    });
    if (!sent) {
      this.terminate(cast, { reason: "agent_disconnected", failure: "peer_disconnected" });
      return { ok: false, error: "DEVICE_OFFLINE" };
    }
    this.sendToViewer(cast, {
      type: "cast_status",
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      status: "awaiting_approval",
    });
    cast.approvalTimer = this.timers.set(() => this.expireApproval(sessionId), this.approvalTimeoutMs);
    this.log.info({ device: cast.deviceId, sessionId, state: cast.state }, "live view awaiting approval");
    return { ok: true };
  }

  /** Agent-reported cast status. Out-of-order and late frames are ignored. */
  handleAgentStatus(deviceId: string, connection: object, message: AgentCastStatus): void {
    const cast = this.currentCast(deviceId, connection, message.sessionId);
    if (!cast) return;
    if (message.status === "failed") {
      const failure = message.error ?? "internal_error";
      this.terminate(cast, {
        reason: "failed",
        failure,
        viewerStatus: "failed",
      });
      return;
    }
    if (message.status === "stopped") {
      this.terminate(cast, { reason: "viewer_stopped", viewerStatus: "stopped" });
      return;
    }
    if (cast.state === "reserved") {
      this.log.debug({ device: deviceId, sessionId: cast.sessionId }, "ignored cast status before viewer bind");
      return;
    }
    if (message.status === "awaiting_approval") {
      // Duplicate of a state the viewer already knows; nothing changed.
      return;
    }
    if (message.status === "negotiating") {
      if (cast.state !== "awaiting_approval") {
        this.log.debug({ device: deviceId, sessionId: cast.sessionId, state: cast.state }, "ignored out-of-order cast status");
        return;
      }
      this.clearTimer(cast.approvalTimer);
      cast.approvalTimer = null;
      cast.state = "negotiating";
      cast.negotiationTimer = this.timers.set(() => this.expireNegotiation(cast.sessionId), this.negotiationTimeoutMs);
      this.sendToViewer(cast, {
        type: "cast_status",
        protocolVersion: PROTOCOL_VERSION,
        sessionId: cast.sessionId,
        status: "negotiating",
      });
      this.log.info({ device: deviceId, sessionId: cast.sessionId, state: cast.state }, "live view negotiating");
      return;
    }
    if (message.status === "live") {
      if (cast.state !== "negotiating") {
        this.log.debug({ device: deviceId, sessionId: cast.sessionId, state: cast.state }, "ignored out-of-order cast status");
        return;
      }
      this.clearTimer(cast.negotiationTimer);
      cast.negotiationTimer = null;
      cast.state = "live";
      this.sendToViewer(cast, {
        type: "cast_status",
        protocolVersion: PROTOCOL_VERSION,
        sessionId: cast.sessionId,
        status: "live",
      });
      this.log.info({ device: deviceId, sessionId: cast.sessionId, state: cast.state }, "live view started");
    }
  }

  /** Agent offer/ICE → bound viewer only. */
  handleAgentSignal(deviceId: string, connection: object, message: AgentCastSignal): void {
    const cast = this.currentCast(deviceId, connection, message.sessionId);
    if (!cast) return;
    if (cast.state !== "negotiating" && cast.state !== "live") {
      this.log.debug({ device: deviceId, sessionId: cast.sessionId, state: cast.state }, "ignored agent signal outside negotiation");
      return;
    }
    this.sendToViewer(cast, {
      type: "cast_signal",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: cast.sessionId,
      signal: message.signal,
    });
  }

  /** Viewer answer/ICE → bound agent only. */
  handleViewerSignal(viewer: CastViewer, message: ViewerCastSignal): void {
    const cast = this.casts.get(message.sessionId);
    if (!cast || cast.viewer !== viewer) {
      this.log.debug({ sessionId: message.sessionId }, "ignored foreign or late viewer signal");
      return;
    }
    if (cast.state !== "negotiating" && cast.state !== "live") {
      this.log.debug({ sessionId: cast.sessionId, state: cast.state }, "ignored viewer signal outside negotiation");
      return;
    }
    const sent = this.agent.sendCastFrame(cast.deviceId, {
      type: "cast_signal",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: cast.sessionId,
      signal: message.signal,
    });
    if (!sent) {
      this.terminate(cast, { reason: "agent_disconnected", failure: "peer_disconnected", viewerStatus: "failed" });
    }
  }

  /**
   * Explicit stop from DELETE (no viewer) or the viewer socket close. The
   * closing viewer must match the bound one; any other socket cannot stop it.
   */
  stop(sessionId: string, viewer?: CastViewer, reason: CastStopReason = "viewer_stopped"): boolean {
    const cast = this.casts.get(sessionId);
    if (!cast) return false;
    if (viewer && cast.viewer !== viewer) return false;
    this.terminate(cast, { reason, sendStop: true, viewerStatus: "stopped" });
    return true;
  }

  /** Agent socket closed or was replaced: the session must never migrate. */
  agentDisconnected(deviceId: string): void {
    const sessionId = this.deviceSessions.get(deviceId);
    const cast = sessionId ? this.casts.get(sessionId) : undefined;
    if (!cast) return;
    this.terminate(cast, { reason: "agent_disconnected", failure: "peer_disconnected", viewerStatus: "failed" });
  }

  /** Server shutdown: stop the agent capture first, then release the viewer. */
  stopAll(): void {
    for (const cast of [...this.casts.values()]) {
      this.terminate(cast, { reason: "server_stopping", sendStop: true, viewerStatus: "stopped" });
    }
  }

  private currentCast(deviceId: string, connection: object, sessionId: string): ActiveCast | null {
    const cast = this.casts.get(sessionId);
    if (!cast) return null;
    if (cast.deviceId !== deviceId || cast.agentToken !== connection) {
      this.log.debug({ device: deviceId, sessionId }, "ignored foreign or late cast frame");
      return null;
    }
    return cast;
  }

  private expireBind(sessionId: string): void {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.state !== "reserved") return;
    // The headset was never contacted; there is nothing to stop.
    this.terminate(cast, { reason: "viewer_disconnected" });
    this.log.info({ device: cast.deviceId, sessionId }, "live view reservation expired without a viewer");
  }

  private expireApproval(sessionId: string): void {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.state !== "awaiting_approval") return;
    this.terminate(cast, {
      reason: "approval_timeout",
      failure: "approval_timeout",
      viewerStatus: "failed",
      sendStop: true,
    });
  }

  private expireNegotiation(sessionId: string): void {
    const cast = this.casts.get(sessionId);
    if (!cast || cast.state !== "negotiating") return;
    this.terminate(cast, {
      reason: "negotiation_timeout",
      failure: "negotiation_timeout",
      viewerStatus: "failed",
      sendStop: true,
    });
  }

  /**
   * One idempotent terminal path. The active reference is cleared before any
   * callback so re-entrant cleanup always observes a free slot, and repeated
   * calls are no-ops.
   */
  private terminate(cast: ActiveCast, options: TerminateOptions): void {
    if (this.casts.get(cast.sessionId) !== cast) return;
    this.casts.delete(cast.sessionId);
    this.deviceSessions.delete(cast.deviceId);
    this.clearTimer(cast.bindTimer);
    this.clearTimer(cast.approvalTimer);
    this.clearTimer(cast.negotiationTimer);
    cast.bindTimer = null;
    cast.approvalTimer = null;
    cast.negotiationTimer = null;
    if (options.sendStop) {
      const token = this.agent.agentConnection(cast.deviceId);
      if (token && token === cast.agentToken) {
        this.agent.sendCastFrame(cast.deviceId, {
          type: "cast_stop",
          protocolVersion: PROTOCOL_VERSION,
          sessionId: cast.sessionId,
          reason: options.reason,
        });
      }
    }
    const viewer = cast.viewer;
    if (viewer) {
      if (options.viewerStatus) {
        this.sendToViewer(cast, {
          type: "cast_status",
          protocolVersion: PROTOCOL_VERSION,
          sessionId: cast.sessionId,
          status: options.viewerStatus,
          ...(options.failure ? { error: options.failure } : {}),
        });
      }
      try {
        viewer.close(1000, "cast-ended");
      } catch {
        /* already gone */
      }
    }
    this.log.info(
      { device: cast.deviceId, sessionId: cast.sessionId, reason: options.reason, failure: options.failure ?? null },
      "live view ended",
    );
  }

  private sendToViewer(cast: ActiveCast, message: CastFrameToViewer): void {
    const viewer = cast.viewer;
    if (!viewer) return;
    try {
      viewer.send(message);
    } catch {
      /* the socket close handler frees the slot */
    }
  }

  private clearTimer(handle: unknown | null): void {
    if (handle === null) return;
    this.timers.clear(handle);
  }
}
