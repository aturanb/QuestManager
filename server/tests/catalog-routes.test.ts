import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { upsertDevice, replaceDeviceApps } from "../src/store.js";

const NEW_PACKAGE = "com.example.freshlymapped";
const NEW_APP_ID = "7412589630000001";

function entries(count: number, extra: unknown[] = []): unknown[] {
  return [
    ...Array.from({ length: count }, (_, i) => ({
      appName: `Game ${i}`,
      packageName: `com.example.game${i}`,
      id: String(1000000000000000 + i),
    })),
    ...extra,
  ];
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** An app whose catalog cache starts with one mapping and no knowledge of NEW_PACKAGE. */
async function buildWithCatalog(opts: { fetchImpl?: typeof fetch; adminApiKey?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cq-catalog-routes-"));
  const catalogPath = join(dir, "app-catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify([{ appName: "Breachers", packageName: "com.TriangleFactory.Breachers", id: "5740397619319389" }])
  );
  const built = await buildApp({
    dbPath: ":memory:",
    port: 0,
    host: "127.0.0.1",
    appCatalogPath: catalogPath,
    catalogFetch: opts.fetchImpl,
    adminApiKey: opts.adminApiKey,
  });
  return { ...built, catalogPath };
}

/** A device reporting NEW_PACKAGE installed, so catalog resolution is observable. */
function withInstalledApp(db: Parameters<typeof upsertDevice>[0]): string {
  const deviceId = randomUUID();
  upsertDevice(db, { id: deviceId, name: "Quest Test", model: "Quest 3", agentVersion: "0.1.0" });
  replaceDeviceApps(
    db,
    deviceId,
    [{ packageName: NEW_PACKAGE, label: "Freshly Mapped", versionName: "1.0", versionCode: 1 }],
    "2026-10-08T12:00:00.000Z"
  );
  return deviceId;
}

test("catalog status reports how many mappings are loaded", async () => {
  const { app } = await buildWithCatalog();
  try {
    const response = await app.inject({ method: "GET", url: "/api/catalog" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    // One cache record plus the hard-verified fallbacks.
    assert.ok(body.entries >= 5, `expected the fallback mappings to be counted, got ${body.entries}`);
    assert.equal(typeof body.source, "string");
  } finally {
    await app.close();
  }
});

test("refreshing replaces the in-memory catalog so new packages resolve without a restart", async () => {
  const { app, db } = await buildWithCatalog({
    fetchImpl: async () =>
      okResponse(entries(1000, [{ appName: "Freshly Mapped", packageName: NEW_PACKAGE, id: NEW_APP_ID }])),
  });
  try {
    const deviceId = withInstalledApp(db);

    const before = await app.inject({ method: "GET", url: "/api/devices" });
    assert.equal(before.json().devices[0].installedApps[0].metaAppId, null);

    const refresh = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    assert.equal(refresh.statusCode, 200);
    assert.equal(refresh.json().entries, 1001);

    const after = await app.inject({ method: "GET", url: "/api/devices" });
    const resolved = after.json().devices[0].installedApps[0];
    assert.equal(resolved.metaAppId, NEW_APP_ID);
    assert.equal(resolved.source, "catalog");
    assert.equal(after.json().devices[0].id, deviceId);
  } finally {
    await app.close();
  }
});

test("a failed refresh answers 502 and keeps the mappings staff already had", async () => {
  const { app, db } = await buildWithCatalog({
    fetchImpl: async () => new Response("upstream down", { status: 503 }),
  });
  try {
    withInstalledApp(db);

    const refresh = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    assert.equal(refresh.statusCode, 502);
    assert.equal(refresh.json().error, "catalog_refresh_failed");

    const devices = await app.inject({ method: "GET", url: "/api/devices" });
    assert.equal(devices.json().devices[0].installedApps[0].metaAppId, null);
    const status = await app.inject({ method: "GET", url: "/api/catalog" });
    assert.ok(status.json().entries >= 5);
  } finally {
    await app.close();
  }
});

test("a double-clicked refresh downloads the catalog only once", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { app } = await buildWithCatalog({
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return okResponse(entries(1000));
    },
  });
  try {
    const first = app.inject({ method: "POST", url: "/api/catalog/refresh" });
    const second = app.inject({ method: "POST", url: "/api/catalog/refresh" });
    release?.();
    const [a, b] = await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.equal(a.json().entries, b.json().entries);
  } finally {
    await app.close();
  }
});

test("catalog refresh is behind the admin key like every other /api route", async () => {
  const { app } = await buildWithCatalog({
    adminApiKey: "secret-key",
    fetchImpl: async () => okResponse(entries(1000)),
  });
  try {
    const unauthorized = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await app.inject({
      method: "POST",
      url: "/api/catalog/refresh",
      headers: { authorization: "Bearer secret-key" },
    });
    assert.equal(authorized.statusCode, 200);
  } finally {
    await app.close();
  }
});
