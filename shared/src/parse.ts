import { z } from "zod";
import { AgentMessageSchema, PROTOCOL_VERSION } from "./protocol.js";

export type ParseSuccess<T> = { ok: true; value: T };
export type ParseFailure = {
  ok: false;
  code: "UNSUPPORTED_PROTOCOL_VERSION" | "MALFORMED_MESSAGE";
  message: string;
};

const VERSION_RE = /"protocolVersion"\s*:/;

/**
 * Parse an untrusted JSON string into an agent message.
 * Never throws. Detects unsupported protocolVersion before full validation
 * so the server can reply with a useful, specific error (§34).
 */
export function parseAgentMessage(raw: string): ParseSuccess<z.infer<typeof AgentMessageSchema>> | ParseFailure {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: "MALFORMED_MESSAGE", message: "invalid JSON" };
  }
  if (json === null || typeof json !== "object") {
    return { ok: false, code: "MALFORMED_MESSAGE", message: "message must be a JSON object" };
  }
  if (VERSION_RE.test(raw)) {
    const probe = (json as Record<string, unknown>).protocolVersion;
    if (probe !== PROTOCOL_VERSION) {
      return {
        ok: false,
        code: "UNSUPPORTED_PROTOCOL_VERSION",
        message: `unsupported protocolVersion ${String(probe)}; server speaks ${PROTOCOL_VERSION}`,
      };
    }
  }
  const result = AgentMessageSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "validation failed";
    return { ok: false, code: "MALFORMED_MESSAGE", message: where };
  }
  return { ok: true, value: result.data };
}
