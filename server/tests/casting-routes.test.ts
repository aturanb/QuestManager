// Live-view route contract: admin-key enforcement, single global reservation,
// direction-checked signaling relay, close codes, idempotent cleanup, and the
// guarantee that no key, SDP, ICE, or media ever reaches logs or SQLite.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice } from "../src/store.js";

const ADMIN = "cast-admin-key-456";

function streamLogger() {
  let text = "";
  const stream = { write: (s: string) => { text += s; } };
  return { stream, text: () => text };
}

const logs = streamLogger();
const { app, db, hub } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  adminApiKey: ADMIN,
  logger: { level: "info", stream: logs.stream as any },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
after(() => app.close());

const auth = { authorization: `Bearer ${ADMIN}` };

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(fn: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value as T;
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await wait(25);
  }
}

async function connectAgent(id: string, capabilities?: string[]): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/agent-ws`);
  await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
  ws.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    deviceId: id,
    deviceName: `Quest ${id.slice(0, 4)}`,
    deviceModel: "Quest 3",
    agentVersion: "0.5.0",
    ...(capabilities ? { capabilities } : {}),
  }));
  await wait(150);
  return ws;
}

function collect(ws: WebSocket) {
  const messages: any[] = [];
  ws.on("message", (m) => {
    try { messages.push(JSON.parse(String(m))); } catch { /* binary */ }
  });
  return messages;
}

function closed(ws: WebSocket, ms = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("socket did not close in time")), ms);
    ws.once("close", (code) => { clearTimeout(t); resolve(Number(code)); });
  });
}

async function openViewer(sessionId: string, key: string = ADMIN): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/cast-ws?key=${encodeURIComponent(key)}&sessionId=${sessionId}`);
  await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
  return ws;
}

function postCast(deviceId: string, key: string = ADMIN) {
  return fetch(`${base}/api/casts`, {
    method: "POST",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
}

function deleteCast(sessionId: string, key: string = ADMIN) {
  return fetch(`${base}/api/casts/${sessionId}`, {
    method: "DELETE",
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
}

async function deviceSnapshot(id: string) {
  const res = await fetch(`${base}/api/devices`, { headers: auth });
  const body = (await res.json()) as any;
  return body.devices.find((d: any) => d.id === id);
}

test("device snapshot exposes supportsScreenCast only for a live capable connection", async () => {
  const oldId = randomUUID();
  const oldAgent = await connectAgent(oldId, ["launch_android_package"]);
  assert.equal((await deviceSnapshot(oldId)).supportsScreenCast, false, "older agent stays unsupported");
  assert.equal((await postCast(oldId)).status, 409, "older agent cannot be asked to cast");

  const castId = randomUUID();
  const capable = await connectAgent(castId, ["launch_android_package", "screen_cast_v1"]);
  assert.equal((await deviceSnapshot(castId)).supportsScreenCast, true);

  const reserved = await postCast(castId);
  assert.equal(reserved.status, 201);
  const body = (await reserved.json()) as any;
  assert.equal(body.status, "reserved");
  assert.equal(typeof body.sessionId, "string");
  assert.equal((await deleteCast(body.sessionId)).status, 204);

  capable.close();
  await waitFor(() => !hub.isDeviceConnected(castId));
  assert.equal((await deviceSnapshot(castId)).supportsScreenCast, false, "offline headset is not castable");
  oldAgent.close();
});

test("reservation rejects unknown, offline, and unsupported devices and enforces one global slot", async () => {
  const unknown = await postCast(randomUUID());
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as any).error, "DEVICE_NOT_FOUND");

  const offlineId = randomUUID();
  upsertDevice(db, { id: offlineId, name: "Quest Offline" });
  const offline = await postCast(offlineId);
  assert.equal(offline.status, 409);
  assert.equal(((await offline.json()) as any).error, "DEVICE_OFFLINE");

  const agentId = randomUUID();
  const agent = await connectAgent(agentId, ["screen_cast_v1"]);
  const first = await postCast(agentId);
  assert.equal(first.status, 201);
  const firstBody = (await first.json()) as any;
  const busy = await postCast(agentId);
  assert.equal(busy.status, 409);
  assert.equal(((await busy.json()) as any).error, "CAST_BUSY");
  assert.equal(hub.cast.active?.sessionId, firstBody.sessionId, "failed reservation leaves the active session untouched");

  assert.equal((await deleteCast(firstBody.sessionId)).status, 204);
  const second = await postCast(agentId);
  assert.equal(second.status, 201, "slot is reusable after stop");
  const secondBody = (await second.json()) as any;
  await deleteCast(secondBody.sessionId);
  agent.close();
});

test("cast websocket rejects unauthorized, unknown, and already-bound viewers with exact close codes", async () => {
  const agentId = randomUUID();
  const agent = await connectAgent(agentId, ["screen_cast_v1"]);
  const reserved = await postCast(agentId);
  const { sessionId } = (await reserved.json()) as any;

  const noKey = new WebSocket(`${wsBase}/cast-ws?sessionId=${sessionId}`);
  assert.equal(await closed(noKey), 4401);
  const wrongKey = new WebSocket(`${wsBase}/cast-ws?key=nope&sessionId=${sessionId}`);
  assert.equal(await closed(wrongKey), 4401);

  const unknown = new WebSocket(`${wsBase}/cast-ws?key=${ADMIN}&sessionId=${randomUUID()}`);
  assert.equal(await closed(unknown), 4404);
  const invalidId = new WebSocket(`${wsBase}/cast-ws?key=${ADMIN}&sessionId=not-a-uuid`);
  assert.equal(await closed(invalidId), 4400);

  const first = await openViewer(sessionId);
  const second = new WebSocket(`${wsBase}/cast-ws?key=${ADMIN}&sessionId=${sessionId}`);
  assert.equal(await closed(second), 4409, "only one viewer can bind a reservation");
  assert.equal(first.readyState, WebSocket.OPEN);

  first.close();
  await waitFor(() => hub.cast.active === null);
  agent.close();
});

test("binding the viewer sends one cast_request and relays offer/answer/ICE in both directions", async () => {
  const agentId = randomUUID();
  const agent = await connectAgent(agentId, ["screen_cast_v1"]);
  const agentMessages = collect(agent);
  const reserved = await postCast(agentId);
  const { sessionId } = (await reserved.json()) as any;

  const viewer = await openViewer(sessionId);
  const viewerMessages = collect(viewer);
  const request = await waitFor(() => agentMessages.find((m) => m.type === "cast_request"));
  assert.equal(request.sessionId, sessionId);
  assert.ok(new Date(request.expiresAt).getTime() > Date.now(), "request carries a future approval deadline");
  assert.equal(agentMessages.filter((m) => m.type === "cast_request").length, 1, "exactly one request per session");

  agent.send(JSON.stringify({ type: "cast_status", protocolVersion: 1, deviceId: agentId, sessionId, status: "negotiating" }));
  await waitFor(() => viewerMessages.find((m) => m.type === "cast_status" && m.status === "negotiating"));

  const offerSdp = "v=0\r\nSDP_MARKER_OFFER";
  agent.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, deviceId: agentId, sessionId, signal: { kind: "offer", sdp: offerSdp } }));
  const offer = await waitFor(() => viewerMessages.find((m) => m.type === "cast_signal" && m.signal?.kind === "offer"));
  assert.equal(offer.signal.sdp, offerSdp);

  agent.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, deviceId: agentId, sessionId, signal: { kind: "ice", candidate: "candidate:SERVER_TO_VIEWER" } }));
  await waitFor(() => viewerMessages.find((m) => m.type === "cast_signal" && m.signal?.candidate === "candidate:SERVER_TO_VIEWER"));

  const answerSdp = "v=0\r\nSDP_MARKER_ANSWER";
  viewer.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId, signal: { kind: "answer", sdp: answerSdp } }));
  const answer = await waitFor(() => agentMessages.find((m) => m.type === "cast_signal" && m.signal?.kind === "answer"));
  assert.equal(answer.signal.sdp, answerSdp);
  assert.equal(agentMessages.filter((m) => m.type === "cast_signal" && m.signal?.kind === "answer").length, 1);

  viewer.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId, signal: { kind: "ice", candidate: "candidate:VIEWER_TO_SERVER" } }));
  await waitFor(() => agentMessages.find((m) => m.type === "cast_signal" && m.signal?.candidate === "candidate:VIEWER_TO_SERVER"));

  agent.send(JSON.stringify({ type: "cast_status", protocolVersion: 1, deviceId: agentId, sessionId, status: "live" }));
  await waitFor(() => viewerMessages.find((m) => m.type === "cast_status" && m.status === "live"));
  assert.equal(hub.cast.active?.state, "live");

  // The browser tears down through DELETE; the headset gets cast_stop.
  assert.equal((await deleteCast(sessionId)).status, 204);
  const stop = await waitFor(() => agentMessages.find((m) => m.type === "cast_stop"));
  assert.equal(stop.reason, "viewer_stopped");
  await waitFor(() => hub.cast.active === null);
  agent.close();
});

test("a cast frame from a replaced or foreign deviceId is rejected with DEVICE_MISMATCH and never relayed", async () => {
  const agentId = randomUUID();
  const otherId = randomUUID();
  const agent = await connectAgent(agentId, ["screen_cast_v1"]);
  const other = await connectAgent(otherId, ["screen_cast_v1"]);
  const agentMessages = collect(agent);
  const reserved = await postCast(agentId);
  const { sessionId } = (await reserved.json()) as any;
  const viewer = await openViewer(sessionId);
  const viewerMessages = collect(viewer);
  await waitFor(() => agentMessages.find((m) => m.type === "cast_request"));
  agent.send(JSON.stringify({ type: "cast_status", protocolVersion: 1, deviceId: agentId, sessionId, status: "negotiating" }));
  await waitFor(() => viewerMessages.find((m) => m.type === "cast_status" && m.status === "negotiating"));
  const before = viewerMessages.length;

  agent.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, deviceId: otherId, sessionId, signal: { kind: "offer", sdp: "v=0\r\nFOREIGN" } }));
  const error = await waitFor(() => agentMessages.find((m) => m.type === "error" && m.code === "DEVICE_MISMATCH"));
  assert.ok(error);
  await wait(100);
  assert.equal(viewerMessages.length, before, "foreign signal must not reach the viewer");
  assert.equal(hub.cast.active?.state, "negotiating");
  await deleteCast(sessionId);
  agent.close();
  other.close();
});

test("cast websocket rejects binary, invalid JSON, viewer offers, and oversized frames with 4400", async () => {
  const agentId = randomUUID();
  const agent = await connectAgent(agentId, ["screen_cast_v1"]);

  const cases: { name: string; send: (ws: WebSocket) => void }[] = [
    { name: "binary", send: (ws) => ws.send(Buffer.from([0, 1, 2, 3])) },
    { name: "invalid JSON", send: (ws) => ws.send("this is not json") },
    {
      name: "offer from viewer",
      send: (ws) => ws.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId: "ignored", signal: { kind: "offer", sdp: "v=0" } })),
    },
    { name: "oversized text", send: (ws) => ws.send("x".repeat(70 * 1024 + 1)) },
  ];
  for (const { name, send } of cases) {
    const reserved = await postCast(agentId);
    const { sessionId } = (await reserved.json()) as any;
    const viewer = await openViewer(sessionId);
    const closeCode = closed(viewer);
    send(viewer);
    assert.equal(await closeCode, 4400, `${name}: malformed frame code`);
    await waitFor(() => hub.cast.active === null, 3000);
  }
  agent.close();
});

async function reserveFresh(agentId: string): Promise<string> {
  const res = await postCast(agentId);
  assert.equal(res.status, 201, "expected a fresh reservation");
  return ((await res.json()) as any).sessionId;
}

test("viewer close, DELETE, agent close, and duplicate hello each release the slot", async () => {
  const agentId = randomUUID();
  let agent = await connectAgent(agentId, ["screen_cast_v1"]);

  // viewer close
  let sessionId = await reserveFresh(agentId);
  let viewer = await openViewer(sessionId);
  viewer.close();
  await waitFor(() => hub.cast.active === null);

  // DELETE with no viewer, idempotent and reusable
  sessionId = await reserveFresh(agentId);
  assert.equal((await deleteCast(sessionId)).status, 204);
  await waitFor(() => hub.cast.active === null);
  assert.equal((await deleteCast(sessionId)).status, 204, "repeated delete stays idempotent");
  assert.equal((await deleteCast(randomUUID())).status, 204, "unknown session still answers 204");
  const invalid = await fetch(`${base}/api/casts/not-a-uuid`, { method: "DELETE", headers: auth });
  assert.equal(invalid.status, 400);
  await deleteCast(await reserveFresh(agentId));

  // agent close while bound
  sessionId = await reserveFresh(agentId);
  viewer = await openViewer(sessionId);
  const viewerClosed = closed(viewer);
  agent.close();
  await waitFor(() => hub.cast.active === null);
  assert.equal(await viewerClosed, 1000, "viewer is closed cleanly when the agent disappears");

  // duplicate hello replaces the socket and terminates the bound session
  agent = await connectAgent(agentId, ["screen_cast_v1"]);
  sessionId = await reserveFresh(agentId);
  viewer = await openViewer(sessionId);
  const replacedClosed = closed(viewer);
  const replacement = await connectAgent(agentId, ["screen_cast_v1"]);
  await waitFor(() => hub.cast.active === null);
  assert.equal(await replacedClosed, 1000);
  await deleteCast(await reserveFresh(agentId));
  replacement.close();
});

test("app close stops an active cast and frees the slot", async () => {
  const logs2 = streamLogger();
  const second = await buildApp({
    dbPath: ":memory:",
    port: 0,
    host: "127.0.0.1",
    adminApiKey: ADMIN,
    logger: { level: "info", stream: logs2.stream as any },
  });
  await second.app.listen({ port: 0, host: "127.0.0.1" });
  const saddr = second.app.server.address();
  const sport = typeof saddr === "object" && saddr ? saddr.port : 0;
  const sbase = `ws://127.0.0.1:${sport}`;
  const deviceId = randomUUID();
  const agent = new WebSocket(`${sbase}/agent-ws`);
  await new Promise<void>((r, j) => { agent.on("open", () => r()); agent.on("error", j); });
  agent.send(JSON.stringify({
    type: "hello", protocolVersion: 1, deviceId, deviceName: "Quest Closing", deviceModel: "Quest 3",
    agentVersion: "0.5.0", capabilities: ["screen_cast_v1"],
  }));
  await wait(150);
  const reserved = await fetch(`http://127.0.0.1:${sport}/api/casts`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  assert.equal(reserved.status, 201);
  const { sessionId } = (await reserved.json()) as any;
  const viewer = new WebSocket(`${sbase}/cast-ws?key=${ADMIN}&sessionId=${sessionId}`);
  await new Promise<void>((r, j) => { viewer.on("open", () => r()); viewer.on("error", j); });
  assert.equal(second.hub.cast.active?.state, "awaiting_approval");

  await second.app.close();
  assert.equal(second.hub.cast.active, null, "shutdown releases the global slot");
  await wait(100);
});

test("a live session blocks every other reservation and never relays a media frame", async () => {
  const agentId = randomUUID();
  const agent = await connectAgent(agentId, ["screen_cast_v1"]);
  const agentMessages = collect(agent);
  const sessionId = await reserveFresh(agentId);
  const viewer = await openViewer(sessionId);
  const viewerMessages = collect(viewer);
  await waitFor(() => agentMessages.find((m) => m.type === "cast_request"));

  agent.send(JSON.stringify({ type: "cast_status", protocolVersion: 1, deviceId: agentId, sessionId, status: "negotiating" }));
  await waitFor(() => viewerMessages.find((m) => m.type === "cast_status" && m.status === "negotiating"));
  agent.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, deviceId: agentId, sessionId, signal: { kind: "offer", sdp: "v=0\r\nLIVE_MARKER" } }));
  await waitFor(() => viewerMessages.find((m) => m.type === "cast_signal" && m.signal?.kind === "offer"));
  viewer.send(JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId, signal: { kind: "answer", sdp: "v=0\r\nLIVE_ANSWER" } }));
  await waitFor(() => agentMessages.find((m) => m.type === "cast_signal" && m.signal?.kind === "answer"));
  agent.send(JSON.stringify({ type: "cast_status", protocolVersion: 1, deviceId: agentId, sessionId, status: "live" }));
  await waitFor(() => hub.cast.active?.state === "live");

  // One global slot: the same headset and a second capable headset are both refused.
  const sameDevice = await postCast(agentId);
  assert.equal(sameDevice.status, 409);
  assert.equal(((await sameDevice.json()) as any).error, "CAST_BUSY");
  const otherId = randomUUID();
  const otherAgent = await connectAgent(otherId, ["screen_cast_v1"]);
  const otherDevice = await postCast(otherId);
  assert.equal(otherDevice.status, 409);
  assert.equal(((await otherDevice.json()) as any).error, "CAST_BUSY");
  assert.equal(hub.cast.active?.sessionId, sessionId, "the live session keeps its slot");

  // A binary frame is decoded as text, rejected as malformed, and relayed nowhere:
  // there is no media path into the server at all.
  const beforeViewer = viewerMessages.length;
  const beforeAgent = agentMessages.length;
  agent.send(Buffer.from([0x00, 0xff, 0x01, 0x02, 0x03]));
  const malformed = await waitFor(() => agentMessages.slice(beforeAgent).find((m) => m.type === "error"));
  assert.equal(malformed.code, "MALFORMED_MESSAGE");
  await wait(150);
  assert.equal(viewerMessages.length, beforeViewer, "no media frame reaches the viewer");
  assert.equal(hub.cast.active?.state, "live");
  const rows = db.prepare("select count(*) as n from commands").get() as { n: number };
  assert.equal(rows.n, 0, "casting writes nothing to SQLite");

  // DELETE while live ends it for the headset and frees the slot for a fresh session.
  assert.equal((await deleteCast(sessionId)).status, 204);
  const stop = await waitFor(() => agentMessages.find((m) => m.type === "cast_stop"));
  assert.equal(stop.reason, "viewer_stopped");
  await waitFor(() => hub.cast.active === null);
  const viewerClosed = new Promise<void>((resolve) => {
    if (viewer.readyState === WebSocket.CLOSED) return resolve();
    viewer.once("close", () => resolve());
  });
  await viewerClosed;
  const again = await postCast(otherId);
  assert.equal(again.status, 201, "a new reservation succeeds after stop");
  await deleteCast(((await again.json()) as any).sessionId);
  agent.close();
  otherAgent.close();
});

test("admin key, SDP, and ICE values never reach the server logs", async () => {
  // Every prior test exercised the routes; the captured stream must stay clean.
  const text = logs.text();
  assert.ok(!text.includes(ADMIN), "admin key leaked into logs");
  assert.ok(!text.includes("SDP_MARKER_OFFER"), "offer SDP leaked into logs");
  assert.ok(!text.includes("SDP_MARKER_ANSWER"), "answer SDP leaked into logs");
  assert.ok(!text.includes("candidate:SERVER_TO_VIEWER"), "ICE candidate leaked into logs");
  assert.ok(!text.includes("candidate:VIEWER_TO_SERVER"), "ICE candidate leaked into logs");
  assert.ok(!text.includes("LIVE_MARKER"), "live-session offer SDP leaked into logs");
  assert.ok(!text.includes("LIVE_ANSWER"), "live-session answer SDP leaked into logs");
  assert.ok(!text.includes("FOREIGN"), "foreign signal leaked into logs");
  assert.ok(text.includes("live view reserved") || text.includes("live view ended"), "coordinator still logs lifecycle events");
});
