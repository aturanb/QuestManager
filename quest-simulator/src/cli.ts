#!/usr/bin/env node
// Launch N simulated Quest headsets against the real server.
// Usage: npm run simulator -- --count 8 [--url http://localhost:3000]
import { DeviceSim } from "./deviceSim.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const count = Math.max(1, Math.min(32, Number(arg("count", "8"))));
const httpUrl = arg("url", "http://localhost:3000");
const wsUrl = httpUrl.replace(/^http/, "ws");

const sims: DeviceSim[] = [];
for (let i = 1; i <= count; i++) {
  const name = `Quest ${String(i).padStart(2, "0")}`;
  // Spread battery levels so the dashboard shows variety (§13).
  const level = Math.max(5, 100 - i * 9 + (i % 3));
  const sim = new DeviceSim({
    name,
    serverUrl: wsUrl,
    battery: { level, charging: i % 4 === 0 },
    log: (m) => console.log(`[sim] ${m}`),
  });
  sims.push(sim);
  sim.start();
}

console.log(`[sim] started ${count} simulated headsets against ${httpUrl}. Ctrl+C to stop.`);

process.on("SIGINT", () => {
  for (const s of sims) s.stop();
  process.exit(0);
});
