import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("tells staff a connected headset cannot be removed yet", () => {
    expect(friendlyError(new ApiError(409, "headset_online", "this headset is connected"))).toBe(
      "This headset is connected. Remove it once it shows offline."
    );
  });

  it("does not call every 409 an offline headset", () => {
    expect(friendlyError(new ApiError(409, "session already active"))).toBe("A session is already running on this headset.");
    expect(friendlyError(new ApiError(409, "headset offline", "device not connected"))).toBe(
      "Headset is offline. Wait for it to reconnect."
    );
  });

  it("passes through the server's explanation for an unconfigured game", () => {
    expect(friendlyError(new ApiError(400, "game_meta_app_id_not_configured", 'game "Beat Saber" still has a placeholder'))).toBe(
      'game "Beat Saber" still has a placeholder'
    );
  });

  it("keeps unknown codes and their detail visible", () => {
    expect(friendlyError(new ApiError(502, "catalog_refresh_failed", "HTTP 503"))).toBe("catalog_refresh_failed: HTTP 503");
  });

  it("explains an unreachable server", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/can't reach the CafeQuest server/i);
  });
});
