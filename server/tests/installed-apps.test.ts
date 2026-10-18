import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { getGameByPackage, upsertDevice } from "../src/store.js";

const dir = mkdtempSync(join(tmpdir(), "cq-installed-apps-"));
const catalogPath = join(dir, "catalog.json");
writeFileSync(catalogPath, JSON.stringify([
  { appName: "Breachers", packageName: "com.TriangleFactory.Breachers", id: "5740397619319389" },
]));

const { app, db, hub } = await buildApp({
  dbPath: ":memory:",
  port: 0,
  host: "127.0.0.1",
  appCatalogPath: catalogPath,
});
after(() => app.close());

const deviceId = randomUUID();
upsertDevice(db, { id: deviceId, name: "Quest Test", model: "Quest 3", agentVersion: "0.1.0" });

const sent: string[] = [];
const socket = {
  send(value: string) { sent.push(value); },
  close() {},
};
hub.addAgentSocket(deviceId, socket as any, ["launch_android_package"]);

test("installed_apps inventory is persisted and catalog matches appear in snapshots", async () => {
  hub.handleAgentMessage(deviceId, socket as any, JSON.stringify({
    type: "installed_apps",
    protocolVersion: 1,
    deviceId,
    scannedAt: "2026-10-08T12:00:00.000Z",
    apps: [
      { packageName: "com.TriangleFactory.Breachers", label: "Breachers", versionName: "1.0", versionCode: 10 },
      { packageName: "com.example.unknown", label: "Unknown Game", versionName: null, versionCode: null },
    ],
  }));

  const response = await app.inject({ method: "GET", url: "/api/devices" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  const installed = body.devices[0].installedApps;
  assert.equal(installed.length, 2);
  assert.deepEqual(installed[0], {
    packageName: "com.TriangleFactory.Breachers",
    label: "Breachers",
    versionName: "1.0",
    versionCode: 10,
    name: "Breachers",
    metaAppId: "5740397619319389",
    source: "catalog",
  });
  assert.equal(installed[1].packageName, "com.example.unknown");
  assert.equal(installed[1].metaAppId, null);
  assert.equal(installed[1].source, null);
});

test("a catalog-matched installed app launches by Android package on a capable agent", async () => {
  const sentBeforeLaunch = sent.length;
  const launch = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/launch-installed`,
    payload: { packageName: "com.TriangleFactory.Breachers" },
  });

  assert.equal(launch.statusCode, 202);
  const command = sent
    .slice(sentBeforeLaunch)
    .map((value) => JSON.parse(value))
    .find((value) => value.type === "command");
  assert.equal(command.payload.packageName, "com.TriangleFactory.Breachers");
  assert.equal(command.payload.gameName, "Breachers");
  assert.equal("metaAppId" in command.payload, false);
});

test("an unmatched sideloaded app launches by Android package name", async () => {
  const sentBeforeLaunch = sent.length;
  const launch = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/launch-installed`,
    payload: { packageName: "com.example.unknown" },
  });

  assert.equal(launch.statusCode, 202);
  const command = sent
    .slice(sentBeforeLaunch)
    .map((value) => JSON.parse(value))
    .find((value) => value.type === "command");
  assert.equal(command.payload.packageName, "com.example.unknown");
  assert.equal(command.payload.gameName, "Unknown Game");
  assert.equal("metaAppId" in command.payload, false);
});

test("an older connected agent is told to update before a package launch", async () => {
  const oldDeviceId = randomUUID();
  upsertDevice(db, { id: oldDeviceId, name: "Older Quest", model: "Quest 3", agentVersion: "0.3.0" });
  const oldSocket = { send() {}, close() {} };
  hub.addAgentSocket(oldDeviceId, oldSocket as any);
  hub.handleAgentMessage(oldDeviceId, oldSocket as any, JSON.stringify({
    type: "installed_apps",
    protocolVersion: 1,
    deviceId: oldDeviceId,
    scannedAt: "2026-10-09T12:00:00.000Z",
    apps: [
      { packageName: "com.example.local", label: "Local App", versionName: "1.0", versionCode: 1 },
    ],
  }));

  const launch = await app.inject({
    method: "POST",
    url: `/api/devices/${oldDeviceId}/launch-installed`,
    payload: { packageName: "com.example.local" },
  });

  assert.equal(launch.statusCode, 409);
  assert.equal(launch.json().error, "agent_update_required");
});

test("a catalog-matched app keeps the Meta fallback for an older agent", async () => {
  const oldDeviceId = randomUUID();
  upsertDevice(db, { id: oldDeviceId, name: "Older Quest", model: "Quest 3", agentVersion: "0.3.0" });
  const oldSent: string[] = [];
  const oldSocket = {
    send(value: string) { oldSent.push(value); },
    close() {},
  };
  hub.addAgentSocket(oldDeviceId, oldSocket as any);
  hub.handleAgentMessage(oldDeviceId, oldSocket as any, JSON.stringify({
    type: "installed_apps",
    protocolVersion: 1,
    deviceId: oldDeviceId,
    scannedAt: "2026-10-09T12:00:00.000Z",
    apps: [
      { packageName: "com.TriangleFactory.Breachers", label: "Breachers", versionName: "1.0", versionCode: 1 },
    ],
  }));

  const launch = await app.inject({
    method: "POST",
    url: `/api/devices/${oldDeviceId}/launch-installed`,
    payload: { packageName: "com.TriangleFactory.Breachers" },
  });

  assert.equal(launch.statusCode, 202);
  const command = oldSent
    .map((value) => JSON.parse(value))
    .find((value) => value.type === "command");
  assert.equal(command.payload.metaAppId, "5740397619319389");
  assert.equal("packageName" in command.payload, false);

  const configured = await app.inject({
    method: "PUT",
    url: "/api/games/legacy-breachers",
    payload: {
      name: "Breachers Legacy",
      metaAppId: "5740397619319389",
      packageName: "com.TriangleFactory.Breachers",
    },
  });
  assert.equal(configured.statusCode, 200);
  const sentBeforeConfiguredLaunch = oldSent.length;
  const configuredLaunch = await app.inject({
    method: "POST",
    url: `/api/devices/${oldDeviceId}/launch`,
    payload: { gameId: "legacy-breachers" },
  });
  assert.equal(configuredLaunch.statusCode, 202);
  const configuredCommand = oldSent
    .slice(sentBeforeConfiguredLaunch)
    .map((value) => JSON.parse(value))
    .find((value) => value.type === "command");
  assert.equal(configuredCommand.payload.metaAppId, "5740397619319389");
  assert.equal("packageName" in configuredCommand.payload, false);
});

test("admin can map an unknown installed package without forcing Meta launch", async () => {
  const mapped = await app.inject({
    method: "PUT",
    url: `/api/devices/${deviceId}/apps/com.example.unknown`,
    payload: { name: "My Local Game", metaAppId: "1234567890123456" },
  });
  assert.equal(mapped.statusCode, 200);
  assert.equal(mapped.json().app.source, "manual");

  const conflictingGame = await app.inject({
    method: "PUT",
    url: "/api/games/another-game",
    payload: {
      name: "Conflicting Game",
      metaAppId: "9999999999999999",
      packageName: "com.example.unknown",
    },
  });
  assert.equal(conflictingGame.statusCode, 409);
  assert.equal(conflictingGame.json().error, "package_already_mapped");

  const sentBeforeLaunch = sent.length;
  const launch = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/launch-installed`,
    payload: { packageName: "com.example.unknown" },
  });
  assert.equal(launch.statusCode, 202);
  const command = sent
    .slice(sentBeforeLaunch)
    .map((value) => JSON.parse(value))
    .find((value) => value.type === "command");
  assert.equal(command.payload.packageName, "com.example.unknown");
  assert.equal(command.payload.gameName, "My Local Game");
  assert.equal("metaAppId" in command.payload, false);

  const manualGame = getGameByPackage(db, "com.example.unknown");
  assert.ok(manualGame);
  const sentBeforeConfiguredLaunch = sent.length;
  const configuredLaunch = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/launch`,
    payload: { gameId: manualGame.id },
  });
  assert.equal(configuredLaunch.statusCode, 202);
  const configuredCommand = sent
    .slice(sentBeforeConfiguredLaunch)
    .map((value) => JSON.parse(value))
    .find((value) => value.type === "command");
  assert.equal(configuredCommand.payload.packageName, "com.example.unknown");
  assert.equal("metaAppId" in configuredCommand.payload, false);

  const otherDeviceId = randomUUID();
  upsertDevice(db, { id: otherDeviceId, name: "Other Quest", model: "Quest 3", agentVersion: "0.1.0" });
  hub.addAgentSocket(otherDeviceId, { send() {}, close() {} } as any);
  const crossDeviceLaunch = await app.inject({
    method: "POST",
    url: `/api/devices/${otherDeviceId}/launch`,
    payload: { gameId: manualGame.id },
  });
  assert.equal(crossDeviceLaunch.statusCode, 400);
  assert.equal(crossDeviceLaunch.json().error, "app_not_installed");
});

test("launch-installed rejects packages not reported by that headset", async () => {
  const response = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/launch-installed`,
    payload: { packageName: "com.example.notinstalled" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "app_not_installed");
});

test("Meta system packages a headset reports are left out of its inventory", async () => {
  const questId = randomUUID();
  upsertDevice(db, { id: questId, name: "Quest Meta Apps", model: "Quest 3", agentVersion: "0.1.0" });
  const questSocket = { send() {}, close() {} };
  hub.addAgentSocket(questId, questSocket as any);
  hub.handleAgentMessage(questId, questSocket as any, JSON.stringify({
    type: "installed_apps",
    protocolVersion: 1,
    deviceId: questId,
    scannedAt: "2026-10-09T12:00:00.000Z",
    apps: [
      { packageName: "com.TriangleFactory.Breachers", label: "Breachers", versionName: "1.0", versionCode: 10 },
      { packageName: "com.meta.handseducationmodule", label: "handseducationmodule", versionName: null, versionCode: null },
      { packageName: "com.oculus.accountscenter", label: "Accounts Center", versionName: null, versionCode: null },
    ],
  }));

  const response = await app.inject({ method: "GET", url: "/api/devices" });
  const device = response.json().devices.find((d: any) => d.id === questId);
  assert.deepEqual(device.installedApps.map((a: any) => a.packageName), ["com.TriangleFactory.Breachers"]);
});
