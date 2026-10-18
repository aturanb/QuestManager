import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResumeAppPrompt } from "./ResumeAppPrompt";
import { LangProvider } from "../i18n";
import { renderTurkish } from "../test-utils";

function props(over: Partial<Parameters<typeof ResumeAppPrompt>[0]> = {}) {
  return {
    deviceName: "Quest 01",
    appName: "Beat Saber",
    canOpen: true,
    onConfirm: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
}

describe("ResumeAppPrompt", () => {
  it("asks whether to reopen the app and confirms with one click", () => {
    const p = props();
    render(<ResumeAppPrompt {...p} />, { wrapper: LangProvider });

    const prompt = screen.getByRole("alertdialog", { name: "Live view ended" });
    expect(prompt).toHaveTextContent("Reopen Beat Saber on Quest 01?");
    expect(prompt).not.toHaveAttribute("aria-modal");
    const yes = screen.getByRole("button", { name: "Open Beat Saber on Quest 01 again" });
    expect(yes).toHaveFocus();
    fireEvent.click(yes);
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses with No or Escape without opening anything", () => {
    const p = props();
    render(<ResumeAppPrompt {...p} />, { wrapper: LangProvider });

    fireEvent.click(screen.getByRole("button", { name: "No" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onDismiss).toHaveBeenCalledTimes(2);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it("cannot open on a headset that went offline", () => {
    render(<ResumeAppPrompt {...props({ canOpen: false })} />, { wrapper: LangProvider });
    const yes = screen.getByRole("button", { name: "Open Beat Saber on Quest 01 again" });
    expect(yes).toBeDisabled();
    expect(yes).toHaveAttribute("title", "Headset offline");
  });

  it("speaks Turkish without suffixing the headset or app name", () => {
    renderTurkish(<ResumeAppPrompt {...props({ deviceName: "Quest 02" })} />);
    const prompt = screen.getByRole("alertdialog", { name: "Canlı görüntü sona erdi" });
    expect(prompt).toHaveTextContent("Quest 02 gözlüğünde Beat Saber yeniden açılsın mı?");
    expect(screen.getByRole("button", { name: "Quest 02 gözlüğünde Beat Saber uygulamasını yeniden aç" })).toHaveTextContent("Evet, aç");
    expect(screen.getByRole("button", { name: "Hayır" })).toBeInTheDocument();
  });
});
