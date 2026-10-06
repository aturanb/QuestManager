// Reconnect backoff schedule per brief §25: 1s, 2s, 5s, 10s, 30s, 30s...
export const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000] as const;

export function backoffDelayMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[i]!;
}
