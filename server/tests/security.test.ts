// Auth contract (P0-A/C, brief §35): ADMIN_API_KEY guards dashboard REST+WS and
// never hits logs. Agents need no key: the enrollment key was removed on
// 2026-10-09 (LAN-only café, docs/decisions.md "No enrollment key").
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";

const ADMIN = "test-admin-key-123";

function streamLogger() {
  let text = "";
  const stream = { write: (s: string) => { text += s; } };
  return { stream, text: () => text };
}

// --- locked-down server -------------------------------------------------------
const logs = streamLogger();
const locked = await buildApp({
  dbPath: ":memory:", port: 0, host: "127.0.0.1",
  adminApiKey: ADMIN, logger: { level: "info", stream: logs.stream as any },
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

test("agents need no key; a leftover enrollmentKey from a 0.2.0 APK is ignored", async () => {
  for (const extra of [{}, { enrollmentKey: "left-over-from-0.2.0" }]) {
    const id = randomUUID();
    const agent = new WebSocket(`${lws}/agent-ws`);
    await new Promise<void>((r) => agent.on("open", () => r()));
    agent.send(JSON.stringify({ type: "hello", protocolVersion: 1, deviceId: id, deviceName: "Q", deviceModel: "M", agentVersion: "1", ...extra }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(agent.readyState, WebSocket.OPEN, JSON.stringify(extra));
    const dev = await (await fetch(`${lbase}/api/devices`, { headers: auth })).json() as any;
    assert.ok(dev.devices.some((d: any) => d.id === id), JSON.stringify(extra));
    agent.close();
  }
});

test("the server no longer mentions an enrollment key at boot", () => {
  assert.ok(!logs.text().includes("DEVICE_ENROLLMENT_KEY"), "boot log still mentions DEVICE_ENROLLMENT_KEY");
});

test("cast REST and the cast websocket require the admin key", async () => {
  const denied = await fetch(`${lbase}/api/casts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: randomUUID() }),
  });
  assert.equal(denied.status, 401);
  const withKey = await fetch(`${lbase}/api/casts`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ deviceId: randomUUID() }),
  });
  assert.equal(withKey.status, 404, "authorized but unknown device");

  const closeCode = (ws: WebSocket) => new Promise<number>((r) => ws.on("close", (c) => r(Number(c))));
  const noKey = new WebSocket(`${lws}/cast-ws?sessionId=${randomUUID()}`);
  assert.equal(await closeCode(noKey), 4401);
  const wrongKey = new WebSocket(`${lws}/cast-ws?key=wrong&sessionId=${randomUUID()}`);
  assert.equal(await closeCode(wrongKey), 4401);
  const goodKey = new WebSocket(`${lws}/cast-ws?key=${ADMIN}&sessionId=${randomUUID()}`);
  assert.equal(await closeCode(goodKey), 4404, "authorized but no such reservation");
});

test("secrets never appear in server logs", async () => {
  // exercise authed REST, the dashboard websocket, and the cast websocket,
  // then grep the captured log stream for the key.
  await fetch(`${lbase}/api/devices`, { headers: auth });
  const ws = new WebSocket(`${lws}/dashboard-ws?key=${ADMIN}`);
  await new Promise((r) => ws.on("message", () => r(null)));
  ws.close();
  const castWs = new WebSocket(`${lws}/cast-ws?key=${ADMIN}&sessionId=${randomUUID()}`);
  await new Promise((r) => castWs.on("close", () => r(null)));
  assert.ok(!logs.text().includes(ADMIN), "admin key leaked into logs");
});

// --- open (unconfigured) server ----------------------------------------------
const open = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1" });
await open.app.listen({ port: 0, host: "127.0.0.1" });
const oaddr = open.app.server.address();
const oport = typeof oaddr === "object" && oaddr ? oaddr.port : 0;
after(() => open.app.close());

test("an unset admin key leaves the LAN-POC dashboard open (documented, warned)", async () => {
  const r = await fetch(`http://127.0.0.1:${oport}/api/devices`);
  assert.equal(r.status, 200);
});
