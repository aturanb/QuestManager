import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError, deleteDevice, getCatalogStatus, getSnapshot, launchGame, launchInstalledApp, mapInstalledApp, refreshCatalog, stopSession } from "./api";

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: status < 300, status, json: () => Promise.resolve(body) }) as any;
}
beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("sends the admin key as a Bearer header", async () => {
    mockFetch(200, { serverTime: "t", devices: [] });
    await getSnapshot("secret-key");
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer secret-key");
  });

  it("throws ApiError with status on failure", async () => {
    mockFetch(401, { error: "unauthorized" });
    await expect(getSnapshot("bad")).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>);
  });

  it("launch posts the game id to the device route", async () => {
    mockFetch(202, { commandId: "c1", status: "sent" });
    const res = await launchGame("k", "dev-1", "beat-saber");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/devices/dev-1/launch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ gameId: "beat-saber" });
    expect(res.commandId).toBe("c1");
  });

  it("launches an installed app by its package name", async () => {
    mockFetch(202, { commandId: "c2", status: "sent" });
    await launchInstalledApp("k", "dev-1", "com.example.game");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/devices/dev-1/launch-installed");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ packageName: "com.example.game" });
  });

  it("reads the cached catalog status", async () => {
    mockFetch(200, { entries: 18100, fetchedAt: "2026-10-08T10:00:00.000Z", source: "https://example.test/apps.json" });
    const status = await getCatalogStatus("k");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/catalog");
    expect(init.method).toBeUndefined();
    expect(status.entries).toBe(18100);
  });

  it("posts a catalog refresh and returns the new mapping count", async () => {
    mockFetch(200, { entries: 18200, fetchedAt: "2026-10-08T12:00:00.000Z" });
    const result = await refreshCatalog("k");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/catalog/refresh");
    expect(init.method).toBe("POST");
    expect(result.entries).toBe(18200);
  });

  it("saves a manual package-to-App-ID mapping", async () => {
    mockFetch(200, { app: {} });
    await mapInstalledApp("k", "dev-1", "com.example.game", "Example Game", "1234567890123456");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/devices/dev-1/apps/com.example.game");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ name: "Example Game", metaAppId: "1234567890123456" });
  });

  it("sends no JSON content-type on bodyless calls, which the server would reject as an empty body", async () => {
    mockFetch(200, { session: {} });
    await stopSession("k", "s1");
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBeUndefined();
  });

  it("labels JSON bodies as JSON", async () => {
    mockFetch(202, { commandId: "c1", status: "sent" });
    await launchGame("k", "dev-1", "beat-saber");
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("deletes a headset by id", async () => {
    mockFetch(200, { deleted: "dev-1" });
    const result = await deleteDevice("k", "dev-1");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/devices/dev-1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(result.deleted).toBe("dev-1");
  });

  it("surfaces a refused delete of a connected headset", async () => {
    mockFetch(409, { error: "headset_online", detail: "connected" });
    await expect(deleteDevice("k", "dev-1")).rejects.toMatchObject({ status: 409, message: "headset_online" });
  });
});
