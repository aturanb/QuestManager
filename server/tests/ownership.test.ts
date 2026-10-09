// Ownership + duplicate-safety contract (P0-A): every ack/result is validated
// against the connection's device, duplicates can never steal a connection,
// and late/duplicate results can never regress a terminal command.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice, createCommand, getCommand } from "../src/store.js";

const { app, db } = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1" });
await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const wsBase = `ws://127.0.0.1:${port}`;
after(() => app.close());

const ID_A = randomUUID();
const ID_B = randomUUID();

function hello(id: string, name: string) {
  return { type: "hello", protocolVersion: 1, deviceId: id, deviceName: name, deviceModel: "Quest 3", agentVersion: "0.1.0" };
}

async function connect(id: string, name: string): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/agent-ws`);
  await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
  ws.send(JSON.stringify(hello(id, name)));
  await new Promise((r) => setTimeout(r, 150));
  return ws;
}

function nextMessage(ws: WebSocket, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no message in time")), ms);
    ws.once("message", (m) => { clearTimeout(t); resolve(JSON.parse(String(m))); });
  });
}

test("duplicate connection: newest hello wins, old socket is told why and closed", async () => {
  const first = await connect(ID_A, "Quest A");
  const errors: any[] = [];
  first.on("message", (m) => { try { const j = JSON.parse(String(m)); if (j.type === "error") errors.push(j); } catch { /* ignore */ } });
  const closed = new Promise<{ code: number }>((r) => first.on("close", (code) => r({ code })));
  const second = await connect(ID_A, "Quest A");
  const { code } = await closed;
  assert.equal(code, 4001);
  assert.ok(errors.some((e) => e.code === "DUPLICATE_DEVICE"), "old socket gets DUPLICATE_DEVICE");
  assert.equal(second.readyState, WebSocket.OPEN);
  const rows = db.prepare("SELECT COUNT(*) AS n FROM devices WHERE id = ?").get(ID_A) as any;
  assert.equal(rows.n, 1);
  first.close(); second.close();
});

test("ack for an unknown commandId yields UNKNOWN_COMMAND and changes nothing", async () => {
  const ws = await connect(ID_A, "Quest A");
  const ghost = randomUUID();
  ws.send(JSON.stringify({ type: "command_ack", protocolVersion: 1, commandId: ghost, status: "received", deviceId: ID_A }));
  const err = await nextMessage(ws);
  assert.equal(err.type, "error");
  assert.equal(err.code, "UNKNOWN_COMMAND");
  assert.equal(getCommand(db, ghost), null);
  ws.close();
});

test("ack/result for another device's command yields FOREIGN_COMMAND, command untouched", async () => {
  upsertDevice(db, { id: ID_B, name: "Quest B" });
  const cmd = createCommand(db, ID_B, "launch_app");
  const ws = await connect(ID_A, "Quest A");
  ws.send(JSON.stringify({ type: "command_ack", protocolVersion: 1, commandId: cmd.id, status: "received", deviceId: ID_A }));
  const err = await nextMessage(ws);
  assert.equal(err.code, "FOREIGN_COMMAND");
  assert.equal(getCommand(db, cmd.id)!.status, "queued");
  ws.send(JSON.stringify({ type: "command_result", protocolVersion: 1, commandId: cmd.id, status: "success", deviceId: ID_A }));
  const err2 = await nextMessage(ws);
  assert.equal(err2.code, "FOREIGN_COMMAND");
  assert.equal(getCommand(db, cmd.id)!.status, "queued");
  ws.close();
});

test("duplicate and late results never regress a terminal command", async () => {
  upsertDevice(db, { id: ID_A, name: "Quest A" });
  const cmd = createCommand(db, ID_A, "launch_app");
  const ws = await connect(ID_A, "Quest A");
  ws.send(JSON.stringify({ type: "command_ack", protocolVersion: 1, commandId: cmd.id, status: "received", deviceId: ID_A }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(getCommand(db, cmd.id)!.status, "received");
  ws.send(JSON.stringify({ type: "command_result", protocolVersion: 1, commandId: cmd.id, status: "success", deviceId: ID_A }));
  await new Promise((r) => setTimeout(r, 100));
  const done = getCommand(db, cmd.id)!;
  assert.equal(done.status, "success");
  // duplicate success, contradictory failure, and late ack: all ignored silently
  for (const m of [
    { type: "command_result", protocolVersion: 1, commandId: cmd.id, status: "success", deviceId: ID_A },
    { type: "command_result", protocolVersion: 1, commandId: cmd.id, status: "failed", error: "late-lie", deviceId: ID_A },
    { type: "command_ack", protocolVersion: 1, commandId: cmd.id, status: "received", deviceId: ID_A },
  ]) {
    ws.send(JSON.stringify(m));
    await new Promise((r) => setTimeout(r, 100));
  }
  const afterDupes = getCommand(db, cmd.id)!;
  assert.equal(afterDupes.status, "success");
  assert.equal(afterDupes.completedAt, done.completedAt);
  assert.equal(afterDupes.error, done.error);
  ws.close();
});

test("telemetry claiming another deviceId is rejected with DEVICE_MISMATCH", async () => {
  const ws = await connect(ID_A, "Quest A");
  ws.send(JSON.stringify({
    type: "telemetry", protocolVersion: 1, deviceId: ID_B,
    timestamp: new Date().toISOString(),
    battery: { level: 50, charging: false }, agent: { foreground: true }, expectedCurrentGame: null,
  }));
  const err = await nextMessage(ws);
  assert.equal(err.code, "DEVICE_MISMATCH");
  ws.close();
});

test("reconnect with a stale last_seen_at stays connected (hello proves liveness)", async () => {
  const staleId = randomUUID();
  upsertDevice(db, { id: staleId, name: "Quest Stale" });
  // pretend it has been offline for a minute
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(
    new Date(Date.now() - 60_000).toISOString(), staleId
  );
  const ws = await connect(staleId, "Quest Stale");
  // the 1s offline sweep must NOT drop this socket before telemetry arrives
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(ws.readyState, WebSocket.OPEN);
  const res = await fetch(`http://127.0.0.1:${port}/api/devices`);
  const body: any = await res.json();
  const d = (body.devices as any[]).find((x) => x.id === staleId);
  assert.ok(d && d.online === true, "reconnected device is online");
  ws.close();
});

test("a silent agent whose socket answers pings stays online (pong proves liveness)", async () => {
  const quietId = randomUUID();
  const ws = await connect(quietId, "Quest Asleep");
  // No telemetry from here on, like a sleeping headset whose timers are frozen.
  // Without another liveness signal it goes stale 6s from now and is dropped.
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(
    new Date(Date.now() - 9_000).toISOString(), quietId
  );
  await new Promise((r) => setTimeout(r, 8_000));
  assert.equal(ws.readyState, WebSocket.OPEN, "sweep must not drop a socket that answers pings");
  const res = await fetch(`http://127.0.0.1:${port}/api/devices`);
  const body: any = await res.json();
  const d = (body.devices as any[]).find((x) => x.id === quietId);
  assert.ok(d && d.online === true, "silent but reachable device is online");
  ws.close();
});
