// One-session live-view coordinator contract: single global allocation,
// direction-aware relay, deterministic timeouts, and idempotent cleanup.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CastCoordinator,
  CAST_APPROVAL_MS,
  CAST_NEGOTIATION_MS,
  CAST_VIEWER_BIND_MS,
  type CastLog,
} from "../src/cast-coordinator.js";

const DEVICE = "2f1c8b7a-6d5e-4c3b-9a10-112233445566";
const OTHER_DEVICE = "3a2b1c0d-9e8f-4a5b-8c7d-667788990011";
const SESSION = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

type FakeTimer = { id: number; ms: number; fn: () => void };

function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, FakeTimer>();
  return {
    scheduler: {
      set(fn: () => void, ms: number): unknown {
        const timer: FakeTimer = { id: nextId++, ms, fn };
        pending.set(timer.id, timer);
        return timer;
      },
      clear(handle: unknown): void {
        if (handle) pending.delete((handle as FakeTimer).id);
      },
    },
    pending: () => [...pending.values()],
    run(timer: FakeTimer) {
      pending.delete(timer.id);
      timer.fn();
    },
  };
}

function fakeAgent() {
  let token: object | null = {};
  let capable = true;
  const sent: { deviceId: string; frame: any }[] = [];
  const port = {
    agentConnection: (deviceId: string) => (deviceId === DEVICE ? token : null),
    supportsScreenCast: (deviceId: string) => deviceId === DEVICE && capable,
    sendCastFrame: (deviceId: string, frame: any) => {
      if (deviceId !== DEVICE || token === null) return false;
      sent.push({ deviceId, frame });
      return true;
    },
  };
  return {
    port,
    sent,
    setConnected(value: boolean) {
      token = value ? {} : null;
    },
    setCapable(value: boolean) {
      capable = value;
    },
    replaceConnection() {
      token = {};
      return token;
    },
    token: () => token,
  };
}

function fakeViewer() {
  return {
    events: [] as string[],
    messages: [] as any[],
    closes: [] as { code: number; reason: string }[],
    send(message: any) {
      this.messages.push(message);
      this.events.push(`send:${message.type}`);
    },
    close(code: number, reason: string) {
      this.closes.push({ code, reason });
      this.events.push(`close:${code}`);
    },
  };
}

function captureLog() {
  const calls: { level: string; obj: unknown; msg: string }[] = [];
  const record =
    (level: string) =>
    (obj: Record<string, unknown>, msg: string) => {
      calls.push({ level, obj, msg });
    };
  const log: CastLog = { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
  return { log, calls };
}

const NOW = 1_700_000_000_000;

function make(overrides: Partial<ConstructorParameters<typeof CastCoordinator>[0]> = {}) {
  const agent = fakeAgent();
  const { log, calls } = captureLog();
  const timers = fakeTimers();
  const coordinator = new CastCoordinator({
    agent: agent.port,
    log,
    now: () => NOW,
    bindTimeoutMs: 10,
    approvalTimeoutMs: 20,
    negotiationTimeoutMs: 30,
    timers: timers.scheduler,
    ...overrides,
  });
  return { coordinator, agent, timers, logCalls: calls };
}

function statusFrame(sessionId: string, status: string, error?: string) {
  return { type: "cast_status", protocolVersion: 1, deviceId: DEVICE, sessionId, status, ...(error ? { error } : {}) } as any;
}

function agentSignal(sessionId: string, signal: any) {
  return { type: "cast_signal", protocolVersion: 1, deviceId: DEVICE, sessionId, signal } as any;
}

function viewerSignal(sessionId: string, signal: any) {
  return { type: "cast_signal", protocolVersion: 1, sessionId, signal } as any;
}

/** Reserve + bind + agent offer installed; leaves the session negotiating. */
function startNegotiating(env: ReturnType<typeof make>, viewer = fakeViewer()) {
  const reserved = env.coordinator.reserve(DEVICE);
  assert.equal(reserved.ok, true);
  if (!reserved.ok) throw new Error("reserve failed");
  const bound = env.coordinator.bindViewer(reserved.sessionId, viewer);
  assert.deepEqual(bound, { ok: true });
  env.coordinator.handleAgentStatus(DEVICE, env.agent.token()!, statusFrame(reserved.sessionId, "negotiating"));
  return { sessionId: reserved.sessionId, viewer };
}

test("default timeouts match the approved bind, approval, and negotiation windows", () => {
  assert.equal(CAST_VIEWER_BIND_MS, 10_000);
  assert.equal(CAST_APPROVAL_MS, 90_000);
  assert.equal(CAST_NEGOTIATION_MS, 20_000);
});

test("reserves only an online capable device and rejects a second global session", () => {
  const env = make();
  env.agent.setConnected(false);
  assert.deepEqual(env.coordinator.reserve(DEVICE), { ok: false, error: "DEVICE_OFFLINE" });
  env.agent.setConnected(true);
  env.agent.setCapable(false);
  assert.deepEqual(env.coordinator.reserve(DEVICE), { ok: false, error: "CAST_UNSUPPORTED" });
  env.agent.setCapable(true);
  const first = env.coordinator.reserve(DEVICE);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.status, "reserved");
    assert.equal(env.coordinator.active?.state, "reserved");
  }
  assert.deepEqual(env.coordinator.reserve(DEVICE), { ok: false, error: "CAST_BUSY" });
  // The slot is global: a second device is refused while any session exists.
  assert.deepEqual(env.coordinator.reserve(OTHER_DEVICE), { ok: false, error: "CAST_BUSY" });
});

test("binding the first viewer sends cast_request and starts the approval timeout", () => {
  const env = make();
  const reserved = env.coordinator.reserve(DEVICE);
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const viewer = fakeViewer();
  assert.deepEqual(env.coordinator.bindViewer(reserved.sessionId, viewer), { ok: true });

  assert.equal(env.agent.sent.length, 1);
  const request = env.agent.sent[0]!.frame;
  assert.equal(request.type, "cast_request");
  assert.equal(request.protocolVersion, 1);
  assert.equal(request.sessionId, reserved.sessionId);
  assert.equal(new Date(request.expiresAt).getTime(), NOW + 20);

  assert.deepEqual(
    env.timers.pending().map((t) => t.ms),
    [20],
  );
  assert.equal(env.coordinator.active?.state, "awaiting_approval");
  assert.equal(viewer.messages.at(-1)?.status, "awaiting_approval");
  // A second bind for the same reservation is refused and does not disturb it.
  assert.deepEqual(env.coordinator.bindViewer(reserved.sessionId, fakeViewer()), {
    ok: false,
    error: "CAST_SESSION_ALREADY_BOUND",
  });
  assert.deepEqual(env.coordinator.bindViewer("00000000-0000-4000-8000-000000000000", fakeViewer()), {
    ok: false,
    error: "CAST_SESSION_NOT_FOUND",
  });
});

test("approval status starts the negotiation timeout and live cancels it", () => {
  const env = make();
  const reserved = env.coordinator.reserve(DEVICE);
  if (!reserved.ok) return;
  const viewer = fakeViewer();
  env.coordinator.bindViewer(reserved.sessionId, viewer);

  // Duplicate acknowledgement is idempotent and keeps the approval window.
  env.coordinator.handleAgentStatus(DEVICE, env.agent.token()!, statusFrame(reserved.sessionId, "awaiting_approval"));
  assert.deepEqual(
    env.timers.pending().map((t) => t.ms),
    [20],
  );

  env.coordinator.handleAgentStatus(DEVICE, env.agent.token()!, statusFrame(reserved.sessionId, "negotiating"));
  assert.equal(env.coordinator.active?.state, "negotiating");
  assert.deepEqual(
    env.timers.pending().map((t) => t.ms),
    [30],
  );
  assert.equal(viewer.messages.at(-1)?.status, "negotiating");

  // Live moves the session out of negotiation and cancels the timer.
  assert.equal(env.coordinator.active?.state, "negotiating");
  env.coordinator.handleAgentStatus(DEVICE, env.agent.token()!, statusFrame(reserved.sessionId, "live"));
  assert.equal(env.coordinator.active?.state, "live");
  assert.deepEqual(env.timers.pending(), []);
  assert.equal(viewer.messages.at(-1)?.status, "live");
});

test("offer and ICE relay only to the bound viewer; answer and ICE relay only to the bound agent", () => {
  const env = make();
  const { sessionId, viewer } = startNegotiating(env);

  env.coordinator.handleAgentSignal(DEVICE, env.agent.token()!, agentSignal(sessionId, { kind: "offer", sdp: "v=0-offer" }));
  assert.equal(viewer.messages.at(-1)?.signal?.sdp, "v=0-offer");
  env.coordinator.handleAgentSignal(DEVICE, env.agent.token()!, agentSignal(sessionId, { kind: "ice", candidate: "candidate:agent" }));
  assert.equal(viewer.messages.at(-1)?.signal?.candidate, "candidate:agent");

  env.coordinator.handleViewerSignal(viewer, viewerSignal(sessionId, { kind: "answer", sdp: "v=0-answer" }));
  const relayed = env.agent.sent.at(-1)!.frame;
  assert.equal(relayed.type, "cast_signal");
  assert.equal(relayed.signal.sdp, "v=0-answer");
  env.coordinator.handleViewerSignal(viewer, viewerSignal(sessionId, { kind: "ice", candidate: "candidate:viewer" }));
  assert.equal(env.agent.sent.at(-1)!.frame.signal.candidate, "candidate:viewer");
  // Nothing but cast_request and cast_signal ever reaches the agent.
  assert.ok(env.agent.sent.every(({ frame }) => frame.type === "cast_request" || frame.type === "cast_signal"));
});

test("foreign and late signals never relay", () => {
  const env = make();
  const { sessionId, viewer } = startNegotiating(env);
  const viewerCount = viewer.messages.length;
  const agentCount = env.agent.sent.length;

  env.coordinator.handleAgentSignal(OTHER_DEVICE, env.agent.token()!, agentSignal(sessionId, { kind: "offer", sdp: "foreign" }));
  env.coordinator.handleAgentSignal(DEVICE, {}, agentSignal(sessionId, { kind: "offer", sdp: "replaced" }));
  env.coordinator.handleAgentSignal(
    DEVICE,
    env.agent.token()!,
    agentSignal("00000000-0000-4000-8000-000000000000", { kind: "offer", sdp: "stale" }),
  );
  env.coordinator.handleViewerSignal(fakeViewer(), viewerSignal(sessionId, { kind: "answer", sdp: "wrong-viewer" }));
  env.coordinator.handleViewerSignal(viewer, viewerSignal("00000000-0000-4000-8000-000000000000", { kind: "answer", sdp: "wrong-session" }));
  env.coordinator.handleViewerSignal(viewer, viewerSignal(sessionId, { kind: "answer", sdp: "late" }));
  assert.equal(env.agent.sent.length, agentCount + 1, "only the correctly addressed answer reaches the agent");

  assert.equal(env.coordinator.active?.state, "negotiating");
  env.coordinator.stop(sessionId, viewer, "viewer_stopped");
  const frozenViewer = viewer.messages.length;
  const frozenAgent = env.agent.sent.length;
  env.coordinator.handleAgentSignal(DEVICE, env.agent.token()!, agentSignal(sessionId, { kind: "offer", sdp: "after-stop" }));
  env.coordinator.handleViewerSignal(viewer, viewerSignal(sessionId, { kind: "answer", sdp: "after-stop" }));
  env.coordinator.handleAgentStatus(DEVICE, env.agent.token()!, statusFrame(sessionId, "live"));
  assert.equal(viewer.messages.length, frozenViewer + 0, "late frames reach nothing");
  assert.equal(env.agent.sent.length, frozenAgent);
  assert.equal(env.coordinator.active, null);
  void viewerCount;
});

test("viewer close, agent disconnect, explicit stop and stopAll clean up once and release the slot", () => {
  const cases: { name: string; act: (env: ReturnType<typeof make>, sessionId: string, viewer: ReturnType<typeof fakeViewer>) => void }[] = [
    {
      name: "viewer close",
      act: (env, sessionId, viewer) => {
        assert.equal(env.coordinator.stop(sessionId, viewer, "viewer_disconnected"), true);
      },
    },
    {
      name: "explicit stop with no viewer",
      act: (env, sessionId) => {
        assert.equal(env.coordinator.stop(sessionId), true);
      },
    },
    {
      name: "agent disconnect",
      act: (env) => env.coordinator.agentDisconnected(DEVICE),
    },
    {
      name: "server shutdown",
      act: (env) => env.coordinator.stopAll(),
    },
  ];
  for (const { name, act } of cases) {
    const env = make();
    const { sessionId, viewer } = startNegotiating(env);
    act(env, sessionId, viewer);
    assert.equal(env.coordinator.active, null, `${name}: slot released`);
    assert.equal(viewer.closes.length, 1, `${name}: viewer closed exactly once`);
    assert.deepEqual(env.timers.pending(), [], `${name}: no timer left`);

    // Repeating cleanup is a no-op and cannot touch the next session.
    assert.equal(env.coordinator.stop(sessionId, viewer), false, `${name}: repeat stop is a no-op`);
    assert.equal(viewer.closes.length, 1, `${name}: viewer still closed once`);
    env.coordinator.agentDisconnected(DEVICE);
    env.coordinator.stopAll();
    assert.equal(viewer.closes.length, 1, `${name}: no double close`);

    const again = env.coordinator.reserve(DEVICE);
    assert.equal(again.ok, true, `${name}: slot reusable`);
  }
});

test("agent replacement terminates rather than migrates the session", () => {
  const env = make();
  const { sessionId, viewer } = startNegotiating(env);
  const oldToken = env.agent.token()!;
  const newToken = env.agent.replaceConnection();
  env.coordinator.agentDisconnected(DEVICE);

  assert.equal(env.coordinator.active, null);
  assert.equal(viewer.closes.length, 1);
  assert.equal(viewer.messages.at(-1)?.status, "failed");
  assert.equal(viewer.messages.at(-1)?.error, "peer_disconnected");

  // The replacement socket cannot steer the dead session or its viewer.
  env.coordinator.handleAgentStatus(DEVICE, newToken, statusFrame(sessionId, "live"));
  env.coordinator.handleAgentSignal(DEVICE, newToken, agentSignal(sessionId, { kind: "offer", sdp: "replacement" }));
  env.coordinator.handleAgentSignal(DEVICE, oldToken, agentSignal(sessionId, { kind: "offer", sdp: "stale" }));
  assert.equal(viewer.closes.length, 1);
  assert.ok(!viewer.messages.some((m) => m.signal?.sdp === "replacement"));

  // A brand-new session on the replacement connection works normally.
  const fresh = env.coordinator.reserve(DEVICE);
  assert.equal(fresh.ok, true);
});

test("bind, approval and negotiation timeouts use their exact failure codes", () => {
  // Bind timeout: nothing reaches the headset and no viewer exists.
  const bindEnv = make();
  const reserved = bindEnv.coordinator.reserve(DEVICE);
  assert.equal(reserved.ok, true);
  const [bindTimer] = bindEnv.timers.pending();
  assert.equal(bindTimer!.ms, 10);
  bindEnv.timers.run(bindTimer!);
  assert.equal(bindEnv.coordinator.active, null);
  assert.equal(bindEnv.agent.sent.length, 0, "no headset request before a viewer bound");

  // Approval timeout.
  const approvalEnv = make();
  const approval = approvalEnv.coordinator.reserve(DEVICE);
  if (!approval.ok) return;
  const approvalViewer = fakeViewer();
  approvalEnv.coordinator.bindViewer(approval.sessionId, approvalViewer);
  const [approvalTimer] = approvalEnv.timers.pending();
  approvalEnv.timers.run(approvalTimer!);
  assert.equal(approvalEnv.coordinator.active, null);
  const stop = approvalEnv.agent.sent.at(-1)!.frame;
  assert.equal(stop.type, "cast_stop");
  assert.equal(stop.reason, "approval_timeout");
  assert.equal(approvalViewer.messages.at(-1)?.status, "failed");
  assert.equal(approvalViewer.messages.at(-1)?.error, "approval_timeout");
  assert.equal(approvalViewer.closes.length, 1);

  // Negotiation timeout.
  const negotiationEnv = make();
  const { sessionId, viewer } = startNegotiating(negotiationEnv);
  const [negotiationTimer] = negotiationEnv.timers.pending();
  assert.equal(negotiationTimer!.ms, 30);
  negotiationEnv.timers.run(negotiationTimer!);
  assert.equal(negotiationEnv.coordinator.active, null);
  assert.equal(negotiationEnv.agent.sent.at(-1)!.frame.reason, "negotiation_timeout");
  assert.equal(viewer.messages.at(-1)?.error, "negotiation_timeout");
  assert.equal(viewer.closes.length, 1);
  void sessionId;
});

test("terminal agent status reaches the viewer before closure", () => {
  const env = make();
  const { sessionId, viewer } = startNegotiating(env);
  env.coordinator.handleAgentStatus(DEVICE, env.agent.token()!, statusFrame(sessionId, "failed", "projection_stopped"));

  assert.equal(env.coordinator.active, null, "a failed session frees the slot");
  const final = viewer.messages.at(-1);
  assert.equal(final.status, "failed");
  assert.equal(final.error, "projection_stopped");
  const sendIndex = viewer.events.lastIndexOf("send:cast_status");
  const closeIndex = viewer.events.lastIndexOf("close:1000");
  assert.ok(sendIndex >= 0 && sendIndex < closeIndex, "status is delivered before the socket closes");
  assert.equal(viewer.closes.length, 1);
  assert.equal(viewer.closes[0]!.code, 1000);

  // A clean headset stop is reported as stopped, not failed.
  const clean = make();
  const started = startNegotiating(clean);
  clean.coordinator.handleAgentStatus(DEVICE, clean.agent.token()!, statusFrame(started.sessionId, "stopped"));
  assert.equal(started.viewer.messages.at(-1)?.status, "stopped");
  assert.equal(clean.coordinator.active, null);
});

test("consent denial fails the session with a bounded code", () => {
  // The agent reports denial while the session is still awaiting approval.
  const awaiting = make();
  const reserved = awaiting.coordinator.reserve(DEVICE);
  if (!reserved.ok) return;
  const awaitingViewer = fakeViewer();
  awaiting.coordinator.bindViewer(reserved.sessionId, awaitingViewer);
  awaiting.coordinator.handleAgentStatus(
    DEVICE,
    awaiting.agent.token()!,
    statusFrame(reserved.sessionId, "failed", "consent_denied"),
  );
  assert.equal(awaitingViewer.messages.at(-1)?.error, "consent_denied");
  assert.equal(awaiting.coordinator.active, null);
});

test("SDP and ICE values are absent from logger calls", () => {
  const env = make();
  const { sessionId, viewer } = startNegotiating(env);
  env.coordinator.handleAgentSignal(DEVICE, env.agent.token()!, agentSignal(sessionId, { kind: "offer", sdp: "SECRET_SDP_OFFER" }));
  env.coordinator.handleAgentSignal(DEVICE, env.agent.token()!, agentSignal(sessionId, { kind: "ice", candidate: "SECRET_ICE_CANDIDATE" }));
  env.coordinator.handleViewerSignal(viewer, viewerSignal(sessionId, { kind: "answer", sdp: "SECRET_SDP_ANSWER" }));
  env.coordinator.stop(sessionId, viewer);

  const logged = JSON.stringify(env.logCalls);
  assert.ok(!logged.includes("SECRET_SDP_OFFER"), "offer SDP must not be logged");
  assert.ok(!logged.includes("SECRET_SDP_ANSWER"), "answer SDP must not be logged");
  assert.ok(!logged.includes("SECRET_ICE_CANDIDATE"), "ICE candidate must not be logged");
  assert.ok(logged.includes(sessionId), "session id itself is safe to log");
});
