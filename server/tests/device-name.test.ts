// The server owns a headset's name: it tells the agent after every hello and
// every rename, and only a name staff typed on the headset (flagged) may
// rename an existing record. A reinstalled headset's default name never wins.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { getDevice, renameDevice, upsertDevice } from "../src/store.js";

const { app, db } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  logger: { level: "silent" },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const port = typeof address === "object" && address ? address.port : 0;
after(() => app.close());

const NAME_CAPABILITY = "device_name_v1";

interface Headset {
  socket: WebSocket;
  /** Every `device_name` frame received so far, in order. */
  names: string[];
}

async function connect(
  deviceId: string,
  deviceName: string,
  extra: { capabilities?: string[]; deviceNameSetByStaff?: boolean } = {},
): Promise<Headset> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/agent-ws`);
  const names: string[] = [];
  socket.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "device_name") names.push(frame.name);
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  socket.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    deviceId,
    deviceName,
    deviceModel: "Quest 3",
    agentVersion: "0.7.0",
    capabilities: [NAME_CAPABILITY],
    ...extra,
  }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { socket, names };
}

async function rename(deviceId: string, name: string) {
  return app.inject({ method: "POST", url: `/api/devices/${deviceId}/rename`, payload: { name } });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test("a reinstalled headset reporting a default name is told the server's name instead", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Quest ABCD" });
  renameDevice(db, id, "Quest 01");

  const headset = await connect(id, "Quest EFGH");

  assert.equal(getDevice(db, id)?.name, "Quest 01");
  assert.deepEqual(headset.names, ["Quest 01"]);
  headset.socket.close();
});

test("a brand-new headset is told the name it registered with", async () => {
  const id = randomUUID();
  const headset = await connect(id, "Quest NEW1");
  assert.deepEqual(headset.names, ["Quest NEW1"]);
  headset.socket.close();
});

test("a name staff typed on the headset renames the existing record and is echoed back", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Quest 01" });

  const headset = await connect(id, "Quest 07", { deviceNameSetByStaff: true });

  assert.equal(getDevice(db, id)?.name, "Quest 07");
  assert.deepEqual(headset.names, ["Quest 07"]);
  headset.socket.close();
});

test("a flagged name is trimmed, and a blank one keeps the server's name", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Quest 01" });

  const padded = await connect(id, "  Quest 09  ", { deviceNameSetByStaff: true });
  assert.equal(getDevice(db, id)?.name, "Quest 09");
  padded.socket.close();
  await settle();

  const blank = await connect(id, "   ", { deviceNameSetByStaff: true });
  assert.equal(getDevice(db, id)?.name, "Quest 09");
  assert.deepEqual(blank.names, ["Quest 09"]);
  blank.socket.close();
});

test("an unflagged name never renames, even when it differs", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Quest 01" });

  const headset = await connect(id, "Quest 07", { deviceNameSetByStaff: false });

  assert.equal(getDevice(db, id)?.name, "Quest 01");
  headset.socket.close();
});

test("a dashboard rename reaches the connected headset at once", async () => {
  const id = randomUUID();
  const headset = await connect(id, "Quest 01");
  headset.names.length = 0;

  const response = await rename(id, "Bay 3");
  await settle();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(headset.names, ["Bay 3"]);
  headset.socket.close();
});

test("a rename made while the headset is offline reaches it on its next hello", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Quest 01" });
  assert.equal((await rename(id, "Bay 4")).statusCode, 200);

  const headset = await connect(id, "Quest 01");

  assert.equal(getDevice(db, id)?.name, "Bay 4");
  assert.deepEqual(headset.names, ["Bay 4"]);
  headset.socket.close();
});

test("an agent that did not advertise device_name_v1 is never sent the frame", async () => {
  const id = randomUUID();
  const legacy = await connect(id, "Quest 01", { capabilities: [] });
  await rename(id, "Bay 5");
  await settle();

  assert.deepEqual(legacy.names, []);
  assert.equal(getDevice(db, id)?.name, "Bay 5");
  legacy.socket.close();
});

test("rename trims the name and rejects a blank or overlong one", async () => {
  const id = randomUUID();
  upsertDevice(db, { id, name: "Quest 01" });

  assert.equal((await rename(id, "  Bay 6  ")).statusCode, 200);
  assert.equal(getDevice(db, id)?.name, "Bay 6");
  assert.equal((await rename(id, "   ")).statusCode, 400);
  assert.equal((await rename(id, "x".repeat(65))).statusCode, 400);
  assert.equal(getDevice(db, id)?.name, "Bay 6");
});
