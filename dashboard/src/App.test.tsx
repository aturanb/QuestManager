import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { LANG_STORAGE, LangProvider } from "./i18n";
import type { Device, Game } from "./types";

function device(id: string, name: string, over: Partial<Device> = {}): Device {
  return {
    id,
    name,
    model: "Quest 3",
    agentVersion: "0.1.0",
    lastSeenAt: new Date().toISOString(),
    batteryLevel: 80,
    charging: false,
    expectedGame: null,
    usageAccessGranted: true,
    foregroundApp: null,
    online: true,
    session: null,
    lastCommand: null,
    installedApps: [],
    ...over,
  };
}

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

function stubBoard(
  devices: Device[],
  games: Game[] = [],
  respond?: (path: string, init: RequestInit | undefined) => Response | undefined
) {
  const bodies: Record<string, unknown> = {
    "/api/devices": { serverTime: new Date().toISOString(), devices },
    "/api/games": { games },
    "/api/catalog": { entries: 0, fetchedAt: null, source: "test" },
  };
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    const custom = respond?.(path, init);
    if (custom) return custom;
    return new Response(JSON.stringify(bodies[path]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  let liveSocket: { onmessage: ((event: MessageEvent<string>) => void) | null } | null = null;
  vi.stubGlobal(
    "WebSocket",
    class {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: unknown = null;
      constructor() {
        liveSocket = this;
      }
      close() {}
    }
  );
  return Object.assign(fetchMock, {
    socketReady: () => liveSocket !== null,
    push: (nextDevices: Device[]) => liveSocket?.onmessage?.({
      data: JSON.stringify({
        type: "state",
        payload: { serverTime: new Date().toISOString(), devices: nextDevices },
      }),
    } as MessageEvent<string>),
  });
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

  it("selects one headset, selects all, and clears the selection", async () => {
    stubBoard([device("d1", "Quest 01"), device("d2", "Quest 02")]);
    render(<App />, { wrapper: LangProvider });

    const first = await screen.findByRole("checkbox", { name: "Select Quest 01" });
    const second = screen.getByRole("checkbox", { name: "Select Quest 02" });
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();

    fireEvent.click(first);
    expect(first).toBeChecked();
    expect(screen.getByText("1 headset selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    expect(first).toBeChecked();
    expect(second).toBeChecked();
    expect(screen.getByText("2 headsets selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear headset selection" }));
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
  });

  it("drops a selection when that headset disappears from the live board", async () => {
    const first = device("d1", "Quest 01");
    const second = device("d2", "Quest 02");
    const board = stubBoard([first, second]);
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Quest 02" }));
    expect(screen.getByText("1 headset selected")).toBeInTheDocument();
    await waitFor(() => expect(board.socketReady()).toBe(true));
    act(() => board.push([first]));

    expect(screen.queryByRole("checkbox", { name: "Select Quest 02" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("0 headsets selected")).toBeInTheDocument());
  });

  it("starts sessions on eligible selected headsets and reports the skipped cards", async () => {
    const active = {
      id: "session-2",
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      status: "active",
    };
    const fetchMock = stubBoard(
      [
        device("d1", "Quest 01"),
        device("d2", "Quest 02", { session: active }),
        device("d3", "Quest 03", { online: false }),
      ],
      [],
      (path, init) => {
        if (path === "/api/devices/d1/sessions" && init?.method === "POST") {
          return new Response(JSON.stringify({ session: { ...active, id: "session-1" } }), { status: 201 });
        }
      }
    );
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    expect(screen.getByRole("combobox", { name: "Session length for selected headsets" })).toHaveValue("60");
    fireEvent.click(screen.getByRole("button", { name: "Start session on 3 selected headsets" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Started 1 session; skipped 2 headsets.");
    expect(within(screen.getByRole("article", { name: "Quest 02 online" })).getByRole("alert"))
      .toHaveTextContent("A session is already running on this headset.");
    expect(within(screen.getByRole("article", { name: "Quest 03 offline" })).getByRole("alert"))
      .toHaveTextContent("Headset is offline. Wait for it to reconnect.");

    await waitFor(() => {
      const sessionPosts = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/sessions"));
      expect(sessionPosts).toHaveLength(1);
      expect(sessionPosts[0]?.[0]).toBe("/api/devices/d1/sessions");
      expect(JSON.parse(String(sessionPosts[0]?.[1]?.body))).toEqual({ minutes: 60 });
    });
  });

  it("starts an unlimited session on every eligible selected headset", async () => {
    const fetchMock = stubBoard([device("d1", "Quest 01")], [], (path, init) => {
      if (path === "/api/devices/d1/sessions" && init?.method === "POST") {
        return new Response(JSON.stringify({ session: { id: "s1" } }), { status: 201 });
      }
    });
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Quest 01" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Session length for selected headsets" }), {
      target: { value: "unlimited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start session on 1 selected headset" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/sessions"));
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ minutes: null });
    });
  });

  it("validates and starts a custom-length bulk session", async () => {
    const fetchMock = stubBoard([device("d1", "Quest 01")], [], (path, init) => {
      if (path === "/api/devices/d1/sessions" && init?.method === "POST") {
        return new Response(JSON.stringify({ session: { id: "s1" } }), { status: 201 });
      }
    });
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Quest 01" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Session length for selected headsets" }), {
      target: { value: "custom" },
    });
    const minutes = screen.getByRole("textbox", { name: "Custom session minutes for selected headsets" });
    const start = screen.getByRole("button", { name: "Start session on 1 selected headset" });
    fireEvent.change(minutes, { target: { value: "0" } });
    expect(start).toBeDisabled();
    fireEvent.change(minutes, { target: { value: "45" } });
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/sessions"));
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ minutes: 45 });
    });
  });

  it("launches one game on eligible selected headsets and keeps going after a failure", async () => {
    const games: Game[] = [{ id: "beat-saber", name: "Beat Saber", metaAppId: "2448060205267927", enabled: 1 }];
    const fetchMock = stubBoard(
      [
        device("d1", "Quest 01"),
        device("d2", "Quest 02"),
        device("d3", "Quest 03", { online: false }),
      ],
      games,
      (path, init) => {
        if (path === "/api/devices/d1/launch" && init?.method === "POST") {
          return new Response(JSON.stringify({ commandId: "command-1", status: "sent" }), { status: 202 });
        }
        if (path === "/api/devices/d2/launch" && init?.method === "POST") {
          return new Response(JSON.stringify({ error: "app_not_installed" }), { status: 400 });
        }
      }
    );
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    expect(screen.getByRole("combobox", { name: "Game for selected headsets" })).toHaveValue("beat-saber");
    fireEvent.click(screen.getByRole("button", { name: "Launch Beat Saber on 3 selected headsets" }));

    expect(await screen.findByText("Sent Beat Saber to 1 headset; skipped 2 headsets.")).toHaveAttribute("role", "status");
    expect(within(screen.getByRole("article", { name: "Quest 01 online" })).getByRole("status"))
      .toHaveTextContent("Launching…");
    expect(within(screen.getByRole("article", { name: "Quest 02 online" })).getByRole("alert"))
      .toHaveTextContent("That game isn't installed on this headset.");
    expect(within(screen.getByRole("article", { name: "Quest 03 offline" })).getByRole("alert"))
      .toHaveTextContent("Headset is offline. Wait for it to reconnect.");

    const launches = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/launch"));
    expect(launches.map((call) => call[0])).toEqual(["/api/devices/d1/launch", "/api/devices/d2/launch"]);
    expect(launches.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { gameId: "beat-saber" },
      { gameId: "beat-saber" },
    ]);
  });

  it("renders the multi-headset controls in Turkish", async () => {
    localStorage.setItem(LANG_STORAGE, "tr");
    stubBoard(
      [device("d1", "Quest 01")],
      [{ id: "beat-saber", name: "Beat Saber", metaAppId: "2448060205267927", enabled: 1 }]
    );
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("checkbox", { name: "Quest 01 gözlüğünü seç" }));
    expect(screen.getByText("1 gözlük seçildi")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Seçili gözlükler için seans süresi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 seçili gözlükte seans başlat" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Seçili gözlükler için oyun" })).toHaveValue("beat-saber");
    expect(screen.getByRole("button", { name: "Beat Saber oyununu 1 seçili gözlükte aç" })).toBeInTheDocument();
  });

  it("clears a completed bulk summary when the headset selection changes", async () => {
    stubBoard([device("d1", "Quest 01"), device("d2", "Quest 02")], [], (path, init) => {
      if (path.endsWith("/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session: { id: path } }), { status: 201 });
      }
    });
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    fireEvent.click(screen.getByRole("button", { name: "Start session on 2 selected headsets" }));
    expect(await screen.findByText("Started 2 sessions; skipped 0 headsets.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Quest 02" }));
    expect(screen.getByText("1 headset selected")).toBeInTheDocument();
    expect(screen.queryByText("Started 2 sessions; skipped 0 headsets.")).not.toBeInTheDocument();
  });
});
