import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeviceCard, type DeviceCardProps, launchBadge } from "./DeviceCard";
import type { Device, Game } from "../types";

const games: Game[] = [
  { id: "beat-saber", name: "Beat Saber", metaAppId: "x", enabled: 1 },
  { id: "walkabout-mini-golf", name: "Walkabout Mini Golf", metaAppId: "y", enabled: 1 },
];

function device(over: Partial<Device> = {}): Device {
  return {
    id: "d1", name: "Quest 01", model: "Quest 3", agentVersion: "0.1.0",
    lastSeenAt: new Date(999_000).toISOString(), batteryLevel: 82, charging: false,
    expectedGame: null, usageAccessGranted: null, foregroundApp: null,
    online: true, session: null, lastCommand: null, installedApps: [], ...over,
  };
}

const NOW = 1_000_000;

function props(over: Partial<DeviceCardProps> = {}): DeviceCardProps {
  return {
    device: device(), games, now: NOW, serverOffsetMs: 0,
    pendingCommandId: null, busy: false, error: null,
    onLaunch: vi.fn(), onLaunchInstalled: vi.fn(), onMapInstalled: vi.fn(),
    onStartSession: vi.fn(), onExtend: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), ...over,
  };
}

describe("launchBadge", () => {
  const d = device();
  it.each([
    ["cmd1", { ...d, lastCommand: { id: "cmd1", status: "sent", error: null } }, "Launching…"],
    ["cmd1", { ...d, lastCommand: { id: "cmd1", status: "received", error: null } }, "Launching…"],
    ["cmd1", { ...d, lastCommand: { id: "cmd1", status: "success", error: null } }, "Launched ✓"],
    ["cmd1", { ...d, lastCommand: { id: "cmd1", status: "failed", error: "TARGET_NOT_INSTALLED" } }, "Failed: TARGET_NOT_INSTALLED"],
    ["cmd1", { ...d, lastCommand: { id: "cmd1", status: "timeout", error: null } }, "Timed out"],
    ["cmd1", { ...d, lastCommand: null }, "Launching…"],
    [null, { ...d, lastCommand: { id: "old", status: "failed", error: "E" } }, "Failed: E"],
    [null, { ...d, lastCommand: { id: "old", status: "timeout", error: null } }, "Timed out"],
    [null, { ...d, lastCommand: { id: "old", status: "success", error: null } }, null],
  ])("pending=%s status=%s -> %s", (pending, dev, expected) => {
    expect(launchBadge(pending as string | null, dev as Device)).toBe(expected);
  });
});

describe("DeviceCard", () => {
  it("renders online state, battery, game, countdown and fires launch", () => {
    const p = props({
      device: device({
        expectedGame: { gameId: "beat-saber", name: "Beat Saber", launchedAt: new Date(900_000).toISOString() },
        session: { id: "s1", startedAt: new Date(900_000).toISOString(), endsAt: new Date(NOW + 42 * 60_000 + 17_000).toISOString(), status: "active" },
      }),
    });
    render(<DeviceCard {...p} />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("Beat Saber", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "42:17 remaining" })).toHaveTextContent("42:17");
    fireEvent.click(screen.getByRole("button", { name: /launch game/i }));
    expect(p.onLaunch).toHaveBeenCalledWith("d1", "beat-saber");
  });

  it("shows the actual foreground game and its uninterrupted open duration", () => {
    render(<DeviceCard {...props({
      device: device({
        usageAccessGranted: true,
        foregroundApp: {
          packageName: "com.TriangleFactory.Breachers",
          name: "Breachers",
          startedAt: new Date(NOW - 12 * 60_000 - 34_000).toISOString(),
        },
      }),
    })} />);

    expect(screen.getByText("Breachers for 12:34")).toBeInTheDocument();
  });

  it("distinguishes missing usage access from no managed game", () => {
    const view = render(<DeviceCard {...props({ device: device({ usageAccessGranted: false }) })} />);
    expect(screen.getByText("Usage access required")).toBeInTheDocument();

    view.rerender(<DeviceCard {...props({ device: device({ usageAccessGranted: true, foregroundApp: null }) })} />);
    expect(screen.getByText("No game open")).toBeInTheDocument();
  });

  it("offline card stays visible with last-seen and disabled launch", () => {
    const p = props({ device: device({ online: false, lastSeenAt: new Date(NOW - 4 * 60_000).toISOString() }) });
    render(<DeviceCard {...p} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Seen 4 min ago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /launch game/i })).toBeDisabled();
  });

  it("expired session stays visible and offers a new session instead of invalid active-session actions", () => {
    const p = props({
      device: device({ session: { id: "s1", startedAt: "t", endsAt: new Date(NOW - 1000).toISOString(), status: "expired" } }),
    });
    render(<DeviceCard {...p} />);
    expect(screen.getByText("Time up")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /extend session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop session/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start 60 minute session/i }));
    expect(p.onStartSession).toHaveBeenCalledWith("d1", 60);
  });

  it("idle card offers 30/60/90/custom starts", () => {
    const p = props();
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /start 60 minute session/i }));
    expect(p.onStartSession).toHaveBeenCalledWith("d1", 60);
  });

  it("shows launch failure badge and action errors", () => {
    const p = props({
      device: device({ lastCommand: { id: "c", status: "failed", error: "TARGET_NOT_INSTALLED" } }),
      error: "Headset offline",
    });
    render(<DeviceCard {...p} />);
    expect(screen.getByRole("status")).toHaveTextContent("Failed: TARGET_NOT_INSTALLED");
    expect(screen.getByRole("alert")).toHaveTextContent("Headset offline");
  });

  it("lists catalog-matched installed apps and launches the selected package", () => {
    const p = props({
      device: device({
        installedApps: [
          { packageName: "com.example.alpha", label: "Alpha", versionName: "1", versionCode: 1, name: "Alpha VR", metaAppId: "11111", source: "catalog" },
          { packageName: "com.example.beta", label: "Beta", versionName: "2", versionCode: 2, name: "Beta VR", metaAppId: "22222", source: "catalog" },
        ],
      }),
    });
    render(<DeviceCard {...p} />);
    fireEvent.change(screen.getByLabelText("Game for Quest 01"), { target: { value: "pkg:com.example.beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));
    expect(p.onLaunchInstalled).toHaveBeenCalledWith("d1", "com.example.beta");
    expect(p.onLaunch).not.toHaveBeenCalled();
    expect(screen.getByText("2 apps on this headset, 2 ready to launch")).toBeInTheDocument();
  });

  it("allows an unmatched installed package to be mapped manually", () => {
    const p = props({
      device: device({
        installedApps: [
          { packageName: "com.example.unknown", label: "Unknown Game", versionName: null, versionCode: null, name: "Unknown Game", metaAppId: null, source: null },
        ],
      }),
    });
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByText("1 app needs a Meta App ID"));
    fireEvent.change(screen.getByLabelText("Meta App ID for Unknown Game"), { target: { value: "1234567890123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping for Unknown Game" }));
    expect(p.onMapInstalled).toHaveBeenCalledWith("d1", "com.example.unknown", "Unknown Game", "1234567890123456");
  });

  it("falls back when the previously selected installed package is removed", () => {
    const onLaunchInstalled = vi.fn();
    const alpha = { packageName: "com.example.alpha", label: "Alpha", versionName: null, versionCode: null, name: "Alpha", metaAppId: "11111", source: "catalog" as const };
    const beta = { packageName: "com.example.beta", label: "Beta", versionName: null, versionCode: null, name: "Beta", metaAppId: "22222", source: "catalog" as const };
    const p = props({
      device: device({ installedApps: [alpha, beta] }),
      onLaunchInstalled,
    });
    const view = render(<DeviceCard {...p} />);
    fireEvent.change(screen.getByLabelText("Game for Quest 01"), { target: { value: `pkg:${beta.packageName}` } });

    view.rerender(<DeviceCard {...p} device={device({ installedApps: [alpha] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));

    expect(onLaunchInstalled).toHaveBeenCalledWith("d1", alpha.packageName);
  });

  it("defaults the picker to the last launched installed app", () => {
    const p = props({
      device: device({
        expectedGame: { gameId: "installed:com.example.beta", name: "Beta VR", launchedAt: new Date(900_000).toISOString() },
        installedApps: [
          { packageName: "com.example.alpha", label: "Alpha", versionName: null, versionCode: null, name: "Alpha VR", metaAppId: "11111", source: "catalog" },
          { packageName: "com.example.beta", label: "Beta", versionName: null, versionCode: null, name: "Beta VR", metaAppId: "22222", source: "catalog" },
        ],
      }),
    });
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));
    expect(p.onLaunchInstalled).toHaveBeenCalledWith("d1", "com.example.beta");
  });

  it("lists a configured game without a real Meta App ID but does not let staff pick it", () => {
    const p = props({
      games: [
        { id: "beat-saber", name: "Beat Saber", metaAppId: "FILL_BEAT_SABER_APP_ID", enabled: 1 },
        { id: "walkabout-mini-golf", name: "Walkabout Mini Golf", metaAppId: "2462678267173943", enabled: 1 },
      ],
    });
    render(<DeviceCard {...p} />);
    expect(screen.getByRole("option", { name: "Beat Saber (needs Meta App ID)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));
    expect(p.onLaunch).toHaveBeenCalledWith("d1", "walkabout-mini-golf");
  });

  it("marks the last five minutes of a session as ending", () => {
    const view = render(<DeviceCard {...props({
      device: device({ session: { id: "s1", startedAt: new Date(NOW - 55 * 60_000).toISOString(), endsAt: new Date(NOW + 4 * 60_000).toISOString(), status: "active" } }),
    })} />);
    expect(view.container.querySelector("article")).toHaveAttribute("data-state", "ending");
    expect(screen.getByRole("timer")).toHaveTextContent("4:00");
  });

  it("does not report a stale foreground app for a disconnected headset", () => {
    render(<DeviceCard {...props({
      device: device({
        online: false,
        usageAccessGranted: true,
        foregroundApp: { packageName: "com.example.alpha", name: "Alpha VR", startedAt: new Date(NOW - 60_000).toISOString() },
      }),
    })} />);
    expect(screen.queryByText(/Alpha VR for/)).not.toBeInTheDocument();
  });

  it("keeps one battery cell lit until the headset is fully flat", () => {
    const view = render(<DeviceCard {...props({ device: device({ batteryLevel: 7 }) })} />);
    expect(view.container.querySelectorAll('.cells i[data-lit="true"]')).toHaveLength(1);
  });

  it("does not offer removal while the headset is online", () => {
    render(<DeviceCard {...props()} />);
    expect(screen.queryByRole("button", { name: /remove quest 01/i })).not.toBeInTheDocument();
  });

  it("removes an offline headset only after confirmation", () => {
    const p = props({ device: device({ online: false }) });
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Quest 01 from the board" }));
    expect(p.onRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/comes back if the headset connects again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Quest 01" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Confirm removing Quest 01" }));
    expect(p.onRemove).toHaveBeenCalledWith("d1");
  });

  it("backs out of removal with Keep or Escape", () => {
    const p = props({ device: device({ online: false }) });
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Quest 01 from the board" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Quest 01" }));
    expect(screen.queryByRole("button", { name: "Confirm removing Quest 01" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Quest 01 from the board" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Keep Quest 01" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Confirm removing Quest 01" })).not.toBeInTheDocument();
    expect(p.onRemove).not.toHaveBeenCalled();
  });

  it("warns that removing a headset mid-session discards the session", () => {
    render(<DeviceCard {...props({
      device: device({ online: false, session: { id: "s1", startedAt: new Date(NOW).toISOString(), endsAt: new Date(NOW + 30 * 60_000).toISOString(), status: "active" } }),
    })} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Quest 01 from the board" }));
    expect(screen.getByText(/running session is discarded too/)).toBeInTheDocument();
  });
});
