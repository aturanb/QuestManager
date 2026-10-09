import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardSummary } from "./BoardSummary";
import type { Device } from "../types";

const NOW = 1_000_000_000;

function device(id: string, over: Partial<Device> = {}): Device {
  return {
    id, name: `Quest ${id}`, model: "Quest 3", agentVersion: "0.2.0",
    lastSeenAt: null, batteryLevel: null, charging: null, expectedGame: null,
    usageAccessGranted: null, foregroundApp: null, online: true, session: null,
    lastCommand: null, installedApps: [], ...over,
  };
}

function session(endsInMs: number, status = "active") {
  return { id: "s", startedAt: new Date(NOW - 30 * 60_000).toISOString(), endsAt: new Date(NOW + endsInMs).toISOString(), status };
}

describe("BoardSummary", () => {
  it("puts every headset on one line with minutes left, linking to its card", () => {
    render(<BoardSummary now={NOW} serverOffsetMs={0} devices={[
      device("01", { session: session(42 * 60_000 + 30_000) }),
      device("02"),
      device("03", { session: session(-60_000, "expired") }),
      device("04", { online: false }),
    ]} />);

    const playing = screen.getByRole("link", { name: "Quest 01: 42 min left" });
    expect(playing).toHaveTextContent("42");
    expect(playing).toHaveAttribute("href", "#bay-01");
    expect(screen.getByRole("link", { name: "Quest 02: free" })).toHaveTextContent("");
    expect(screen.getByRole("link", { name: "Quest 03: time up" })).toHaveTextContent("!");
    expect(screen.getByRole("link", { name: "Quest 04: offline" })).toBeInTheDocument();
  });

  it("tallies the floor, counting the last minutes as playing and skipping empty states", () => {
    render(<BoardSummary now={NOW} serverOffsetMs={0} devices={[
      device("01", { session: session(10 * 60_000) }),
      device("02", { session: session(2 * 60_000) }),
      device("03"),
    ]} />);
    expect(screen.getByText("2 playing")).toBeInTheDocument();
    expect(screen.getByText("1 free")).toBeInTheDocument();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
    expect(screen.queryByText(/time up/)).not.toBeInTheDocument();
  });

  it("marks an unlimited session with ∞ and counts it as playing", () => {
    render(<BoardSummary now={NOW} serverOffsetMs={0} devices={[
      device("01", { session: { id: "u", startedAt: new Date(NOW - 42 * 60_000 - 30_000).toISOString(), endsAt: null, status: "active" } }),
      device("02", { session: session(10 * 60_000) }),
    ]} />);
    expect(screen.getByRole("link", { name: "Quest 01: unlimited, 42 min played" })).toHaveTextContent("∞");
    expect(screen.getByText("2 playing")).toBeInTheDocument();
  });

  it("shows under a minute as <1 rather than 0", () => {
    render(<BoardSummary now={NOW} serverOffsetMs={0} devices={[device("01", { session: session(30_000) })]} />);
    expect(screen.getByRole("link", { name: "Quest 01: <1 min left" })).toHaveTextContent("<1");
  });
});
