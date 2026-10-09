#!/usr/bin/env node
// Launch N simulated Quest headsets against the real server.
// Usage: npm run simulator -- --count 8 [--url http://localhost:3000]
//        [--stable] [--behavior succeed|fail|timeout] [--disconnect-after 60]
//        [--no-reconnect]
import { DeviceSim, stableDeviceId } from "./deviceSim.js";

function arg(name: string, fallback: string | null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (name === "no-reconnect" || name === "stable") return "1";
  return process.argv[i + 1] ?? fallback;
}

const count = Math.max(1, Math.min(32, Number(arg("count", "8") ?? "8")));
const httpUrl = arg("url", "http://localhost:3000") ?? "http://localhost:3000";
const wsUrl = httpUrl.replace(/^http/, "ws");
const stable = arg("stable", null) !== null;
const behavior = (arg("behavior", "succeed") ?? "succeed") as "succeed" | "fail" | "timeout";
const launchBehavior = behavior === "timeout" ? "never-complete" : behavior;
const disconnectAfter = Number(arg("disconnect-after", null) ?? "0");
const reconnect = arg("no-reconnect", null) === null;

const sims: DeviceSim[] = [];
for (let i = 1; i <= count; i++) {
  const name = `Quest ${String(i).padStart(2, "0")}`;
  // Spread battery levels so the dashboard shows variety (§13).
  const level = Math.max(5, 100 - i * 9 + (i % 3));
  const sim = new DeviceSim({
    ...(stable ? { deviceId: stableDeviceId(i) } : {}),
    name,
    serverUrl: wsUrl,
    battery: { level, charging: i % 4 === 0 },
    launchBehavior,
    reconnect,
    log: (m) => console.log(`[sim] ${m}`),
  });
  sims.push(sim);
  sim.start();
}

console.log(`[sim] started ${count} simulated headsets against ${httpUrl} (behavior=${behavior}${stable ? ", stable ids" : ""}${reconnect ? "" : ", no reconnect"}). Ctrl+C to stop.`);

if (disconnectAfter > 0) {
  setTimeout(() => {
    console.log(`[sim] --disconnect-after ${disconnectAfter}s: stopping all headsets (watch them go offline ~15s later)`);
    for (const s of sims) s.stop();
    process.exit(0);
  }, disconnectAfter * 1000);
}

process.on("SIGINT", () => {
  for (const s of sims) s.stop();
  process.exit(0);
});
