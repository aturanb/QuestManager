import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import { LANG_STORAGE, LangProvider } from "./i18n";

// The server as the board sees it: an empty floor, a wrong admin key, or nothing answering.
function stubServer(mode: "empty" | "unauthorized" | "down") {
  const bodies: Record<string, unknown> = {
    "/api/devices": { serverTime: new Date().toISOString(), devices: [] },
    "/api/games": { games: [] },
    "/api/catalog": { entries: 0, fetchedAt: null, source: "test" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (mode === "down") throw new TypeError("Failed to fetch");
      if (mode === "unauthorized") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      return new Response(JSON.stringify(bodies[path]), { status: 200 });
    })
  );
  // The live feed never opens here, so the header keeps saying it is connecting.
  vi.stubGlobal(
    "WebSocket",
    class {
      onmessage: unknown = null;
      onclose: unknown = null;
      close() {}
    }
  );
}

describe("App", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the board in Turkish and switches back from the top bar", async () => {
    localStorage.setItem(LANG_STORAGE, "tr");
    stubServer("empty");
    render(<App />, { wrapper: LangProvider });

    expect(await screen.findByRole("heading", { name: "Henüz gözlük yok" })).toBeInTheDocument();
    expect(screen.getByText("Bağlanıyor…")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Gözlükler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uygulama listesini güncelle" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading", { name: "No headsets yet" })).toBeInTheDocument();
    expect(localStorage.getItem(LANG_STORAGE)).toBe("en");
  });

  it("asks for the admin key in the picked language", async () => {
    localStorage.setItem(LANG_STORAGE, "tr");
    stubServer("unauthorized");
    render(<App />, { wrapper: LangProvider });
    expect(await screen.findByRole("dialog", { name: "Yönetici anahtarını girin" })).toBeInTheDocument();
  });

  it("re-words an error already on screen when the language changes", async () => {
    stubServer("down");
    render(<App />, { wrapper: LangProvider });
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the CafeQuest server.");
    fireEvent.click(screen.getByRole("button", { name: "TR" }));
    expect(screen.getByRole("alert")).toHaveTextContent("CafeQuest sunucusuna ulaşılamıyor.");
    expect(screen.getByRole("button", { name: "Tekrar dene" })).toBeInTheDocument();
  });
});
