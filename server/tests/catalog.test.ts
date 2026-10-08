import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppCatalog } from "../src/catalog.js";

test("catalog loads package-to-Meta-ID records and ignores malformed entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "cq-catalog-"));
  const file = join(dir, "apps.json");
  writeFileSync(file, JSON.stringify([
    { appName: "Breachers", packageName: "com.TriangleFactory.Breachers", id: "5740397619319389" },
    { appName: "Bad package", packageName: "bad package", id: "12345" },
    { appName: "Bad id", packageName: "com.example.bad", id: "not-numeric" },
  ]));

  const catalog = loadAppCatalog(file);
  assert.deepEqual(catalog.get("com.TriangleFactory.Breachers"), {
    name: "Breachers",
    packageName: "com.TriangleFactory.Breachers",
    metaAppId: "5740397619319389",
  });
  assert.equal(catalog.has("bad package"), false);
  assert.equal(catalog.has("com.example.bad"), false);
});

test("catalog retains verified fallback mappings when the cache is missing", () => {
  const catalog = loadAppCatalog("/definitely/missing/cafequest-catalog.json");
  assert.equal(catalog.get("com.beatgames.beatsaber")?.metaAppId, "2448060205267927");
});
