export type BatteryState = { level: number; charging: boolean };

/** Clamp battery readings into the 0-100 integer range the protocol requires (§16/§33). */
export function normalizeBattery(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(100, Math.round(level)));
}

/** Very simple discharge/charge model for the simulator. */
export function stepBattery(b: BatteryState, drainPerTick = 1): BatteryState {
  if (b.charging) return { ...b, level: normalizeBattery(b.level + drainPerTick) };
  return { ...b, level: normalizeBattery(b.level - drainPerTick) };
}
