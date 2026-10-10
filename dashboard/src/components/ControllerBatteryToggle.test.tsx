import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControllerBatteryToggle } from "./ControllerBatteryToggle";
import { renderTurkish } from "../test-utils";
import type { ControllerBatteryMonitoringState } from "../types";

const OFF: ControllerBatteryMonitoringState = { enabled: false, availability: "disabled" };
const READY: ControllerBatteryMonitoringState = { enabled: true, availability: "ready" };

function props(over: Partial<Parameters<typeof ControllerBatteryToggle>[0]> = {}) {
  return { state: OFF, pending: false, error: null, onChange: vi.fn(), ...over };
}

describe("ControllerBatteryToggle", () => {
  it("is an accessible switch that reports the server-confirmed position", () => {
    render(<ControllerBatteryToggle {...props()} />);
    const toggle = screen.getByRole("switch", { name: "Controller battery monitoring" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    // The help text is exposed, not just visual: it names the ADB boundary.
    expect(toggle).toHaveAccessibleDescription(/turn on Wireless Debugging/i);
    expect(screen.getByText("Controller batteries")).toBeInTheDocument();
  });

  it("asks for the opposite of the current position", () => {
    const off = props();
    render(<ControllerBatteryToggle {...off} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(off.onChange).toHaveBeenCalledWith(true);

    const on = props({ state: READY });
    render(<ControllerBatteryToggle {...on} />);
    fireEvent.click(screen.getAllByRole("switch")[1]!);
    expect(on.onChange).toHaveBeenCalledWith(false);
  });

  it("does not move or accept clicks while the request is pending", () => {
    const p = props({ state: READY, pending: true });
    render(<ControllerBatteryToggle {...p} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(p.onChange).not.toHaveBeenCalled();
  });

  it("reports a bounded availability state instead of raw server detail", () => {
    render(<ControllerBatteryToggle {...props({ state: { enabled: true, availability: "adb_unavailable" } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("ADB unavailable");
    render(<ControllerBatteryToggle {...props({ state: { enabled: true, availability: "no_devices" } })} />);
    expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("Waiting for a headset");
  });

  it("shows a success state without extra noise, and an admin error when the put fails", () => {
    const { unmount } = render(<ControllerBatteryToggle {...props({ state: READY })} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    unmount();
    render(<ControllerBatteryToggle {...props({ state: READY, error: "Couldn't change controller battery monitoring." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't change controller battery monitoring.");
  });

  it("speaks Turkish with unsuffixed names and the same switch semantics", () => {
    renderTurkish(<ControllerBatteryToggle {...props({ state: READY, error: "Kontrolcü pili izleme değiştirilemedi." })} />);
    const toggle = screen.getByRole("switch", { name: "Kontrolcü pili izleme" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Kontrolcü pilleri")).toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription(/Kablosuz Hata Ayıklama/);
    expect(screen.getByRole("alert")).toHaveTextContent("Kontrolcü pili izleme değiştirilemedi.");
  });

  it("is keyboard operable", () => {
    const p = props();
    render(<ControllerBatteryToggle {...p} />);
    const toggle = screen.getByRole("switch");
    toggle.focus();
    expect(toggle).toHaveFocus();
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);
    expect(p.onChange).toHaveBeenCalledTimes(1);
  });
});
