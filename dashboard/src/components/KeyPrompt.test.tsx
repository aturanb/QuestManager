import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KeyPrompt } from "./KeyPrompt";
import { LangProvider } from "../i18n";
import { renderTurkish } from "../test-utils";

describe("KeyPrompt", () => {
  it("asks for the admin key in Turkish", () => {
    const onSave = vi.fn();
    renderTurkish(<KeyPrompt initial="" onSave={onSave} />);
    expect(screen.getByRole("dialog", { name: "Yönetici anahtarını girin" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Yönetici anahtarı"), { target: { value: " s3cret " } });
    fireEvent.click(screen.getByRole("button", { name: "Bağlan" }));
    expect(onSave).toHaveBeenCalledWith("s3cret");
  });

  it("lets staff switch language before entering the key", () => {
    render(<KeyPrompt initial="" onSave={vi.fn()} />, { wrapper: LangProvider });
    expect(screen.getByRole("dialog", { name: "Enter the admin key" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TR" }));
    expect(screen.getByRole("dialog", { name: "Yönetici anahtarını girin" })).toBeInTheDocument();
  });
});
