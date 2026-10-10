import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeviceCard, type DeviceCardProps, launchStatus } from "./DeviceCard";
import type { Device, Game } from "../types";
import { renderTurkish } from "../test-utils";

const games: Game[] = [
  { id: "beat-saber", name: "Beat Saber", metaAppId: "x", enabled: 1 },
  { id: "walkabout-mini-golf", name: "Walkabout Mini Golf", metaAppId: "y", enabled: 1 },
];

function device(over: Partial<Device> = {}): Device {
  return {
    id: "d1", name: "Quest 01", model: "Quest 3", agentVersion: "0.1.0",
    lastSeenAt: new Date(999_000).toISOString(), batteryLevel: 82, charging: false,
    expectedGame: null, usageAccessGranted: null, foregroundApp: null,
    online: true, session: null, lastCommand: null, installedApps: [], supportsScreenCast: false,
    controllerBattery: null, ...over,
  };
}

const NOW = 1_000_000;

function props(over: Partial<DeviceCardProps> = {}): DeviceCardProps {
  return {
    device: device(), games, now: NOW, serverOffsetMs: 0,
    pendingCommandId: null, busy: false, error: null,
    onLaunch: vi.fn(), onLaunchInstalled: vi.fn(), onMapInstalled: vi.fn(),
    onStartSession: vi.fn(), onExtend: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), onRename: vi.fn(), ...over,
  };
}

describe("launchStatus", () => {
  it.each([
    ["cmd1", { id: "cmd1", status: "sent", error: null }, { kind: "launching" }],
    ["cmd1", { id: "cmd1", status: "received", error: null }, { kind: "launching" }],
    ["cmd1", { id: "cmd1", status: "success", error: null }, { kind: "launched" }],
    ["cmd1", { id: "cmd1", status: "failed", error: "TARGET_NOT_INSTALLED" }, { kind: "failed", error: "TARGET_NOT_INSTALLED" }],
    ["cmd1", { id: "cmd1", status: "timeout", error: null }, { kind: "timeout" }],
    ["cmd1", { id: "older", status: "success", error: null }, { kind: "launching" }],
    ["cmd1", null, { kind: "launching" }],
    [null, { id: "old", status: "failed", error: "E" }, { kind: "failed", error: "E" }],
    [null, { id: "old", status: "timeout", error: null }, { kind: "timeout" }],
    [null, { id: "old", status: "success", error: null }, null],
  ])("pending=%s lastCommand=%j -> %j", (pending, lastCommand, expected) => {
    expect(launchStatus(pending, device({ lastCommand }))).toEqual(expected);
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

  it("starts an unlimited session from an idle card", () => {
    const p = props();
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Start unlimited session on Quest 01" }));
    expect(p.onStartSession).toHaveBeenCalledWith("d1", null);
  });

  it("counts an unlimited session up and offers only Stop", () => {
    const p = props({
      device: device({ session: { id: "u1", startedAt: new Date(NOW - 12 * 60_000 - 34_000).toISOString(), endsAt: null, status: "active" } }),
    });
    const view = render(<DeviceCard {...p} />);
    expect(view.container.querySelector("article")).toHaveAttribute("data-state", "unlimited");
    expect(screen.getByRole("timer", { name: "12:34 played" })).toHaveTextContent("12:34");
    expect(screen.queryByRole("button", { name: /extend session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start .* session/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop session on Quest 01" }));
    expect(p.onStop).toHaveBeenCalledWith("u1");
  });

  it("keeps the played time on the freed card after an unlimited session stops", () => {
    const p = props({
      device: device({
        session: { id: "u1", startedAt: new Date(NOW - 90 * 60_000).toISOString(), endsAt: new Date(NOW - 18 * 60_000 + 5_000).toISOString(), status: "stopped" },
      }),
    });
    const view = render(<DeviceCard {...p} />);
    expect(view.container.querySelector("article")).toHaveAttribute("data-state", "free");
    expect(screen.getByText("72:05 played")).toBeInTheDocument();
    expect(screen.getByText("Ready for the next player")).toBeInTheDocument();
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
    expect(screen.getByText("2 installed apps reported by this headset")).toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Installed app IDs (1)"));
    fireEvent.change(screen.getByLabelText("Meta App ID for Unknown Game"), { target: { value: "1234567890123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping for Unknown Game" }));
    expect(p.onMapInstalled).toHaveBeenCalledWith("d1", "com.example.unknown", "Unknown Game", "1234567890123456");
  });

  it("launches a sideloaded app by package and exposes both identifier types", () => {
    const p = props({
      device: device({
        installedApps: [
          { packageName: "com.example.local", label: "Local Game", versionName: "3.0", versionCode: 30, name: "Local Game", metaAppId: null, source: null },
        ],
      }),
    });
    render(<DeviceCard {...p} />);

    expect(screen.getByRole("option", { name: "Local Game (Android package)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));
    expect(p.onLaunchInstalled).toHaveBeenCalledWith("d1", "com.example.local");

    fireEvent.click(screen.getByText("Installed app IDs (1)"));
    expect(screen.getByText("com.example.local")).toBeInTheDocument();
    expect(screen.getByText("Android package")).toBeInTheDocument();
    expect(screen.getByText("No Meta App ID")).toBeInTheDocument();
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

  it("shows the headset model, with a dash when it is unknown", () => {
    const model = () => screen.getByText("Model", { selector: "dt" }).nextElementSibling;
    const view = render(<DeviceCard {...props({ device: device({ model: "Quest 2" }) })} />);
    expect(model()).toHaveTextContent(/^Quest 2$/);

    view.rerender(<DeviceCard {...props({ device: device({ model: null }) })} />);
    expect(model()).toHaveTextContent(/^—$/);
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

  it("renames a headset, online or offline, with the trimmed name", () => {
    for (const online of [true, false]) {
      const p = props({ device: device({ online }) });
      const view = render(<DeviceCard {...p} />);
      fireEvent.click(screen.getByRole("button", { name: "Rename Quest 01" }));
      const field = screen.getByRole("textbox", { name: "New name for Quest 01" });
      expect(field).toHaveValue("Quest 01");
      expect(field).toHaveFocus();
      fireEvent.change(field, { target: { value: "  Bay 3  " } });
      fireEvent.click(screen.getByRole("button", { name: "Save the new name for Quest 01" }));
      expect(p.onRename).toHaveBeenCalledWith("d1", "Bay 3");
      expect(screen.queryByRole("textbox", { name: "New name for Quest 01" })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("submits a new name with Enter and does not offer to save a blank or unchanged one", () => {
    const p = props();
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Quest 01" }));
    const field = screen.getByRole("textbox", { name: "New name for Quest 01" });
    const save = screen.getByRole("button", { name: "Save the new name for Quest 01" });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "Bay 4" } });
    expect(save).toBeEnabled();
    fireEvent.submit(field);
    expect(p.onRename).toHaveBeenCalledWith("d1", "Bay 4");
  });

  it("backs out of renaming with Cancel or Escape without changing anything", () => {
    const p = props();
    render(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Quest 01" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New name for Quest 01" }), { target: { value: "Bay 5" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel renaming Quest 01" }));
    expect(screen.queryByRole("textbox", { name: "New name for Quest 01" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename Quest 01" }));
    expect(screen.getByRole("textbox", { name: "New name for Quest 01" })).toHaveValue("Quest 01");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New name for Quest 01" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New name for Quest 01" })).not.toBeInTheDocument();
    expect(p.onRename).not.toHaveBeenCalled();
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

describe("DeviceCard in Turkish", () => {
  const running = () => ({
    id: "s1",
    startedAt: new Date(900_000).toISOString(),
    endsAt: new Date(NOW + 42 * 60_000 + 17_000).toISOString(),
    status: "active",
  });
  const mapped = { packageName: "com.example.alpha", label: "Alpha", versionName: null, versionCode: null, name: "Alpha VR", metaAppId: "11111", source: "catalog" as const };
  const unmapped = { packageName: "com.example.box", label: "Oyun Kutusu", versionName: null, versionCode: null, name: "Oyun Kutusu", metaAppId: null, source: null };

  it("runs a session with Turkish readout and controls", () => {
    const p = props({
      device: device({
        charging: true,
        expectedGame: { gameId: "beat-saber", name: "Beat Saber", launchedAt: new Date(900_000).toISOString() },
        session: running(),
      }),
    });
    renderTurkish(<DeviceCard {...p} />);
    expect(screen.getByText("Çevrimiçi")).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "42:17 kaldı" })).toBeInTheDocument();
    expect(screen.getByText("toplam 44 dk")).toBeInTheDocument();
    expect(screen.getByText("şarj oluyor")).toBeInTheDocument();
    expect(screen.getByText("Son açılan", { selector: "dt" }).nextElementSibling).toHaveTextContent("Beat Saber");

    fireEvent.click(screen.getByRole("button", { name: "Quest 01 seansını 15 dakika uzat" }));
    expect(p.onExtend).toHaveBeenCalledWith("s1", 15);
    expect(screen.getByRole("button", { name: "Quest 01 seansını durdur" })).toHaveTextContent("Durdur");
    fireEvent.click(screen.getByRole("button", { name: "Quest 01 gözlüğünde oyunu aç" }));
    expect(p.onLaunch).toHaveBeenCalledWith("d1", "beat-saber");
  });

  it.each([
    [{ id: "c1", status: "success", error: null }, "Açıldı ✓", "ok"],
    [{ id: "c1", status: "failed", error: "TARGET_NOT_INSTALLED" }, "Açılamadı: TARGET_NOT_INSTALLED", "bad"],
    [{ id: "c1", status: "timeout", error: null }, "Zaman aşımı", "bad"],
    [{ id: "c1", status: "sent", error: null }, "Açılıyor…", "wait"],
  ])("keeps the launch badge color when the words are Turkish (%j)", (lastCommand, text, tone) => {
    renderTurkish(<DeviceCard {...props({ pendingCommandId: "c1", device: device({ lastCommand }) })} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", tone);
  });

  it("explains an offline headset and asks before removing it", () => {
    const p = props({ device: device({ online: false, lastSeenAt: new Date(NOW - 4 * 60_000).toISOString() }) });
    renderTurkish(<DeviceCard {...p} />);
    expect(screen.getByText("Son görülme 4 dk önce")).toBeInTheDocument();
    expect(screen.getByText("Açık ve kafe Wi-Fi ağına bağlı olduğunu kontrol edin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quest 01 gözlüğünde oyunu aç" })).toHaveAttribute("title", "Gözlük çevrimdışı");

    fireEvent.click(screen.getByRole("button", { name: "Quest 01 gözlüğünü panodan kaldır" }));
    expect(screen.getByText("Quest 01 gözlüğü panodan kaldırılsın mı? Yeniden bağlanırsa panoya geri gelir.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quest 01 gözlüğü kalsın" })).toHaveTextContent("Vazgeç");
    fireEvent.click(screen.getByRole("button", { name: "Quest 01 gözlüğünü kaldırmayı onayla" }));
    expect(p.onRemove).toHaveBeenCalledWith("d1");
  });

  it("says time is up and offers Turkish session lengths", () => {
    const p = props({
      device: device({ session: { id: "s1", startedAt: "t", endsAt: new Date(NOW - 1000).toISOString(), status: "expired" } }),
    });
    renderTurkish(<DeviceCard {...p} />);
    expect(screen.getByText("Süre doldu")).toBeInTheDocument();
    expect(screen.getByText("az önce bitti")).toBeInTheDocument();
    const sixty = screen.getByRole("button", { name: "Quest 01 için 60 dakikalık seans başlat" });
    expect(sixty).toHaveTextContent("60 dk");
    fireEvent.click(sixty);
    expect(p.onStartSession).toHaveBeenCalledWith("d1", 60);
  });

  it("names the open game and distinguishes Meta from Android package IDs", () => {
    const p = props({
      games: [{ id: "beat-saber", name: "Beat Saber", metaAppId: "FILL_BEAT_SABER_APP_ID", enabled: 1 }],
      device: device({
        usageAccessGranted: true,
        foregroundApp: { packageName: mapped.packageName, name: "Alpha VR", startedAt: new Date(NOW - 12 * 60_000 - 34_000).toISOString() },
        installedApps: [mapped, unmapped],
      }),
    });
    renderTurkish(<DeviceCard {...p} />);
    expect(screen.getByText("Alpha VR, 12:34 süredir")).toBeInTheDocument();
    expect(screen.getByText("Bu gözlük 2 yüklü uygulama bildirdi")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beat Saber (Meta App ID gerekli)" })).toBeDisabled();

    fireEvent.click(screen.getByText("Yüklü uygulama kimlikleri (2)"));
    expect(screen.getByText(/“Uygulama listesini güncelle”/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Oyun Kutusu için Meta App ID"), { target: { value: "1234567890123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Oyun Kutusu için eşleştirmeyi kaydet" }));
    expect(p.onMapInstalled).toHaveBeenCalledWith("d1", "com.example.box", "Oyun Kutusu", "1234567890123456");
  });

  // Words that never occur in Turkish: one of them on a Turkish card means a
  // string skipped the message table. Boundaries are Unicode-aware because \b
  // treats ç/ğ/ı/ş as word breaks.
  const ENGLISH = /(?<![\p{L}\p{N}])(the|on|of|for|and|to|is|it|min|minutes?|session|game|headset|left|seen|never|start|stop|launch|remove|keep|save|online|offline|battery|charging|free|ready|open|needs?|unknown|unavailable|unlimited|played)(?![\p{L}\p{N}])/iu;

  // Text node by text node: textContent would glue "Online" to its neighbours.
  function englishOn(container: HTMLElement): string[] {
    const texts: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.textContent ?? "");
    for (const el of container.querySelectorAll("*")) {
      for (const name of ["aria-label", "title", "placeholder", "label"]) texts.push(el.getAttribute(name) ?? "");
    }
    return texts.filter((text) => ENGLISH.test(text));
  }

  it.each<[string, Partial<DeviceCardProps>]>([
    ["free, apps to map, empty picker", { games: [], device: device({ usageAccessGranted: false, installedApps: [unmapped] }) }],
    ["playing with picker groups", { device: device({ usageAccessGranted: null, session: running(), installedApps: [mapped, unmapped] }) }],
    ["ending", { device: device({ usageAccessGranted: true, session: { ...running(), endsAt: new Date(NOW + 60_000).toISOString() } }) }],
    ["time up after a failed launch", { device: device({ lastCommand: { id: "c", status: "failed", error: null }, session: { id: "s1", startedAt: "t", endsAt: new Date(NOW - 5 * 60_000).toISOString(), status: "expired" } }) }],
    ["offline, never connected", { device: device({ online: false, lastSeenAt: null, batteryLevel: null, model: null, session: running() }) }],
    ["unlimited", { device: device({ session: { ...running(), endsAt: null } }) }],
    ["free after an unlimited session", { device: device({ session: { ...running(), endsAt: new Date(NOW - 60_000).toISOString(), status: "stopped" } }) }],
    ["capable headset with a live-view request", { device: device({ supportsScreenCast: true }), onRequestCast: vi.fn() }],
    ["older agent with no live view", { device: device({ supportsScreenCast: false }) }],
  ])("leaves no English on a Turkish card: %s", (_state, over) => {
    const view = renderTurkish(<DeviceCard {...props(over)} />);
    const remove = screen.queryByRole("button", { name: /panodan kaldır/ });
    if (remove) fireEvent.click(remove);
    expect(englishOn(view.container)).toEqual([]);
  });

  it("renames in Turkish with Turkish labels throughout", () => {
    const p = props();
    const view = renderTurkish(<DeviceCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Quest 01 gözlüğünü yeniden adlandır" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Quest 01 için yeni ad" }), { target: { value: "Bay 3" } });
    expect(screen.getByRole("button", { name: "Quest 01 için adı kaydet" })).toHaveTextContent("Kaydet");
    expect(screen.getByRole("button", { name: "Quest 01 için yeniden adlandırmaktan vazgeç" })).toHaveTextContent("Vazgeç");
    expect(englishOn(view.container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Quest 01 için adı kaydet" }));
    expect(p.onRename).toHaveBeenCalledWith("d1", "Bay 3");
  });

  it("requests a live view from an online capable headset", () => {
    const p = props({ device: device({ supportsScreenCast: true }), onRequestCast: vi.fn() });
    render(<DeviceCard {...p} />);
    const button = screen.getByRole("button", { name: "Request live view of Quest 01" });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Request live view");
    fireEvent.click(button);
    expect(p.onRequestCast).toHaveBeenCalledWith("d1");
  });

  it("explains that an offline headset cannot show a live view", () => {
    render(<DeviceCard {...props({ device: device({ online: false, supportsScreenCast: true }) })} />);
    const button = screen.getByRole("button", { name: "Live view is unavailable while Quest 01 is offline" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Headset offline");
  });

  it("tells staff to update the agent on a headset without screen_cast_v1", () => {
    render(<DeviceCard {...props({ device: device({ supportsScreenCast: false }) })} />);
    const button = screen.getByRole("button", { name: "Update the CafeQuest agent on Quest 01 to use live view" });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Update agent to view");
    expect(screen.queryByRole("button", { name: "Request live view of Quest 01" })).not.toBeInTheDocument();
  });

  it("disables every live-view action while this dashboard owns a cast", () => {
    render(<DeviceCard {...props({ device: device({ supportsScreenCast: true }), castBusy: true })} />);
    expect(screen.getByRole("button", { name: "Request live view of Quest 01" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Live view for Quest 01" })).toBeInTheDocument();
  });

  it("speaks Turkish for the live-view action", () => {
    const p = props({ device: device({ supportsScreenCast: true }), onRequestCast: vi.fn() });
    renderTurkish(<DeviceCard {...p} />);
    const button = screen.getByRole("button", { name: "Quest 01 için canlı görüntü iste" });
    fireEvent.click(button);
    expect(p.onRequestCast).toHaveBeenCalledWith("d1");
  });
});

describe("DeviceCard controller batteries", () => {
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("shows nothing extra while controller monitoring is off", () => {
    render(<DeviceCard {...props()} />);
    expect(screen.queryByRole("group", { name: /controller batteries/i })).not.toBeInTheDocument();
    expect(screen.queryByText("L")).not.toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("shows compact left and right readings beside the headset battery", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: {
          left: { level: 100, state: "active" },
          right: { level: 80, state: "active" },
          observedAt: at(30_000),
          status: "available",
          reason: null,
        },
      }),
    })} />);
    const group = screen.getByRole("group", { name: "Controller batteries for Quest 01" });
    expect(group).toBeInTheDocument();
    expect(group).toHaveTextContent("L 100%");
    expect(group).toHaveTextContent("R 80%");
    // The headset battery is untouched by the extra badges.
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("keeps an inactive controller's percentage and marks it last known", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: {
          left: { level: 100, state: "active" },
          right: { level: 80, state: "inactive" },
          observedAt: at(30_000),
          status: "available",
          reason: null,
        },
      }),
    })} />);
    expect(screen.getByLabelText("Right controller 80%, last known")).toHaveTextContent("R 80%");
    expect(screen.getByText("last known")).toBeInTheDocument();
    expect(screen.getByLabelText("Left controller 100%")).not.toHaveTextContent("last known");
  });

  it("keeps the last values with their time when a cycle fails, and says they are stale", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: {
          left: { level: 95, state: "inactive" },
          right: { level: 75, state: "inactive" },
          observedAt: at(4 * 60_000),
          status: "stale",
          reason: "dump_failed",
        },
      }),
    })} />);
    expect(screen.getByText("Updated 4 min ago")).toBeInTheDocument();
    const left = screen.getByLabelText("Left controller 95%, last known");
    expect(left).toHaveAttribute("data-state", "stale");
    expect(left).toHaveTextContent("L 95%");
    expect(left).toHaveTextContent("last known");
  });

  it("renders — with a translated reason when there is no reading at all", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "adb_connect_failed" },
      }),
    })} />);
    const group = screen.getByRole("group", { name: "Controller batteries for Quest 01" });
    expect(group.textContent?.replace(/\s+/g, " ")).toContain("L —");
    expect(group.textContent?.replace(/\s+/g, " ")).toContain("R —");
    expect(group).not.toHaveTextContent(/Updated/);
    expect(screen.getByLabelText("Left controller battery unavailable")).toHaveAttribute(
      "title",
      "Couldn't connect to the headset over ADB"
    );
  });

  it("says a headset with no wireless address needs no raw ADB detail", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "no_wireless_address" },
      }),
    })} />);
    expect(screen.getByLabelText("Right controller battery unavailable")).toHaveAttribute(
      "title",
      "No wireless ADB address for this headset"
    );
  });

  it("keeps the existing headset controls enabled while readings are shown", () => {
    const p = props({
      device: device({
        supportsScreenCast: true,
        session: { id: "s1", startedAt: at(60_000), endsAt: at(-30 * 60_000), status: "active" },
        controllerBattery: {
          left: { level: 100, state: "active" },
          right: { level: 80, state: "active" },
          observedAt: at(30_000),
          status: "available",
          reason: null,
        },
      }),
      onStop: vi.fn(),
    });
    render(<DeviceCard {...p} />);
    expect(screen.getByRole("button", { name: /stop session/i })).toBeEnabled();
    const stop = screen.getByRole("button", { name: /stop session/i });
    fireEvent.click(stop);
    expect(p.onStop).toHaveBeenCalledWith("s1");
  });

  it("speaks Turkish for controller badges and their last-known state", () => {
    renderTurkish(<DeviceCard {...props({
      device: device({
        controllerBattery: {
          left: { level: 100, state: "active" },
          right: { level: 80, state: "inactive" },
          observedAt: at(4 * 60_000),
          status: "stale",
          reason: "dump_failed",
        },
      }),
    })} />);
    expect(screen.getByRole("group", { name: "Quest 01 için kontrolcü pilleri" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sağ kontrolcü %80, son bilinen")).toHaveTextContent("R 80%");
    // A stale cycle marks both hands last-known.
    expect(screen.getAllByText("son bilinen")).toHaveLength(2);
    expect(screen.getByText("Güncellendi: 4 dk önce")).toBeInTheDocument();
  });

  it("translates an unavailable controller in Turkish too", () => {
    renderTurkish(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "parse_failed" },
      }),
    })} />);
    expect(screen.getByLabelText("Sol kontrolcü pili kullanılamıyor")).toHaveAttribute(
      "title",
      "Kontrolcü okuması bilinmeyen bir biçimde geldi"
    );
  });

  it("shows the Wireless Debugging action as visible text, not only a tooltip", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "wireless_debugging_off" },
      }),
    })} />);
    expect(screen.getByText("Tap Allow on the headset to turn on Wireless Debugging")).toBeInTheDocument();
  });

  it("shows the missing one-time setup as visible text", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "agent_permission_missing" },
      }),
    })} />);
    expect(screen.getByText("One-time setup missing on this headset")).toBeInTheDocument();
  });

  it("keeps an offline headset quiet: no visible hint for headset_offline", () => {
    render(<DeviceCard {...props({
      device: device({
        online: false,
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "headset_offline" },
      }),
    })} />);
    expect(screen.queryByText("The headset is not connected")).not.toBeInTheDocument();
  });

  it("adds no hint beside an existing reading", () => {
    render(<DeviceCard {...props({
      device: device({
        controllerBattery: {
          left: { level: 95, state: "inactive" },
          right: { level: 75, state: "inactive" },
          observedAt: at(4 * 60_000),
          status: "stale",
          reason: "wireless_debugging_off",
        },
      }),
    })} />);
    expect(screen.queryByText("Tap Allow on the headset to turn on Wireless Debugging")).not.toBeInTheDocument();
  });

  it("speaks Turkish for both new hints", () => {
    const { rerender } = renderTurkish(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "wireless_debugging_off" },
      }),
    })} />);
    expect(screen.getByText("Kablosuz hata ayıklamayı açmak için gözlükte İzin ver'e dokunun")).toBeInTheDocument();
    rerender(<DeviceCard {...props({
      device: device({
        controllerBattery: { left: null, right: null, observedAt: null, status: "unavailable", reason: "agent_permission_missing" },
      }),
    })} />);
    expect(screen.getByText("Bu gözlükte tek seferlik kurulum eksik")).toBeInTheDocument();
  });
});
