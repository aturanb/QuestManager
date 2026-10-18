// Headsets find the café PC by broadcasting a UDP probe; the server answers the
// sender with its name and live HTTP port (spec 2026-10-09 §2). Real UDP on
// loopback, port 0, so nothing here needs the LAN or a firewall prompt.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createSocket } from "node:dgram";
import { buildApp } from "../src/app.js";
import { serverDisplayName } from "../src/discovery.js";

const PROBE = JSON.stringify({ type: "cafequest_discover" });

function streamLogger() {
  let text = "";
  const stream = { write: (s: string) => { text += s; } };
  return { stream, text: () => text };
}

/** Sends one datagram to the responder; resolves with the first reply, or null after waitMs. */
async function ask(payload: string, udpPort: number, waitMs = 300): Promise<string | null> {
  const client = createSocket("udp4");
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), waitMs);
      client.on("message", (msg) => {
        clearTimeout(timer);
        resolve(msg.toString("utf8"));
      });
      client.send(payload, udpPort, "127.0.0.1");
    });
  } finally {
    client.close();
  }
}

const logs = streamLogger();
const built = await buildApp({
  dbPath: ":memory:", port: 0, host: "127.0.0.1", discoveryPort: 0,
  logger: { level: "info", stream: logs.stream as any },
});
await built.app.listen({ port: 0, host: "127.0.0.1" });
const addr = built.app.server.address();
const httpPort = typeof addr === "object" && addr ? addr.port : 0;
after(() => built.app.close());

test("a probe gets the server's name and live HTTP port", async () => {
  assert.ok(built.discovery, "discovery should be running");
  const reply = await ask(PROBE, built.discovery.port);
  assert.ok(reply, "no reply");
  assert.deepEqual(JSON.parse(reply), { type: "cafequest_server", name: serverDisplayName(), port: httpPort });
  assert.match(logs.text(), /discovery probe answered/);
});

test("junk and oversize datagrams get no answer", async () => {
  assert.ok(built.discovery);
  const oversize = JSON.stringify({ type: "cafequest_discover", pad: "x".repeat(600) });
  for (const payload of ["hello", "{}", '{"type":"cafequest_server","name":"X","port":1}', oversize]) {
    assert.equal(await ask(payload, built.discovery.port), null, payload.slice(0, 40));
  }
});

test("a busy UDP port leaves the server running without discovery", async () => {
  const squatter = createSocket("udp4");
  await new Promise<void>((resolve) => squatter.bind(0, "127.0.0.1", () => resolve()));
  const busyLogs = streamLogger();
  const second = await buildApp({
    dbPath: ":memory:", port: 0, host: "127.0.0.1", discoveryPort: squatter.address().port,
    logger: { level: "info", stream: busyLogs.stream as any },
  });
  try {
    assert.equal(second.discovery, null);
    assert.match(busyLogs.text(), /discovery disabled/);
    await second.app.listen({ port: 0, host: "127.0.0.1" });
    const a = second.app.server.address();
    const p = typeof a === "object" && a ? a.port : 0;
    assert.equal((await fetch(`http://127.0.0.1:${p}/api/health`)).status, 200);
  } finally {
    await second.app.close();
    squatter.close();
  }
});

test("before the server listens a probe gets no answer, and closing frees the UDP port", async () => {
  const idle = await buildApp({ dbPath: ":memory:", port: 0, host: "127.0.0.1", discoveryPort: 0, logger: { level: "silent" } });
  await idle.app.ready(); // booted, so close() runs the onClose hooks, but never listening
  assert.ok(idle.discovery);
  const udpPort = idle.discovery.port;
  // Not listening yet: there is no HTTP port to announce.
  assert.equal(await ask(PROBE, udpPort), null);
  await idle.app.close();
  const reuse = createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    reuse.once("error", reject);
    reuse.bind(udpPort, "127.0.0.1", () => resolve());
  });
  reuse.close();
});

test("serverDisplayName drops .local, caps at 64 and never goes empty", () => {
  assert.equal(serverDisplayName("Ahmets-MacBook-Air.local"), "Ahmets-MacBook-Air");
  assert.equal(serverDisplayName("CAFE-PC"), "CAFE-PC");
  assert.equal(serverDisplayName("x".repeat(80)).length, 64);
  assert.equal(serverDisplayName("  "), "CafeQuest");
  assert.equal(serverDisplayName(".local"), "CafeQuest");
});
