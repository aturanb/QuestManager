import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshAppCatalog, CATALOG_SOURCE_URL } from "../src/catalog-refresh.js";

/** The live source holds >1000 apps; tests reuse one valid record to reach that floor. */
function validEntries(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    appName: `Game ${i}`,
    packageName: `com.example.game${i}`,
    id: String(1000000000000000 + i),
  }));
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function tempCatalog(existing?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cq-refresh-"));
  const file = join(dir, "app-catalog.json");
  if (existing !== undefined) writeFileSync(file, existing);
  return file;
}

test("refresh writes the fetched mappings and reports how many it stored", async () => {
  const file = tempCatalog();
  let requested: string | undefined;

  const result = await refreshAppCatalog({
    path: file,
    fetchImpl: async (url) => {
      requested = String(url);
      return okResponse(validEntries(1200));
    },
  });

  assert.equal(requested, CATALOG_SOURCE_URL);
  assert.equal(result.entries, 1200);
  assert.ok(Date.parse(result.fetchedAt) > 0);
  const written = JSON.parse(readFileSync(file, "utf8")) as unknown[];
  assert.equal(written.length, 1200);
});

test("refresh drops malformed records but keeps the valid ones", async () => {
  const file = tempCatalog();

  const result = await refreshAppCatalog({
    path: file,
    fetchImpl: async () =>
      okResponse([
        ...validEntries(1000),
        { appName: "Bad package", packageName: "bad package", id: "12345" },
        { appName: "Bad id", packageName: "com.example.bad", id: "not-numeric" },
        null,
      ]),
  });

  assert.equal(result.entries, 1000);
  const written = JSON.parse(readFileSync(file, "utf8")) as Array<{ packageName: string }>;
  assert.equal(written.some((e) => e.packageName === "bad package"), false);
  assert.equal(written.some((e) => e.packageName === "com.example.bad"), false);
});

test("a failed HTTP fetch leaves the previous catalog file untouched", async () => {
  const previous = JSON.stringify([{ appName: "Kept", packageName: "com.example.kept", id: "123456" }]);
  const file = tempCatalog(previous);

  await assert.rejects(
    refreshAppCatalog({
      path: file,
      fetchImpl: async () => new Response("nope", { status: 503 }),
    }),
    /HTTP 503/
  );
  assert.equal(readFileSync(file, "utf8"), previous);
});

test("a truncated catalog response leaves the previous catalog file untouched", async () => {
  const previous = JSON.stringify([{ appName: "Kept", packageName: "com.example.kept", id: "123456" }]);
  const file = tempCatalog(previous);

  await assert.rejects(
    refreshAppCatalog({ path: file, fetchImpl: async () => okResponse(validEntries(12)) }),
    /not contain enough valid package mappings/
  );
  assert.equal(readFileSync(file, "utf8"), previous);
});

test("a non-array catalog response leaves the previous catalog file untouched", async () => {
  const previous = JSON.stringify([{ appName: "Kept", packageName: "com.example.kept", id: "123456" }]);
  const file = tempCatalog(previous);

  await assert.rejects(
    refreshAppCatalog({ path: file, fetchImpl: async () => okResponse({ apps: [] }) }),
    /expected application array/
  );
  assert.equal(readFileSync(file, "utf8"), previous);
});

test("a network error leaves the previous catalog file untouched", async () => {
  const previous = JSON.stringify([{ appName: "Kept", packageName: "com.example.kept", id: "123456" }]);
  const file = tempCatalog(previous);

  await assert.rejects(
    refreshAppCatalog({
      path: file,
      fetchImpl: async () => {
        throw new Error("ENOTFOUND raw.githubusercontent.com");
      },
    }),
    /ENOTFOUND/
  );
  assert.equal(readFileSync(file, "utf8"), previous);
});
