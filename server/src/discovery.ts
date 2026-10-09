import { createSocket } from "node:dgram";
import { hostname } from "node:os";
import type { FastifyBaseLogger } from "fastify";
import { MAX_DISCOVERY_BYTES, parseDiscoveryProbe, type DiscoveryReply } from "@cafequest/shared";

/**
 * The name headsets show and remember (spec 2026-10-09 §1): the PC's hostname
 * without macOS's ".local", at most 64 characters, never empty.
 */
export function serverDisplayName(host: string = hostname()): string {
  return host.trim().replace(/\.local$/i, "").slice(0, 64) || "CafeQuest";
}

export type DiscoveryResponder = {
  /** The UDP port actually bound (the OS picks one when asked for 0). */
  port: number;
  close(): Promise<void>;
};

export type DiscoveryOptions = {
  port: number;
  host: string;
  name: string;
  /** The live HTTP port, or null before listen(); read per probe so the reply never lies. */
  httpPort: () => number | null;
  log: FastifyBaseLogger;
};

/**
 * Answers headset discovery probes (spec §2): only valid probes of at most
 * MAX_DISCOVERY_BYTES, straight back to the sender, never unprompted. Resolves
 * to null when the UDP port is taken: the server keeps running and headsets can
 * still use a manual IP.
 */
export async function startDiscoveryResponder(opts: DiscoveryOptions): Promise<DiscoveryResponder | null> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(opts.port, opts.host, () => {
        socket.off("error", reject);
        resolve();
      });
    });
  } catch (err) {
    socket.close();
    opts.log.warn({ err, port: opts.port }, `discovery disabled: UDP ${opts.port} unavailable; headsets need a manual IP`);
    return null;
  }
  socket.on("error", (err) => opts.log.warn({ err }, "discovery socket error"));
  socket.on("message", (msg, rinfo) => {
    if (msg.length > MAX_DISCOVERY_BYTES || !parseDiscoveryProbe(msg.toString("utf8"))) return;
    const httpPort = opts.httpPort();
    if (httpPort === null) return;
    const reply: DiscoveryReply = { type: "cafequest_server", name: opts.name, port: httpPort };
    socket.send(JSON.stringify(reply), rinfo.port, rinfo.address);
    opts.log.info({ from: rinfo.address }, "discovery probe answered");
  });
  const port = socket.address().port;
  opts.log.info({ port, name: opts.name }, "discovery: answering headset probes");
  return {
    port,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}
