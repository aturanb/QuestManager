import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LANG_STORAGE, LangProvider, initialLang } from "./i18n";
import { LangToggle } from "./components/LangToggle";
import { BoardSummary } from "./components/BoardSummary";

describe("initialLang", () => {
  it.each([
    [null, ["tr-TR", "en-US"], "tr"],
    [null, ["tr"], "tr"],
    [null, ["en-US", "tr-TR"], "en"],
    [null, [], "en"],
    ["en", ["tr-TR"], "en"],
    ["tr", ["en-US"], "tr"],
    ["de", ["tr-TR"], "tr"],
  ])("stored=%s browser=%j -> %s", (stored, browser, expected) => {
    expect(initialLang(stored, browser)).toBe(expected);
  });
});

describe("LangProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.lang = "en";
  });

  // Remounting the provider is what a page refresh does: only browser storage survives it.
  function openBoard() {
    return render(
      <LangProvider>
        <LangToggle />
        <BoardSummary devices={[]} now={0} serverOffsetMs={0} />
      </LangProvider>
    );
  }

  it("switches to Turkish on the spot and is still Turkish after a refresh", () => {
    const page = openBoard();
    expect(screen.getByText("No headsets yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "TR" }));
    expect(screen.getByText("Henüz gözlük yok")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("tr");

    page.unmount();
    openBoard();
    expect(screen.getByText("Henüz gözlük yok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TR" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "false");
  });

  it("remembers a switch back to English", () => {
    localStorage.setItem(LANG_STORAGE, "tr");
    const page = openBoard();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByText("No headsets yet")).toBeInTheDocument();

    page.unmount();
    openBoard();
    expect(screen.getByText("No headsets yet")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("opens in Turkish on a Turkish browser without storing a pick", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["tr-TR", "tr"]);
    openBoard();
    expect(screen.getByText("Henüz gözlük yok")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("tr");
    expect(localStorage.getItem(LANG_STORAGE)).toBeNull();
  });
});
