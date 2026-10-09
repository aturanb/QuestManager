// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import viteConfig from "../vite.config";

describe("dashboard development proxy", () => {
  it("routes the live-view WebSocket to the CafeQuest server", () => {
    const config = viteConfig as UserConfig;

    expect(config.server?.proxy?.["/cast-ws"]).toMatchObject({
      target: "ws://localhost:3000",
      ws: true,
    });
  });
});
