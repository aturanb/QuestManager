// A dashboard that stops reading (a laptop asleep, a frozen tab, a stalled dev
// proxy) must cost the server bounded memory. The café server once ran out of
// heap after ~71 h queueing a full snapshot every second to such a socket.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { replaceDeviceApps, upsertDevice } from "../src/store.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value as T;
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await wait(25);
  }
}

async function listen(app: Awaited<ReturnType<typeof buildApp>>["app"]): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  return `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

async function openDashboard(base: string): Promise<WebSocket> {
  const ws = new WebSocket(`${base}/dashboard-ws`);
  await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
  return ws;
}

// Default timings; four headsets with 200 apps each make a realistic large snapshot.
const main = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1" });
const mainBase = await listen(main.app);
after(() => main.app.close());
for (let d = 1; d <= 4; d++) {
  const id = randomUUID();
  upsertDevice(main.db, { id, name: `Quest 0${d}`, model: "Quest 3", agentVersion: "0.1.0" });
  replaceDeviceApps(main.db, id, Array.from({ length: 200 }, (_, k) => ({
    packageName: `com.example.game${k}`, label: `Example Game ${k}`, versionName: "1.0.0", versionCode: 100,
  })));
}

// Fast ping cadence so liveness is observable within a test.
const quick = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1", dashboardPingMs: 100 });
const quickBase = await listen(quick.app);
after(() => quick.app.close());

test("a dashboard that stops reading does not queue snapshots without bound", async () => {
  const dash = await openDashboard(mainBase);
  dash.pause();
  const snapshotBytes = Buffer.byteLength(JSON.stringify({ type: "state", payload: main.hub.snapshot() }));
  assert.ok(snapshotBytes > 100_000, `snapshot only ${snapshotBytes} bytes; the test needs a large one`);
  // Five minutes of 1 s pushes, delivered at once.
  for (let i = 0; i < 300; i++) main.hub.pushDashboardState();
  const queued = Math.max(...[...main.app.websocketServer.clients].map((s) => s.bufferedAmount));
  assert.ok(queued < 2 * 1024 * 1024, `server queued ${queued} bytes for a stalled dashboard`);
  dash.terminate();
});

test("a dashboard that stops answering pings is dropped", async () => {
  const dash = await openDashboard(quickBase);
  try {
    await waitFor(() => quick.app.websocketServer.clients.size === 1);
    dash.pause();
    await waitFor(() => quick.app.websocketServer.clients.size === 0);
  } finally {
    dash.terminate();
  }
});

test("a dashboard that answers pings stays connected and keeps receiving state", async () => {
  const dash = await openDashboard(quickBase);
  let states = 0;
  dash.on("message", (raw) => { if (JSON.parse(String(raw)).type === "state") states++; });
  await wait(1_500); // fifteen ping rounds, at least one 1 s push
  assert.equal(dash.readyState, WebSocket.OPEN);
  assert.ok(states >= 1, "no state message in 1.5 s");
  dash.close();
});
