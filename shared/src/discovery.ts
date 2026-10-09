import { z } from "zod";

/*
 * LAN discovery (docs/superpowers/specs/2026-10-09-server-discovery-design.md).
 * A headset broadcasts a probe to DISCOVERY_PORT; the server answers the sender
 * directly with its name and live HTTP port, and the headset dials the reply's
 * source address. Mirrored by hand in quest-agent/.../Discovery.kt.
 */

/** Fixed in both code bases and independent of PORT: the APK cannot learn it. */
export const DISCOVERY_PORT = 3000;

/** Largest datagram either side sends or reads. */
export const MAX_DISCOVERY_BYTES = 512;

export const DiscoveryProbeSchema = z.object({
  type: z.literal("cafequest_discover"),
});

export const DiscoveryReplySchema = z.object({
  type: z.literal("cafequest_server"),
  /** The PC's hostname without ".local"; headsets show it and stay with it. */
  name: z.string().min(1).max(64),
  /** The HTTP/WebSocket port the server is listening on. */
  port: z.number().int().min(1).max(65535),
});

export type DiscoveryProbe = z.infer<typeof DiscoveryProbeSchema>;
export type DiscoveryReply = z.infer<typeof DiscoveryReplySchema>;

function parseWith<S extends z.ZodTypeAny>(schema: S, raw: string): z.infer<S> | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

/** An untrusted datagram as a probe, or null. Never throws. */
export function parseDiscoveryProbe(raw: string): DiscoveryProbe | null {
  return parseWith(DiscoveryProbeSchema, raw);
}

/** An untrusted datagram as a reply, or null. Never throws. */
export function parseDiscoveryReply(raw: string): DiscoveryReply | null {
  return parseWith(DiscoveryReplySchema, raw);
}
