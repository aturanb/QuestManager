// Unlimited sessions over the dashboard API: `minutes: null` starts one, the
// board shows it with no end, it cannot be extended, and stopping it leaves the
// played time on the board for staff to charge.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice } from "../src/store.js";

const { app, db } = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1", logger: { level: "silent" } });
await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const base = `http://127.0.0.1:${port}`;
after(() => app.close());

type BoardSession = { id: string; startedAt: string; endsAt: string | null; status: string };

function post(url: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${url}`, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function boardSession(deviceId: string): Promise<BoardSession | null> {
  const snap = (await (await fetch(`${base}/api/devices`)).json()) as { devices: Array<{ id: string; session: BoardSession | null }> };
  return snap.devices.find((d) => d.id === deviceId)?.session ?? null;
}

async function startUnlimited(): Promise<{ deviceId: string; session: BoardSession }> {
  const deviceId = randomUUID();
  upsertDevice(db, { id: deviceId, name: "Quest U" });
  const res = await post(`/api/devices/${deviceId}/sessions`, { minutes: null });
  assert.equal(res.status, 201);
  return { deviceId, session: ((await res.json()) as { session: BoardSession }).session };
}

test("minutes: null starts an unlimited session, but leaving minutes out is still rejected", async () => {
  const deviceId = randomUUID();
  upsertDevice(db, { id: deviceId, name: "Quest U" });
  const missing = await post(`/api/devices/${deviceId}/sessions`, {});
  assert.equal(missing.status, 400);

  const res = await post(`/api/devices/${deviceId}/sessions`, { minutes: null });
  assert.equal(res.status, 201);
  const { session } = (await res.json()) as { session: BoardSession };
  assert.equal(session.endsAt, null);
  assert.deepEqual(await boardSession(deviceId), {
    id: session.id,
    startedAt: session.startedAt,
    endsAt: null,
    status: "active",
  });
});

test("an unlimited session cannot be extended", async () => {
  const { session } = await startUnlimited();
  const res = await post(`/api/sessions/${session.id}/extend`, { minutes: 15 });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "session has no time limit" });
});

test("stopping an unlimited session leaves its end time on the board", async () => {
  const { deviceId, session } = await startUnlimited();
  const res = await post(`/api/sessions/${session.id}/stop`);
  assert.equal(res.status, 200);
  const { session: stopped } = (await res.json()) as { session: BoardSession };
  assert.ok(stopped.endsAt && stopped.endsAt >= session.startedAt, `ended at ${stopped.endsAt}`);
  assert.deepEqual(await boardSession(deviceId), {
    id: session.id,
    startedAt: session.startedAt,
    endsAt: stopped.endsAt,
    status: "stopped",
  });
});
