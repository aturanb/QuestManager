import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { getDevice, upsertDevice } from "../src/store.js";

const config = { dbPath: ":memory:", port: 0, host: "127.0.0.1", logger: { level: "silent" } };

test("notes can be created, listed, edited and deleted with multiline plain text", async () => {
  const { app } = await buildApp(config);
  try {
    const created = await app.inject({ method: "POST", url: "/api/notes", payload: { content: "  Quest 02 purchased Beat Saber\nHead strap replaced  " } });
    assert.equal(created.statusCode, 201);
    const { note } = created.json();
    assert.match(note.id, /^[0-9a-f-]{36}$/);
    assert.equal(note.content, "Quest 02 purchased Beat Saber\nHead strap replaced");
    assert.equal(note.revision, 1);
    assert.ok(Number.isFinite(Date.parse(note.createdAt)));
    assert.equal(note.updatedAt, note.createdAt);
    assert.deepEqual((await app.inject("/api/notes")).json(), { notes: [note] });

    const edited = await app.inject({ method: "PUT", url: `/api/notes/${note.id}`, payload: { content: "<b>Quest 02</b> has Breachers", revision: 1 } });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().note.content, "<b>Quest 02</b> has Breachers");
    assert.equal(edited.json().note.revision, 2);
    assert.equal(edited.json().note.createdAt, note.createdAt);
    const deleted = await app.inject({ method: "DELETE", url: `/api/notes/${note.id}`, payload: { revision: 2 } });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.json(), { deleted: note.id });
    assert.deepEqual((await app.inject("/api/notes")).json(), { notes: [] });
  } finally { await app.close(); }
});

test("notes reject invalid bodies and ids without changing saved content", async () => {
  const { app } = await buildApp(config);
  try {
    for (const payload of [{}, { content: " \n " }, { content: 4 }, { content: "x".repeat(5001) }, { content: "ok", extra: true }]) {
      assert.equal((await app.inject({ method: "POST", url: "/api/notes", payload })).statusCode, 400);
    }
    const accepted = await app.inject({ method: "POST", url: "/api/notes", payload: { content: "x".repeat(5000) } });
    assert.equal(accepted.statusCode, 201);
    const { note } = accepted.json();
    for (const payload of [{ content: "" }, { content: "edit" }, { content: "edit", revision: 0 }, { content: "edit", revision: 1.5 }]) {
      assert.equal((await app.inject({ method: "PUT", url: `/api/notes/${note.id}`, payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: "PUT", url: "/api/notes/bad-id", payload: { content: "ok", revision: 1 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/notes/${note.id}`, payload: {} })).statusCode, 400);
    for (const method of ["PUT", "DELETE"] as const) {
      const payload = method === "PUT" ? { content: "ok", revision: 1 } : { revision: 1 };
      assert.equal((await app.inject({ method, url: `/api/notes/${randomUUID()}`, payload })).statusCode, 404);
    }
    assert.equal((await app.inject("/api/notes")).json().notes[0].content.length, 5000);
  } finally { await app.close(); }
});

test("stale revisions cannot overwrite or delete another admin's update", async () => {
  const { app } = await buildApp(config);
  try {
    const { note } = (await app.inject({ method: "POST", url: "/api/notes", payload: { content: "original" } })).json();
    await app.inject({ method: "PUT", url: `/api/notes/${note.id}`, payload: { content: "newer change", revision: 1 } });
    for (const method of ["PUT", "DELETE"] as const) {
      const payload = method === "PUT" ? { content: "stale edit", revision: 1 } : { revision: 1 };
      const refused = await app.inject({ method, url: `/api/notes/${note.id}`, payload });
      assert.equal(refused.statusCode, 409);
      assert.equal(refused.json().error, "note_conflict");
    }
    assert.equal((await app.inject("/api/notes")).json().notes[0].content, "newer change");
  } finally { await app.close(); }
});

test("retrying a committed creation reuses its request id instead of duplicating the note", async () => {
  const { app } = await buildApp(config);
  try {
    const requestId = randomUUID();
    const payload = { content: "Quest 02 purchased Breachers", requestId };
    const committed = await app.inject({ method: "POST", url: "/api/notes", payload });
    assert.equal(committed.statusCode, 201);
    // Treat the first response as lost; the client sends the same request again.
    const retried = await app.inject({ method: "POST", url: "/api/notes", payload });
    assert.equal(retried.statusCode, 200);
    assert.deepEqual(retried.json(), committed.json());
    assert.deepEqual((await app.inject("/api/notes")).json().notes, [committed.json().note]);
    const mismatched = await app.inject({ method: "POST", url: "/api/notes", payload: { ...payload, content: "different draft" } });
    assert.equal(mismatched.statusCode, 409);
    assert.equal((await app.inject("/api/notes")).json().notes[0].content, payload.content);
  } finally { await app.close(); }
});

test("all notes operations require the configured admin key", async () => {
  const { app } = await buildApp({ ...config, adminApiKey: "notes-test-key" });
  try {
    for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
      const url = method === "GET" || method === "POST" ? "/api/notes" : `/api/notes/${randomUUID()}`;
      assert.equal((await app.inject({ method, url })).statusCode, 401);
    }
    const saved = await app.inject({ method: "POST", url: "/api/notes", headers: { authorization: "Bearer notes-test-key" }, payload: { content: "private note" } });
    assert.equal(saved.statusCode, 201);
  } finally { await app.close(); }
});

test("notes and existing headset records survive server close and database reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cq-notes-"));
  const dbPath = join(dir, "cafequest.db");
  const deviceId = randomUUID();
  try {
    const first = await buildApp({ ...config, dbPath });
    let saved: unknown;
    try {
      upsertDevice(first.db, { id: deviceId, name: "Quest 02" });
      saved = (await first.app.inject({ method: "POST", url: "/api/notes", payload: { content: "Quest 02 purchased Breachers" } })).json().note;
      assert.ok(saved);
    } finally { await first.app.close(); }
    const second = await buildApp({ ...config, dbPath });
    try {
      assert.deepEqual((await second.app.inject("/api/notes")).json(), { notes: [saved] });
      assert.equal(getDevice(second.db, deviceId)?.name, "Quest 02");
      await second.app.inject({ method: "DELETE", url: `/api/devices/${deviceId}` });
      assert.deepEqual((await second.app.inject("/api/notes")).json(), { notes: [saved] });
    } finally { await second.app.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
