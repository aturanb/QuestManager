import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvFileIfPresent, loadRootEnv, nonBlankEnv } from "../src/env.js";

const KEY = "CAFEQUEST_ENV_TEST_KEY";

afterEach(() => {
  delete process.env[KEY];
});

test("loads variables from an existing env file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cafequest-env-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, `${KEY}=from-file\n`);

  assert.equal(loadEnvFileIfPresent(envPath), true);
  assert.equal(process.env[KEY], "from-file");
});

test("preserves an explicitly exported variable over the env file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cafequest-env-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, `${KEY}=from-file\n`);
  process.env[KEY] = "from-shell";

  assert.equal(loadEnvFileIfPresent(envPath), true);
  assert.equal(process.env[KEY], "from-shell");
});

test("missing env file is optional", () => {
  assert.equal(loadEnvFileIfPresent(path.join(os.tmpdir(), "cafequest-does-not-exist", ".env")), false);
});

test("loads the repository-root env file from the compiled server location", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cafequest-root-"));
  const moduleUrl = pathToFileURL(path.join(root, "server", "dist", "src", "env.js")).href;
  fs.writeFileSync(path.join(root, ".env"), `${KEY}=from-root\n`);

  assert.equal(loadRootEnv(moduleUrl), true);
  assert.equal(process.env[KEY], "from-root");
});

test("blank optional values fall back while non-blank values are preserved", () => {
  assert.equal(nonBlankEnv(undefined), undefined);
  assert.equal(nonBlankEnv(""), undefined);
  assert.equal(nonBlankEnv("   "), undefined);
  assert.equal(nonBlankEnv("/tmp/cafe quest.db"), "/tmp/cafe quest.db");
});
