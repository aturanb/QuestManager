// Auth contract (P0-A/C, brief §35): ADMIN_API_KEY guards dashboard REST+WS,
// DEVICE_ENROLLMENT_KEY guards agent enrollment, and secrets never hit logs.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";

const ADMIN = "test-admin-key-123";
const ENROLL = "test-enroll-key-456";

function streamLogger() {
  let text = "";
  const stream = { write: (s: string) => { text += s; } };
  return { stream, text: () => text };
}

// --- locked-down server -------------------------------------------------------
const logs = streamLogger();
const locked = await buildApp({
  dbPath: ":memory:", port: 0, host: "127.0.0.1",
  adminApiKey: ADMIN, deviceEnrollmentKey: ENROLL, logger: { level: "info", stream: logs.stream as any },
});
await locked.app.listen({ port: 0, host: "127.0.0.1" });
const laddr = locked.app.server.address();
const lport = typeof laddr === "object" && laddr ? laddr.port : 0;
const lbase = `http://127.0.0.1:${lport}`;
const lws = `ws://127.0.0.1:${lport}`;
after(() => locked.app.close());

const auth = { authorization: `Bearer ${ADMIN}` };

test("REST without/wrong admin key is 401; health stays open", async () => {
  const cases: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }];
  for (const headers of cases) {
    const r = await fetch(`${lbase}/api/devices`, { headers });
    assert.equal(r.status, 401);
    assert.equal((await r.json() as any).error, "unauthorized");
  }
  const ok = await fetch(`${lbase}/api/devices`, { headers: auth });
  assert.equal(ok.status, 200);
  const health = await fetch(`${lbase}/api/health`);
  assert.equal(health.status, 200);
});

test("dashboard WS without key is refused; with key connects and gets state", async () => {
  const bad = new WebSocket(`${lws}/dashboard-ws`);
  const badClose = new Promise<number>((r) => bad.on("close", (c) => r(Number(c))));
  assert.equal(await badClose, 4401);
  const good = new WebSocket(`${lws}/dashboard-ws?key=${ADMIN}`);
  const state: any = await new Promise((r, j) => {
    good.on("message", (m) => r(JSON.parse(String(m))));
    good.on("error", j);
  });
  assert.equal(state.type, "state");
  assert.ok(Array.isArray(state.payload.devices));
  good.close();
});

test("agent hello without/with enrollment key", async () => {
  const id = randomUUID();
  const noKey = new WebSocket(`${lws}/agent-ws`);
  await new Promise<void>((r) => noKey.on("open", () => r()));
  noKey.send(JSON.stringify({ type: "hello", protocolVersion: 1, deviceId: id, deviceName: "Q", deviceModel: "M", agentVersion: "1" }));
  const err: any = await new Promise((r) => noKey.on("message", (m) => r(JSON.parse(String(m)))));
  assert.equal(err.code, "ENROLLMENT_REJECTED");
  await new Promise((r) => noKey.on("close", () => r(null)));
  const yesKey = new WebSocket(`${lws}/agent-ws`);
  await new Promise<void>((r) => yesKey.on("open", () => r()));
  yesKey.send(JSON.stringify({ type: "hello", protocolVersion: 1, deviceId: id, deviceName: "Q", deviceModel: "M", agentVersion: "1", enrollmentKey: ENROLL }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(yesKey.readyState, WebSocket.OPEN);
  const dev = await (await fetch(`${lbase}/api/devices`, { headers: auth })).json() as any;
  assert.ok(dev.devices.some((d: any) => d.id === id));
  yesKey.close();
});

test("secrets never appear in server logs", async () => {
  // exercise authed REST + both websockets, then grep the captured log stream
  await fetch(`${lbase}/api/devices`, { headers: auth });
  const ws = new WebSocket(`${lws}/dashboard-ws?key=${ADMIN}`);
  await new Promise((r) => ws.on("message", () => r(null)));
  ws.close();
  const text = logs.text();
  assert.ok(!text.includes(ADMIN), "admin key leaked into logs");
  assert.ok(!text.includes(ENROLL), "enrollment key leaked into logs");
});

// --- open (unconfigured) server ----------------------------------------------
const open = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1" });
await open.app.listen({ port: 0, host: "127.0.0.1" });
const oaddr = open.app.server.address();
const oport = typeof oaddr === "object" && oaddr ? oaddr.port : 0;
after(() => open.app.close());

test("unconfigured keys leave the LAN-POC server open (documented, warned)", async () => {
  const r = await fetch(`http://127.0.0.1:${oport}/api/devices`);
  assert.equal(r.status, 200);
});
