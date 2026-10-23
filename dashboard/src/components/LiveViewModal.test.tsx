import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LiveViewModal, type LiveViewModalProps } from "./LiveViewModal";
import { LangProvider } from "../i18n";
import { messages } from "../messages";
import { renderTurkish } from "../test-utils";
import type { Device, Game } from "../types";

beforeAll(() => {
  // jsdom has no media pipeline; autoplay rejection must never fail the stream.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

function props(over: Partial<LiveViewModalProps> = {}): LiveViewModalProps {
  return {
    deviceName: "Quest 01",
    state: { phase: "connecting" },
    stream: null,
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

function quest(over: Partial<Device> = {}): Device {
  return {
    id: "dev-1",
    name: "Quest 01",
    model: "Quest 3",
    agentVersion: "0.5.0",
    lastSeenAt: new Date().toISOString(),
    batteryLevel: 80,
    charging: false,
    expectedGame: null,
    usageAccessGranted: true,
    foregroundApp: null,
    online: true,
    session: null,
    lastCommand: null,
    installedApps: [
      { packageName: "com.fun.beat", label: "Beat", versionName: null, versionCode: null, name: "Beat Saber", metaAppId: "111", source: "catalog" },
      { packageName: "com.fun.cook", label: "Cook", versionName: null, versionCode: null, name: "Cook Out", metaAppId: "222", source: "catalog" },
    ],
    supportsScreenCast: true,
    controllerBattery: null,
    ...over,
  };
}

const cafeGames: Game[] = [{ id: "g-1", name: "Café Pong", metaAppId: "333", enabled: true }];

function launchProps(over: Partial<NonNullable<LiveViewModalProps["launch"]>> = {}): NonNullable<LiveViewModalProps["launch"]> {
  return {
    device: quest(),
    games: cafeGames,
    pendingCommandId: null,
    busy: false,
    error: null,
    onLaunch: vi.fn(),
    onLaunchInstalled: vi.fn(),
    ...over,
  };
}

describe("LiveViewModal launch options", () => {
  it("launches an installed app on the headset without leaving the live view", () => {
    const launch = launchProps();
    render(<LiveViewModal {...props({ state: { phase: "live" }, launch })} />, { wrapper: LangProvider });

    fireEvent.change(screen.getByRole("combobox", { name: "Game for Quest 01" }), { target: { value: "pkg:com.fun.cook" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));

    expect(launch.onLaunchInstalled).toHaveBeenCalledWith("dev-1", "com.fun.cook");
    expect(launch.onLaunch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Live screen of Quest 01")).toBeInTheDocument();
  });

  it("launches a café game from the same picker", () => {
    const launch = launchProps();
    render(<LiveViewModal {...props({ state: { phase: "live" }, launch })} />, { wrapper: LangProvider });

    fireEvent.change(screen.getByRole("combobox", { name: "Game for Quest 01" }), { target: { value: "game:g-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch game on Quest 01" }));

    expect(launch.onLaunch).toHaveBeenCalledWith("dev-1", "g-1");
  });

  it("stays out of the way while minimized and when no launch data is given", () => {
    const view = render(<LiveViewModal {...props({ state: { phase: "live" }, launch: launchProps() })} />, { wrapper: LangProvider });
    fireEvent.click(screen.getByRole("button", { name: "Minimize the live view of Quest 01" }));
    expect(screen.queryByRole("combobox", { name: "Game for Quest 01" })).not.toBeInTheDocument();
    view.unmount();

    render(<LiveViewModal {...props({ state: { phase: "live" } })} />, { wrapper: LangProvider });
    expect(screen.queryByRole("combobox", { name: "Game for Quest 01" })).not.toBeInTheDocument();
  });

  it("is offered in a failed session too, so staff can still start an app", () => {
    render(<LiveViewModal {...props({ state: { phase: "failed", error: "consent_denied" }, launch: launchProps() })} />, { wrapper: LangProvider });
    expect(screen.getByRole("button", { name: "Launch game on Quest 01" })).toBeEnabled();
  });

  it("cannot launch while the headset is offline or a launch is in flight", () => {
    const view = render(
      <LiveViewModal {...props({ state: { phase: "live" }, launch: launchProps({ device: quest({ online: false }) }) })} />,
      { wrapper: LangProvider }
    );
    expect(screen.getByRole("button", { name: "Launch game on Quest 01" })).toBeDisabled();
    view.unmount();

    render(<LiveViewModal {...props({ state: { phase: "live" }, launch: launchProps({ busy: true }) })} />, { wrapper: LangProvider });
    expect(screen.getByRole("button", { name: "Launch game on Quest 01" })).toBeDisabled();
  });

  it("reports the launch result and a failed request next to the picker", () => {
    const device = quest({ lastCommand: { id: "cmd-1", status: "success", error: null } });
    render(
      <LiveViewModal {...props({ state: { phase: "live" }, launch: launchProps({ device, pendingCommandId: "cmd-1", error: "Could not reach the server" }) })} />,
      { wrapper: LangProvider }
    );
    expect(screen.getByText("Launched ✓")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("speaks Turkish in the launch section", () => {
    renderTurkish(<LiveViewModal {...props({ deviceName: "Quest 01", state: { phase: "live" }, launch: launchProps() })} />);
    expect(screen.getByRole("combobox", { name: "Quest 01 için oyun" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quest 01 gözlüğünde oyunu aç" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Uygulama aç" })).toBeInTheDocument();
  });
});

describe("LiveViewModal", () => {
  it("is a non-modal live region that leaves the dashboard available", () => {
    render(<LiveViewModal {...props()} />, { wrapper: LangProvider });
    const panel = screen.getByRole("complementary", { name: "Live view of Quest 01" });
    expect(panel).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog", { name: "Live view of Quest 01" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting…");
    expect(screen.getByText("Reserving the live view and reaching the headset.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop live view/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close the live view of Quest 01" })).toHaveTextContent("Close");
  });

  it("minimizes the picture without ending the live session and expands it again", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    render(<LiveViewModal {...props({ state: { phase: "live" }, stream })} />, { wrapper: LangProvider });

    fireEvent.click(screen.getByRole("button", { name: "Minimize the live view of Quest 01" }));
    expect(screen.queryByLabelText("Live screen of Quest 01")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live");

    fireEvent.click(screen.getByRole("button", { name: "Expand the live view of Quest 01" }));
    expect(screen.getByLabelText("Live screen of Quest 01")).toBeInTheDocument();
  });

  it("shows the picture again after minimizing and expanding the live view", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    render(<LiveViewModal {...props({ state: { phase: "live" }, stream })} />, { wrapper: LangProvider });

    fireEvent.click(screen.getByRole("button", { name: "Minimize the live view of Quest 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand the live view of Quest 01" }));

    const video = screen.getByLabelText("Live screen of Quest 01") as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  describe("full screen", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    let fullscreenElement: Element | null = null;
    let requestFullscreen: ReturnType<typeof vi.fn>;
    let exitFullscreen: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fullscreenElement = null;
      requestFullscreen = vi.fn(function (this: Element) {
        fullscreenElement = this;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      });
      exitFullscreen = vi.fn(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      });
      Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
      Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    });

    afterEach(() => {
      for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) {
        Reflect.deleteProperty(document, key);
      }
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    });

    it("shows the picture full screen and back, keeping the stream running", () => {
      const p = props({ state: { phase: "live" }, stream });
      render(<LiveViewModal {...p} />, { wrapper: LangProvider });

      fireEvent.click(screen.getByRole("button", { name: "View the live screen of Quest 01 full screen" }));
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      const frame = requestFullscreen.mock.contexts[0] as HTMLElement;
      expect(frame).toContainElement(screen.getByLabelText("Live screen of Quest 01"));

      fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "View the live screen of Quest 01 full screen" })).toBeInTheDocument();
      expect(p.onStop).not.toHaveBeenCalled();
      expect(p.onClose).not.toHaveBeenCalled();
    });

    it("follows the browser leaving full screen on its own", () => {
      render(<LiveViewModal {...props({ state: { phase: "live" }, stream })} />, { wrapper: LangProvider });
      fireEvent.click(screen.getByRole("button", { name: "View the live screen of Quest 01 full screen" }));
      expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();

      act(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      });
      expect(screen.getByRole("button", { name: "View the live screen of Quest 01 full screen" })).toBeInTheDocument();
    });

    it("does not close the viewer when Escape only leaves full screen", () => {
      const p = props({ state: { phase: "live" }, stream });
      render(<LiveViewModal {...p} />, { wrapper: LangProvider });
      fireEvent.click(screen.getByRole("button", { name: "View the live screen of Quest 01 full screen" }));

      fireEvent.keyDown(window, { key: "Escape" });
      expect(p.onClose).not.toHaveBeenCalled();
    });

    it("is only offered with a live picture and where the browser supports it", () => {
      const view = render(<LiveViewModal {...props({ state: { phase: "awaiting_approval" } })} />, { wrapper: LangProvider });
      expect(screen.queryByRole("button", { name: /full screen/ })).not.toBeInTheDocument();
      view.unmount();

      Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
      render(<LiveViewModal {...props({ state: { phase: "live" }, stream })} />, { wrapper: LangProvider });
      expect(screen.queryByRole("button", { name: /full screen/ })).not.toBeInTheDocument();
    });

    it("speaks Turkish", () => {
      renderTurkish(<LiveViewModal {...props({ deviceName: "Quest 02", state: { phase: "live" }, stream })} />);
      expect(screen.getByRole("button", { name: "Quest 02 canlı ekranını tam ekran yap" })).toHaveTextContent("Tam ekran");
    });
  });

  it("asks staff to have the customer approve on the headset", () => {
    render(<LiveViewModal {...props({ state: { phase: "awaiting_approval" } })} />, { wrapper: LangProvider });
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for approval on the headset");
    expect(screen.getByText("The sharing prompt opened on the headset. Ask the customer to approve it.")).toBeInTheDocument();
  });

  it("shows the negotiating phase while WebRTC starts", () => {
    render(<LiveViewModal {...props({ state: { phase: "negotiating" } })} />, { wrapper: LangProvider });
    expect(screen.getByRole("status")).toHaveTextContent("Starting video…");
    expect(screen.getByText("The headset approved the request. Video is starting.")).toBeInTheDocument();
  });

  it("offers Stop while live and attaches the remote stream to the video element", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    const p = props({ state: { phase: "live" }, stream });
    render(<LiveViewModal {...p} />, { wrapper: LangProvider });
    expect(screen.getByRole("status")).toHaveTextContent("Live");
    expect(screen.getByText("Showing Quest 01")).toBeInTheDocument();
    const video = screen.getByLabelText("Live screen of Quest 01") as HTMLVideoElement;
    expect(video).toHaveAttribute("autoplay");
    expect(video.srcObject).toBe(stream);
    fireEvent.click(screen.getByRole("button", { name: "Stop live view" }));
    expect(p.onStop).toHaveBeenCalledTimes(1);
  });

  it("clears the video source on unmount", () => {
    const stream = { id: "remote-stream" } as unknown as MediaStream;
    const view = render(<LiveViewModal {...props({ state: { phase: "live" }, stream })} />, { wrapper: LangProvider });
    const video = screen.getByLabelText("Live screen of Quest 01") as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    view.unmount();
    expect(video.srcObject).toBeNull();
  });

  it("shows non-terminal no-picture guidance after ten seconds live without a track", () => {
    vi.useFakeTimers();
    try {
      render(<LiveViewModal {...props({ state: { phase: "live" } })} />, { wrapper: LangProvider });
      expect(screen.queryByText("No picture yet; this game may block screen capture.")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText("No picture yet; this game may block screen capture.")).toBeInTheDocument();
      expect(screen.getByText("Live")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains a failed session with a bounded code and offers retry", () => {
    const p = props({ state: { phase: "failed", error: "consent_denied" } });
    render(<LiveViewModal {...p} />, { wrapper: LangProvider });
    expect(screen.getByRole("status")).toHaveTextContent("Live view failed");
    expect(screen.getByText("The customer declined screen sharing.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try the live view of Quest 01 again" }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Stop live view/ })).not.toBeInTheDocument();
  });

  it("never shows a raw platform error string", () => {
    render(<LiveViewModal {...props({ state: { phase: "failed", error: "CAST_BUSY" } })} />, { wrapper: LangProvider });
    expect(screen.getByText("This headset is already being viewed. Stop its current live view first.")).toBeInTheDocument();
    expect(screen.queryByText("CAST_BUSY")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const p = props();
    render(<LiveViewModal {...p} />, { wrapper: LangProvider });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("speaks Turkish without suffixing the headset name", () => {
    renderTurkish(
      <LiveViewModal
        {...props({ deviceName: "Quest 02", state: { phase: "awaiting_approval" } })}
      />
    );
    expect(screen.getByRole("complementary", { name: "Quest 02 canlı görüntüsü" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gözlükte onay bekleniyor");
    expect(screen.getByText("Paylaşım penceresi gözlükte açıldı. Müşteriden onaylamasını isteyin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quest 02 canlı görüntüsünü kapat" })).toHaveTextContent("Kapat");
  });

  it("has Turkish wording for every failure code", () => {
    const codes = [
      "consent_denied",
      "approval_timeout",
      "negotiation_timeout",
      "projection_stopped",
      "peer_disconnected",
      "capture_failed",
      "internal_error",
      "DEVICE_NOT_FOUND",
      "DEVICE_OFFLINE",
      "CAST_UNSUPPORTED",
      "CAST_BUSY",
      "REQUEST_FAILED",
    ] as const;
    for (const code of codes) {
      const turkish = messages.tr.cast.errors[code];
      expect(turkish, code).toBeTruthy();
      expect(turkish, code).not.toBe(messages.en.cast.errors[code]);
      const view = renderTurkish(<LiveViewModal {...props({ state: { phase: "failed", error: code } })} />);
      expect(screen.getByText(turkish)).toBeInTheDocument();
      view.unmount();
    }
  });
});
