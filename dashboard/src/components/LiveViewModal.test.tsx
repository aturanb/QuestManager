import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LiveViewModal, type LiveViewModalProps } from "./LiveViewModal";
import { LangProvider } from "../i18n";
import { messages } from "../messages";
import { renderTurkish } from "../test-utils";

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
    expect(screen.getByText("Another live view is already running. Stop it first.")).toBeInTheDocument();
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
