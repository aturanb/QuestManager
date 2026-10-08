import { describe, expect, it } from "vitest";
import { formatAgo, formatRemaining, remainingMs } from "./time";

describe("formatRemaining", () => {
  it.each([
    [2537000, "42:17"],
    [60000, "1:00"],
    [9000, "0:09"],
    [0, "0:00"],
    [-5000, "0:00"],
  ])("%i ms -> %s", (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});

describe("remainingMs compensates server clock skew", () => {
  it("uses endsAt minus skewed now", () => {
    const endsAt = new Date(1_000_000).toISOString();
    expect(remainingMs(endsAt, 900_000, 50_000)).toBe(50_000);
  });
});

describe("formatAgo", () => {
  it.each([
    [null, "never"],
    [new Date(999_000).toISOString(), "just now"],
    [new Date(930_000).toISOString(), "1 min ago"],
    [new Date(660_000).toISOString(), "5 min ago"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatAgo(iso, 1_000_000, 0)).toBe(expected);
  });
});
