// LAN discovery messages (docs/superpowers/specs/2026-10-09-server-discovery-design.md §1).
// The agent's Discovery.kt mirrors these by hand: keep the shapes, port and cap in sync.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCOVERY_PORT, MAX_DISCOVERY_BYTES, parseDiscoveryProbe, parseDiscoveryReply } from "../src/discovery.js";

test("discovery uses UDP 3000 and datagrams of at most 512 bytes", () => {
  assert.equal(DISCOVERY_PORT, 3000);
  assert.equal(MAX_DISCOVERY_BYTES, 512);
});

test("a probe parses; anything else is null, never a throw", () => {
  assert.deepEqual(parseDiscoveryProbe('{"type":"cafequest_discover"}'), { type: "cafequest_discover" });
  const notProbes = ["", "hello", "null", "[]", "42", '{"type":"discover"}', '{"type":"cafequest_server","name":"PC","port":3000}'];
  for (const raw of notProbes) assert.equal(parseDiscoveryProbe(raw), null, raw);
});

test("a reply carries a 1-64 character name and a port from 1 to 65535", () => {
  assert.deepEqual(
    parseDiscoveryReply('{"type":"cafequest_server","name":"CAFE-PC","port":3000}'),
    { type: "cafequest_server", name: "CAFE-PC", port: 3000 },
  );
  assert.equal(parseDiscoveryReply(JSON.stringify({ type: "cafequest_server", name: "x".repeat(64), port: 65535 }))?.port, 65535);
  const notReplies = [
    { type: "cafequest_server", name: "", port: 3000 },
    { type: "cafequest_server", name: "x".repeat(65), port: 3000 },
    { type: "cafequest_server", name: "PC", port: 0 },
    { type: "cafequest_server", name: "PC", port: 65536 },
    { type: "cafequest_server", name: "PC", port: 3000.5 },
    { type: "cafequest_server", name: "PC" },
    { type: "cafequest_discover" },
  ];
  for (const reply of notReplies) assert.equal(parseDiscoveryReply(JSON.stringify(reply)), null, JSON.stringify(reply));
  assert.equal(parseDiscoveryReply("not json"), null);
});
