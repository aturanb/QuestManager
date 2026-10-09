import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import type { CastClient, CastClientOptions } from "./casting";
import { LANG_STORAGE, LangProvider } from "./i18n";
import type { ControllerBatteryMonitoringState, Device, Game } from "./types";

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
    supportsScreenCast: false,
    controllerBattery: null,
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

type FakeCastClient = {
  options: CastClientOptions;
  started: number;
  closed: number;
};

/** Records the one client per reservation and lets a test drive its callbacks. */
function fakeCastFactory() {
  const clients: FakeCastClient[] = [];
  const factory = (options: CastClientOptions): CastClient => {
    const client = {
      options,
      started: 0,
      closed: 0,
      start() {
        (client as any).started += 1;
      },
      close() {
        (client as any).closed += 1;
        return Promise.resolve();
      },
    };
    clients.push(client as unknown as FakeCastClient);
    return client as unknown as CastClient;
  };
  return { factory, clients, last: () => clients[clients.length - 1]! };
}

/**
 * A board whose reservation POST stays pending until the test resolves it, so
 * the connecting state and single-reservation rules can be observed.
 */
function stubCastBoard(devices: Device[]) {
  const calls: { path: string; init?: RequestInit }[] = [];
  let resolveCast: ((res: Response) => void) | null = null;
  const fetchMock = vi.fn((input: any, init?: RequestInit) => {
    const path = typeof input === "string" ? input : new URL(input.url).pathname;
    calls.push({ path, init });
    if (path === "/api/casts" && init?.method === "POST") {
      return new Promise<Response>((resolve) => {
        resolveCast = resolve;
      });
    }
    if (path.startsWith("/api/casts/") && init?.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (path.endsWith("/launch-installed") && init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ commandId: "cmd-1", status: "sent" }), { status: 202 }));
    }
    if (path === "/api/devices") {
      return Promise.resolve(
        new Response(JSON.stringify({ serverTime: new Date().toISOString(), devices }), { status: 200 })
      );
    }
    if (path === "/api/games") return Promise.resolve(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    if (path === "/api/catalog") {
      return Promise.resolve(new Response(JSON.stringify({ entries: 0, fetchedAt: null, source: "test" }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
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
  return {
    calls,
    /** A dashboard-ws state push, as when the headset reports a new foreground app. */
    push: (nextDevices: Device[]) =>
      liveSocket?.onmessage?.({
        data: JSON.stringify({ type: "state", payload: { serverTime: new Date().toISOString(), devices: nextDevices } }),
      } as MessageEvent<string>),
    launchCalls: () => calls.filter((call) => call.path.endsWith("/launch-installed")),
    resolveCast: (body: unknown, status = 201) => {
      const resolve = resolveCast;
      resolveCast = null;
      resolve?.(new Response(JSON.stringify(body), { status }));
    },
    castCalls: () => calls.filter((call) => call.path.startsWith("/api/casts")),
  };
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
        device("d2", "Quest 02"),
        device("d3", "Quest 03", { session: active }),
        device("d4", "Quest 04", { online: false }),
      ],
      [],
      (path, init) => {
        if (path === "/api/devices/d1/sessions" && init?.method === "POST") {
          return new Response(JSON.stringify({ session: { ...active, id: "session-1" } }), { status: 201 });
        }
        if (path === "/api/devices/d2/sessions" && init?.method === "POST") {
          return new Response(JSON.stringify({ session: { ...active, id: "session-2" } }), { status: 201 });
        }
      }
    );
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    expect(screen.queryByRole("combobox", { name: "Session length for selected headsets" })).not.toBeInTheDocument();
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Start 60 minute session on 4 selected headsets" }));

    expect(await within(firstCard).findByText("Started 2 sessions; skipped 2 headsets.")).toHaveAttribute("role", "status");
    expect(within(screen.getByRole("article", { name: "Quest 03 online" })).getByRole("alert"))
      .toHaveTextContent("A session is already running on this headset.");
    expect(within(screen.getByRole("article", { name: "Quest 04 offline" })).getByRole("alert"))
      .toHaveTextContent("Headset is offline. Wait for it to reconnect.");

    await waitFor(() => {
      const sessionPosts = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/sessions"));
      expect(sessionPosts.map((call) => call[0])).toEqual([
        "/api/devices/d1/sessions",
        "/api/devices/d2/sessions",
      ]);
      expect(sessionPosts.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
        { minutes: 60 },
        { minutes: 60 },
      ]);
    });
  });

  it("starts an unlimited session on every eligible selected headset", async () => {
    const fetchMock = stubBoard([device("d1", "Quest 01"), device("d2", "Quest 02")], [], (path, init) => {
      if (path.endsWith("/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session: { id: path } }), { status: 201 });
      }
    });
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Start unlimited session on 2 selected headsets" }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/sessions"));
      expect(posts).toHaveLength(2);
      expect(posts.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
        { minutes: null },
        { minutes: null },
      ]);
    });
  });

  it("starts a custom-length session on selected headsets from one selected card", async () => {
    const fetchMock = stubBoard([device("d1", "Quest 01"), device("d2", "Quest 02")], [], (path, init) => {
      if (path.endsWith("/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session: { id: path } }), { status: 201 });
      }
    });
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    const minutes = within(firstCard).getByRole("textbox", { name: "Custom session minutes for 2 selected headsets" });
    const start = within(firstCard).getByRole("button", { name: "Start custom session on 2 selected headsets" });
    fireEvent.change(minutes, { target: { value: "45" } });
    fireEvent.click(start);

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/sessions"));
      expect(posts).toHaveLength(2);
      expect(posts.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
        { minutes: 45 },
        { minutes: 45 },
      ]);
    });
  });

  it("rejects an out-of-range custom session before sending it to selected headsets", async () => {
    const fetchMock = stubBoard([device("d1", "Quest 01"), device("d2", "Quest 02")]);
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    fireEvent.change(within(firstCard).getByRole("textbox", { name: "Custom session minutes for 2 selected headsets" }), {
      target: { value: "1441" },
    });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Start custom session on 2 selected headsets" }));

    expect(await within(firstCard).findByRole("alert")).toHaveTextContent("enter 1–1440 minutes");
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/sessions"))).toHaveLength(0);
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
    expect(screen.queryByRole("combobox", { name: "Game for selected headsets" })).not.toBeInTheDocument();
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    expect(within(firstCard).getByText("Start and Launch apply to 3 selected headsets")).toBeInTheDocument();
    fireEvent.click(within(firstCard).getByRole("button", { name: "Launch Beat Saber on 3 selected headsets" }));

    expect(await within(firstCard).findByText("Sent Beat Saber to 1 headset; skipped 2 headsets.")).toHaveAttribute("role", "status");
    expect(within(screen.getByRole("article", { name: "Quest 01 online" })).getByText("Launching…"))
      .toHaveAttribute("role", "status");
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

  it("launches an installed app from one selected card on every selected headset", async () => {
    const installed = {
      packageName: "com.example.alpha",
      label: "Alpha",
      versionName: "1",
      versionCode: 1,
      name: "Alpha VR",
      metaAppId: "11111",
      source: "catalog" as const,
    };
    const fetchMock = stubBoard(
      [
        device("d1", "Quest 01", { installedApps: [installed] }),
        device("d2", "Quest 02", { installedApps: [installed] }),
      ],
      [],
      (path, init) => {
        if (path.endsWith("/launch-installed") && init?.method === "POST") {
          return new Response(JSON.stringify({ commandId: `command-${path}`, status: "sent" }), { status: 202 });
        }
      }
    );
    render(<App />, { wrapper: LangProvider });

    await screen.findByRole("checkbox", { name: "Select Quest 01" });
    fireEvent.click(screen.getByRole("button", { name: "Select all headsets" }));
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Launch Alpha VR on 2 selected headsets" }));

    await waitFor(() => {
      const launches = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/launch-installed"));
      expect(launches.map((call) => call[0])).toEqual([
        "/api/devices/d1/launch-installed",
        "/api/devices/d2/launch-installed",
      ]);
      expect(launches.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
        { packageName: "com.example.alpha" },
        { packageName: "com.example.alpha" },
      ]);
    });
  });

  it("keeps an unselected card's actions scoped to that headset", async () => {
    const games: Game[] = [{ id: "beat-saber", name: "Beat Saber", metaAppId: "2448060205267927", enabled: 1 }];
    const fetchMock = stubBoard(
      [device("d1", "Quest 01"), device("d2", "Quest 02"), device("d3", "Quest 03")],
      games,
      (path, init) => {
        if (path === "/api/devices/d3/launch" && init?.method === "POST") {
          return new Response(JSON.stringify({ commandId: "command-3", status: "sent" }), { status: 202 });
        }
      }
    );
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Quest 01" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Quest 02" }));
    const thirdCard = screen.getByRole("article", { name: "Quest 03 online" });
    fireEvent.click(within(thirdCard).getByRole("button", { name: "Launch game on Quest 03" }));

    await waitFor(() => {
      const launches = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/launch"));
      expect(launches.map((call) => call[0])).toEqual(["/api/devices/d3/launch"]);
    });
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
    expect(screen.queryByRole("combobox", { name: "Seçili gözlükler için seans süresi" })).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Quest 01 çevrimiçi" });
    expect(within(card).getByText("Başlat ve Oyunu aç işlemleri seçili 1 gözlüğe uygulanır")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Seçili 1 gözlükte 60 dakikalık seans başlat" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Beat Saber oyununu seçili 1 gözlükte aç" })).toBeInTheDocument();
  });

  it("opens the live-view panel before the reservation returns and starts one client", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    const cast = fakeCastFactory();
    render(<App castFactory={cast.factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    const panel = screen.getByRole("complementary", { name: "Live view of Quest 01" });
    expect(within(panel).getByText("Connecting…")).toBeInTheDocument();
    expect(board.castCalls()).toHaveLength(1);

    await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(1));
    expect(cast.last().options.sessionId).toBe("s1");
    expect(cast.last().options.socketUrl).toContain("sessionId=s1");
    expect(cast.last().started).toBe(1);
  });

  it("a double-click cannot reserve two sessions", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    const cast = fakeCastFactory();
    render(<App castFactory={cast.factory} />, { wrapper: LangProvider });

    const button = await screen.findByRole("button", { name: "Request live view of Quest 01" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(board.castCalls()).toHaveLength(1);
    await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(1));
  });

  it("words a busy live view from the server", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    render(<App castFactory={fakeCastFactory().factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    await act(async () => board.resolveCast({ error: "CAST_BUSY" }, 409));
    expect(await screen.findByText("Another live view is already running. Stop it first.")).toBeInTheDocument();
    expect(screen.queryByText("CAST_BUSY")).not.toBeInTheDocument();
  });

  it("words a consent denial from the headset", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    const cast = fakeCastFactory();
    render(<App castFactory={cast.factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(1));
    act(() => cast.last().options.callbacks.onState({ phase: "failed", error: "consent_denied" }));
    expect(await screen.findByText("The customer declined screen sharing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try the live view of Quest 01 again" })).toBeInTheDocument();
  });

  it("closing the modal while connecting releases the reservation exactly once", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    render(<App castFactory={fakeCastFactory().factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the live view of Quest 01" }));
    expect(screen.queryByRole("complementary", { name: "Live view of Quest 01" })).not.toBeInTheDocument();

    await act(async () => board.resolveCast({ sessionId: "s9", status: "reserved" }));
    await waitFor(() => {
      const deletes = board.castCalls().filter((call) => call.init?.method === "DELETE");
      expect(deletes.map((call) => call.path)).toEqual(["/api/casts/s9"]);
    });
  });

  it("retry starts a completely new reservation", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    const cast = fakeCastFactory();
    render(<App castFactory={cast.factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(1));
    act(() => cast.last().options.callbacks.onState({ phase: "failed", error: "peer_disconnected" }));

    fireEvent.click(screen.getByRole("button", { name: "Try the live view of Quest 01 again" }));
    await act(async () => board.resolveCast({ sessionId: "s2", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(2));
    expect(cast.clients.map((client) => client.options.sessionId)).toEqual(["s1", "s2"]);
    expect(cast.clients[0]?.closed).toBe(1);
  });

  it("returns to the key prompt when the cast socket is unauthorized", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    const cast = fakeCastFactory();
    render(<App castFactory={cast.factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(1));
    act(() => cast.last().options.callbacks.onUnauthorized());

    expect(await screen.findByRole("dialog", { name: "Enter the admin key" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Live view of Quest 01" })).not.toBeInTheDocument();
  });

  it("unmount stops an active cast exactly once", async () => {
    const board = stubCastBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    const cast = fakeCastFactory();
    const view = render(<App castFactory={cast.factory} />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
    await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
    await waitFor(() => expect(cast.clients).toHaveLength(1));
    view.unmount();
    expect(cast.last().closed).toBe(1);
  });

  describe("live view with launch options and the reopen prompt", () => {
    const stamp = new Date().toISOString();
    const BEAT = { packageName: "com.fun.beat", name: "Beat Saber", startedAt: stamp };
    const COOK = { packageName: "com.fun.cook", name: "Cook Out", startedAt: stamp };
    const CAFEQUEST = { packageName: "com.cafequest.agent", name: "CafeQuest", startedAt: stamp };
    const installedApps = [BEAT, COOK].map((app) => ({
      packageName: app.packageName,
      label: app.name,
      versionName: null,
      versionCode: null,
      name: app.name,
      metaAppId: "111",
      source: "catalog" as const,
    }));
    const quest = (foregroundApp: Device["foregroundApp"], over: Partial<Device> = {}) =>
      device("d1", "Quest 01", { supportsScreenCast: true, installedApps, foregroundApp, ...over });

    async function startLive(foregroundApp: Device["foregroundApp"]) {
      const board = stubCastBoard([quest(foregroundApp)]);
      const cast = fakeCastFactory();
      render(<App castFactory={cast.factory} />, { wrapper: LangProvider });
      fireEvent.click(await screen.findByRole("button", { name: "Request live view of Quest 01" }));
      await act(async () => board.resolveCast({ sessionId: "s1", status: "reserved" }));
      await waitFor(() => expect(cast.clients).toHaveLength(1));
      act(() => cast.last().options.callbacks.onState({ phase: "live" }));
      return { board, cast };
    }
    const panel = () => screen.getByRole("complementary", { name: "Live view of Quest 01" });

    it("launches an app from the live panel on that headset only", async () => {
      const { board } = await startLive(BEAT);

      fireEvent.change(within(panel()).getByRole("combobox", { name: "Game for Quest 01" }), { target: { value: "pkg:com.fun.cook" } });
      fireEvent.click(within(panel()).getByRole("button", { name: "Launch game on Quest 01" }));

      await waitFor(() => expect(board.launchCalls()).toHaveLength(1));
      expect(board.launchCalls()[0]?.path).toBe("/api/devices/d1/launch-installed");
      expect(JSON.parse(String(board.launchCalls()[0]?.init?.body))).toEqual({ packageName: "com.fun.cook" });
      expect(await within(panel()).findByText("Launching…")).toBeInTheDocument();
      expect(screen.getByRole("complementary", { name: "Live view of Quest 01" })).toBeInTheDocument();
    });

    it("offers to reopen the app that was open before the live view, and opens it on Yes", async () => {
      const { board, cast } = await startLive(BEAT);
      act(() => board.push([quest(CAFEQUEST)]));

      fireEvent.click(within(panel()).getByRole("button", { name: "Stop live view" }));

      expect(screen.queryByRole("complementary", { name: "Live view of Quest 01" })).not.toBeInTheDocument();
      expect(cast.last().closed).toBe(1);
      const prompt = screen.getByRole("alertdialog", { name: "Live view ended" });
      expect(prompt).toHaveTextContent("Reopen Beat Saber on Quest 01?");

      fireEvent.click(within(prompt).getByRole("button", { name: "Open Beat Saber on Quest 01 again" }));
      await waitFor(() => expect(board.launchCalls()).toHaveLength(1));
      expect(JSON.parse(String(board.launchCalls()[0]?.init?.body))).toEqual({ packageName: "com.fun.beat" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("No closes the prompt without launching anything", async () => {
      const { board } = await startLive(BEAT);
      act(() => board.push([quest(CAFEQUEST)]));
      fireEvent.click(within(panel()).getByRole("button", { name: "Close the live view of Quest 01" }));

      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "No" }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(board.launchCalls()).toHaveLength(0);
    });

    it("offers the latest app when staff launched another one during the stream", async () => {
      const { board } = await startLive(BEAT);
      act(() => board.push([quest(COOK)]));
      act(() => board.push([quest(CAFEQUEST)]));

      fireEvent.click(within(panel()).getByRole("button", { name: "Stop live view" }));

      expect(screen.getByRole("alertdialog")).toHaveTextContent("Reopen Cook Out on Quest 01?");
    });

    it("stays quiet when the app is still in front, or nothing but CafeQuest was open", async () => {
      const first = await startLive(BEAT);
      fireEvent.click(within(panel()).getByRole("button", { name: "Stop live view" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(first.board.launchCalls()).toHaveLength(0);
      cleanup();

      await startLive(CAFEQUEST);
      fireEvent.click(within(panel()).getByRole("button", { name: "Stop live view" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("does not ask again on Try again, and a new live view clears an old prompt", async () => {
      const { board, cast } = await startLive(BEAT);
      act(() => board.push([quest(CAFEQUEST)]));
      act(() => cast.last().options.callbacks.onState({ phase: "failed", error: "peer_disconnected" }));
      fireEvent.click(screen.getByRole("button", { name: "Try the live view of Quest 01 again" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      await act(async () => board.resolveCast({ sessionId: "s2", status: "reserved" }));
      await waitFor(() => expect(cast.clients).toHaveLength(2));
      act(() => cast.last().options.callbacks.onState({ phase: "live" }));

      fireEvent.click(within(panel()).getByRole("button", { name: "Stop live view" }));
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Request live view of Quest 01" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("does not offer a live view while the headset is offline or the agent is old", async () => {
    stubBoard([
      device("d1", "Quest 01", { online: false, supportsScreenCast: true }),
      device("d2", "Quest 02", { supportsScreenCast: false }),
    ]);
    render(<App castFactory={fakeCastFactory().factory} />, { wrapper: LangProvider });

    expect(await screen.findByRole("button", { name: "Live view is unavailable while Quest 01 is offline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update the CafeQuest agent on Quest 02 to use live view" })).toBeDisabled();
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
    const firstCard = screen.getByRole("article", { name: "Quest 01 online" });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Start 60 minute session on 2 selected headsets" }));
    expect(await within(firstCard).findByText("Started 2 sessions; skipped 0 headsets.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Quest 02" }));
    expect(screen.getByText("1 headset selected")).toBeInTheDocument();
    expect(screen.queryByText("Started 2 sessions; skipped 0 headsets.")).not.toBeInTheDocument();
  });
});

/** A board whose controller-monitoring PUT stays pending until the test resolves it. */
function stubControllerBoard(
  devices: Device[],
  initial: ControllerBatteryMonitoringState = { enabled: false, availability: "disabled" }
) {
  const calls: { path: string; init?: RequestInit }[] = [];
  let resolvePut: ((res: Response) => void) | null = null;
  let liveSocket: { onmessage: ((event: MessageEvent<string>) => void) | null } | null = null;
  const fetchMock = vi.fn((input: any, init?: RequestInit) => {
    const path = typeof input === "string" ? input : new URL(input.url).pathname;
    calls.push({ path, init });
    if (path === "/api/settings/controller-battery-monitoring") {
      return new Promise<Response>((resolve) => {
        resolvePut = resolve;
      });
    }
    if (path === "/api/devices") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ serverTime: new Date().toISOString(), devices, controllerBatteryMonitoring: initial }),
          { status: 200 }
        )
      );
    }
    if (path === "/api/games") return Promise.resolve(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    if (path === "/api/catalog") {
      return Promise.resolve(new Response(JSON.stringify({ entries: 0, fetchedAt: null, source: "test" }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
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
  return {
    calls,
    puts: () => calls.filter((call) => call.path === "/api/settings/controller-battery-monitoring"),
    socketReady: () => liveSocket !== null,
    resolvePut: (body: unknown, status = 200) => {
      const resolve = resolvePut;
      resolvePut = null;
      resolve?.(new Response(JSON.stringify(body), { status }));
    },
    push: (next: ControllerBatteryMonitoringState, nextDevices: Device[] = devices) => {
      liveSocket?.onmessage?.({
        data: JSON.stringify({
          type: "state",
          payload: { serverTime: new Date().toISOString(), devices: nextDevices, controllerBatteryMonitoring: next },
        }),
      } as MessageEvent<string>);
    },
  };
}

describe("controller battery monitoring switch", () => {
  it("shows the server-confirmed position from REST and follows live pushes", async () => {
    const board = stubControllerBoard([device("d1", "Quest 01")], { enabled: true, availability: "ready" });
    render(<App />, { wrapper: LangProvider });

    const toggle = await screen.findByRole("switch", { name: "Controller battery monitoring" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await act(async () => board.push({ enabled: false, availability: "disabled" }));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("sends exactly one PUT, stays unmoved while pending, then follows the server", async () => {
    const board = stubControllerBoard([device("d1", "Quest 01")]);
    render(<App />, { wrapper: LangProvider });

    const toggle = await screen.findByRole("switch", { name: "Controller battery monitoring" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    // A second click while the first is in flight must not send another request.
    fireEvent.click(toggle);

    await waitFor(() => expect(board.puts()).toHaveLength(1));
    expect(JSON.parse(String(board.puts()[0]!.init!.body))).toEqual({ enabled: true });
    expect(board.puts()[0]!.init!.method).toBe("PUT");
    const pendingSwitch = screen.getByRole("switch");
    expect(pendingSwitch).toBeDisabled();
    expect(pendingSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    await act(async () =>
      board.resolvePut({ controllerBatteryMonitoring: { enabled: true, availability: "ready" } })
    );
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch")).toBeEnabled();
  });

  it("shows a translated alert on failure and leaves every card control working", async () => {
    const board = stubControllerBoard([device("d1", "Quest 01", { supportsScreenCast: true })]);
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("switch", { name: "Controller battery monitoring" }));
    await act(async () => board.resolvePut({ error: "boom" }, 500));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't change controller battery monitoring.");
    // The switch never moved ahead of the server, and no card was disabled by it.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Request live view of Quest 01" })).toBeEnabled();
  });

  it("asks for the admin key again when the server refuses the change", async () => {
    const board = stubControllerBoard([device("d1", "Quest 01")]);
    render(<App />, { wrapper: LangProvider });

    fireEvent.click(await screen.findByRole("switch", { name: "Controller battery monitoring" }));
    await act(async () => board.resolvePut({ error: "unauthorized" }, 401));
    expect(await screen.findByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("speaks Turkish, including the ADB boundary and a failure", async () => {
    const board = stubControllerBoard([device("d1", "Quest 01")]);
    localStorage.setItem(LANG_STORAGE, "tr");
    render(<App />, { wrapper: LangProvider });

    const toggle = await screen.findByRole("switch", { name: "Kontrolcü pili izleme" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(/Kablosuz Hata Ayıklama/);
    fireEvent.click(toggle);
    await act(async () => board.resolvePut({ error: "boom" }, 500));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kontrolcü pili izleme değiştirilemedi.");
  });
});
