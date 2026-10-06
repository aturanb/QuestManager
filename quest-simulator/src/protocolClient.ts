// Pure helpers that build protocol messages, shared by simulator tests and runtime.
import type { Telemetry, Hello } from "@cafequest/shared";

export function makeHello(input: Omit<Hello, "type" | "protocolVersion">): Hello {
  return { type: "hello", protocolVersion: 1, ...input };
}

export function makeTelemetry(
  input: Omit<Telemetry, "type" | "protocolVersion">
): Telemetry {
  return { type: "telemetry", protocolVersion: 1, ...input };
}
