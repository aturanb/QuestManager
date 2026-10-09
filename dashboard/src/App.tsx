import { useCallback, useEffect, useRef, useState } from "react";
import type { Device, Game, Snapshot } from "./types";
import {
  ApiError,
  castSocketUrl,
  connectStateSocket,
  deleteDevice,
  extendSession,
  getCatalogStatus,
  getGames,
  getSnapshot,
  launchGame,
  launchInstalledApp,
  mapInstalledApp,
  refreshCatalog,
  requestCast,
  startSession,
  stopCast,
  stopSession,
} from "./api";
import { CastClient, type CastClientOptions, type CastViewState } from "./casting";
import { BoardSummary } from "./components/BoardSummary";
import { CatalogButton } from "./components/CatalogButton";
import { DeviceCard } from "./components/DeviceCard";
import { KeyPrompt } from "./components/KeyPrompt";
import { LangToggle } from "./components/LangToggle";
import { LiveViewModal } from "./components/LiveViewModal";
import { SelectionBar } from "./components/SelectionBar";
import { castRequestError, friendlyError } from "./errors";
import { useI18n } from "./i18n";

const KEY_STORAGE = "cq-admin-key";

type BulkResult =
  | { originDeviceId: string; action: "session"; succeeded: number; failed: number }
  | { originDeviceId: string; action: "launch"; gameName: string; succeeded: number; failed: number };

/** The one local live-view flow: selected headset, view state, and remote stream. */
type ActiveLiveView = {
  deviceId: string;
  deviceName: string;
  state: CastViewState;
  stream: MediaStream | null;
};

export type AppProps = {
  /** Injected in tests; defaults to the real signaling/WebRTC client. */
  castFactory?: (options: CastClientOptions) => CastClient;
};

export function App({ castFactory }: AppProps = {}) {
  const { t } = useI18n();
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [keyRequired, setKeyRequired] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [wsLive, setWsLive] = useState(false);
  // Errors stay raw until render, so switching language re-words one already on screen.
  const [globalError, setGlobalError] = useState<unknown>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, unknown>>({});
  const [catalog, setCatalog] = useState<{ entries: number; fetchedAt: string | null } | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const wsRef = useRef<{ close: () => void } | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const [liveView, setLiveView] = useState<ActiveLiveView | null>(null);
  const castClientRef = useRef<CastClient | null>(null);
  /** Set synchronously on request so a double-click cannot reserve twice. */
  const castActiveRef = useRef(false);
  /** Bumped on close/unmount so a late reservation or callback cannot revive a dead flow. */
  const castGenerationRef = useRef(0);
  const makeCastClient = castFactory ?? ((options: CastClientOptions) => new CastClient(options));

  const applySnapshot = useCallback((snap: Snapshot) => {
    setDevices(snap.devices);
    setServerOffsetMs(new Date(snap.serverTime).getTime() - Date.now());
    setGlobalError(null);
  }, []);

  const demandKey = useCallback(() => {
    setKeyRequired(true);
    wsRef.current?.close();
  }, []);

  useEffect(() => {
    const liveIds = new Set(devices.map((device) => device.id));
    setSelectedIds((current) => {
      const kept = new Set([...current].filter((id) => liveIds.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, [devices]);

  useEffect(() => {
    setBulkResult(null);
  }, [selectedIds]);

  // Initial load + live channel. WS reconnects with backoff; 401/4401 -> key prompt.
  useEffect(() => {
    let cancelled = false;
    let wsTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const scheduleWs = () => {
      wsTimer = setTimeout(() => {
        if (cancelled) return;
        attempt += 1;
        const delays = [1000, 2000, 5000, 10000, 30000];
        const ws = connectStateSocket(
          keyRef.current,
          (snap) => {
            attempt = 0;
            setWsLive(true);
            applySnapshot(snap);
          },
          (_clean, code) => {
            setWsLive(false);
            if (code === 4401) {
              demandKey();
              return;
            }
            wsTimer = setTimeout(() => !cancelled && scheduleWs(), delays[Math.min(attempt, delays.length - 1)]);
          }
        );
        wsRef.current = ws;
      }, attempt === 0 ? 0 : [1000, 2000, 5000, 10000, 30000][Math.min(attempt, 4)]);
    };
    getSnapshot(key)
      .then(applySnapshot)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) demandKey();
        else setGlobalError(e);
      });
    getGames(key)
      .then((g) => setGames(g.games))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) demandKey();
      });
    getCatalogStatus(key)
      .then((c) => setCatalog({ entries: c.entries, fetchedAt: c.fetchedAt }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) demandKey();
      });
    scheduleWs();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearTimeout(wsTimer);
      clearInterval(tick);
      wsRef.current?.close();
    };
  }, [key, applySnapshot, demandKey]);

  const closeLiveView = useCallback(() => {
    castGenerationRef.current += 1;
    castActiveRef.current = false;
    const client = castClientRef.current;
    castClientRef.current = null;
    if (client) void client.close();
    setLiveView(null);
  }, []);

  // The modal opens before the POST resolves; a closed modal still releases the slot.
  const startLiveView = useCallback(
    async (device: Device) => {
      if (castActiveRef.current) return;
      castActiveRef.current = true;
      const generation = ++castGenerationRef.current;
      setLiveView({ deviceId: device.id, deviceName: device.name, state: { phase: "connecting" }, stream: null });
      let reservation: { sessionId: string };
      try {
        reservation = await requestCast(keyRef.current, device.id);
      } catch (error) {
        if (castGenerationRef.current !== generation) return;
        setLiveView((current) =>
          current ? { ...current, state: { phase: "failed", error: castRequestError(error) } } : current
        );
        return;
      }
      if (castGenerationRef.current !== generation) {
        // The viewer closed while the reservation was in flight: free the slot.
        void stopCast(keyRef.current, reservation.sessionId).catch(() => undefined);
        return;
      }
      const sessionId = reservation.sessionId;
      const client = makeCastClient({
        sessionId,
        socketUrl: castSocketUrl(keyRef.current, sessionId),
        callbacks: {
          onState: (state) => {
            if (castGenerationRef.current !== generation) return;
            setLiveView((current) => (current ? { ...current, state } : current));
          },
          onStream: (stream) => {
            if (castGenerationRef.current !== generation) return;
            setLiveView((current) => (current ? { ...current, stream } : current));
          },
          onUnauthorized: () => {
            if (castGenerationRef.current !== generation) return;
            closeLiveView();
            demandKey();
          },
        },
        stopSession: () => stopCast(keyRef.current, sessionId),
      });
      castClientRef.current = client;
      client.start();
    },
    [closeLiveView, demandKey, makeCastClient]
  );

  const retryLiveView = useCallback(() => {
    const current = liveView;
    if (!current) return;
    const device = devices.find((d) => d.id === current.deviceId);
    closeLiveView();
    if (device) void startLiveView(device);
  }, [devices, liveView, closeLiveView, startLiveView]);

  // Unmounting the board ends any capture this tab owns.
  useEffect(
    () => () => {
      castGenerationRef.current += 1;
      castActiveRef.current = false;
      const client = castClientRef.current;
      castClientRef.current = null;
      if (client) void client.close();
    },
    []
  );

  async function runCardAction(deviceId: string, fn: () => Promise<{ commandId?: string } | unknown>) {
    setBulkResult(null);
    setBusy((b) => ({ ...b, [deviceId]: true }));
    setCardErrors((e) => ({ ...e, [deviceId]: null }));
    try {
      const res = (await fn()) as { commandId?: string };
      if (res && typeof res.commandId === "string") {
        setPending((p) => ({ ...p, [deviceId]: res.commandId as string }));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        demandKey();
        return;
      }
      setCardErrors((prev) => ({ ...prev, [deviceId]: e }));
    } finally {
      setBusy((b) => ({ ...b, [deviceId]: false }));
    }
  }

  async function removeDevice(deviceId: string) {
    setBusy((b) => ({ ...b, [deviceId]: true }));
    setCardErrors((e) => ({ ...e, [deviceId]: null }));
    try {
      await deleteDevice(key, deviceId);
      // The state push removes it too; dropping it now keeps the board honest if the socket lags.
      setDevices((list) => list.filter((d) => d.id !== deviceId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        demandKey();
        return;
      }
      setCardErrors((prev) => ({ ...prev, [deviceId]: e }));
    } finally {
      setBusy((b) => ({ ...b, [deviceId]: false }));
    }
  }

  async function runCatalogRefresh() {
    setCatalogBusy(true);
    setCatalogError(null);
    try {
      const result = await refreshCatalog(key);
      setCatalog({ entries: result.entries, fetchedAt: result.fetchedAt });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) demandKey();
      else setCatalogError(e);
    } finally {
      setCatalogBusy(false);
    }
  }

  async function startBulkSession(originDeviceId: string, minutes: number | null) {
    const selected = devices.filter((device) => selectedIds.has(device.id));
    setBulkResult(null);
    setBusy((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((device) => [device.id, true])),
    }));

    const eligible = selected.filter((device) => device.online && device.session?.status !== "active");
    setCardErrors((current) => {
      const next = { ...current };
      for (const device of selected) {
        if (!device.online) next[device.id] = new ApiError(409, "headset offline");
        else if (device.session?.status === "active") next[device.id] = new ApiError(409, "session already active");
        else next[device.id] = null;
      }
      return next;
    });

    const results = await Promise.all(eligible.map(async (device) => {
      try {
        await startSession(key, device.id, minutes);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) demandKey();
        setCardErrors((current) => ({ ...current, [device.id]: error }));
        return false;
      }
    }));
    const succeeded = results.filter(Boolean).length;

    setBusy((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((device) => [device.id, false])),
    }));
    setBulkResult({ originDeviceId, action: "session", succeeded, failed: selected.length - succeeded });
  }

  async function launchBulk(
    originDeviceId: string,
    gameName: string,
    launch: (deviceId: string) => Promise<{ commandId: string }>
  ) {
    const selected = devices.filter((device) => selectedIds.has(device.id));
    const eligible = selected.filter((device) => device.online);
    setBulkResult(null);
    setBusy((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((device) => [device.id, true])),
    }));
    setCardErrors((current) => {
      const next = { ...current };
      for (const device of selected) {
        next[device.id] = device.online ? null : new ApiError(409, "headset offline");
      }
      return next;
    });

    const results = await Promise.all(eligible.map(async (device) => {
      try {
        const response = await launch(device.id);
        setPending((current) => ({ ...current, [device.id]: response.commandId }));
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) demandKey();
        setCardErrors((current) => ({ ...current, [device.id]: error }));
        return false;
      }
    }));
    const succeeded = results.filter(Boolean).length;

    setBusy((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((device) => [device.id, false])),
    }));
    setBulkResult({ originDeviceId, action: "launch", gameName, succeeded, failed: selected.length - succeeded });
  }

  if (keyRequired) {
    return (
      <main className="gate">
        <KeyPrompt
          initial={key}
          onSave={(k) => {
            localStorage.setItem(KEY_STORAGE, k);
            setKey(k);
            setKeyRequired(false);
          }}
        />
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <h1 className="brand">CafeQuest</h1>
        <BoardSummary devices={devices} now={now} serverOffsetMs={serverOffsetMs} />
        <p className="feed" data-live={wsLive}>{wsLive ? t.app.live : t.app.connecting}</p>
        <LangToggle />
      </header>
      <main className="shell">
      {globalError != null && (
        <div className="banner" role="alert">
          <p>{friendlyError(globalError, t)}</p>
          <button className="btn" onClick={() => getSnapshot(key).then(applySnapshot).catch(setGlobalError)}>
            {t.app.retry}
          </button>
        </div>
      )}
      {devices.length > 0 && (
        <SelectionBar
          selectedCount={selectedIds.size}
          totalCount={devices.length}
          onSelectAll={() => setSelectedIds(new Set(devices.map((device) => device.id)))}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      <section className="board" aria-label={t.app.headsets}>
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            games={games}
            now={now}
            serverOffsetMs={serverOffsetMs}
            pendingCommandId={pending[d.id] ?? null}
            busy={!!busy[d.id]}
            error={cardErrors[d.id] != null ? friendlyError(cardErrors[d.id], t) : null}
            selected={selectedIds.has(d.id)}
            actionTargetCount={selectedIds.has(d.id) ? selectedIds.size : 0}
            actionResult={bulkResult?.originDeviceId === d.id
              ? bulkResult.action === "session"
                ? t.bulk.sessionResult(bulkResult.succeeded, bulkResult.failed)
                : t.bulk.launchResult(bulkResult.gameName, bulkResult.succeeded, bulkResult.failed)
              : null}
            onSelectedChange={(deviceId, selected) => {
              setSelectedIds((current) => {
                const next = new Set(current);
                if (selected) next.add(deviceId);
                else next.delete(deviceId);
                return next;
              });
            }}
            onLaunch={(deviceId, gameId) => {
              if (selectedIds.has(deviceId)) {
                const gameName = games.find((game) => game.id === gameId)?.name ?? gameId;
                return launchBulk(deviceId, gameName, (targetId) => launchGame(key, targetId, gameId));
              }
              return runCardAction(deviceId, () => launchGame(key, deviceId, gameId));
            }}
            onLaunchInstalled={(deviceId, packageName) => {
              if (selectedIds.has(deviceId)) {
                const source = devices.find((device) => device.id === deviceId);
                const gameName = source?.installedApps.find((app) => app.packageName === packageName)?.name ?? packageName;
                return launchBulk(deviceId, gameName, (targetId) => launchInstalledApp(key, targetId, packageName));
              }
              return runCardAction(deviceId, () => launchInstalledApp(key, deviceId, packageName));
            }}
            onMapInstalled={(deviceId, packageName, name, metaAppId) =>
              runCardAction(deviceId, () => mapInstalledApp(key, deviceId, packageName, name, metaAppId))
            }
            onStartSession={(deviceId, minutes) => {
              // null is the Unlimited button; only a typed length can be wrong.
              if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60)) {
                // The very answer the server gives such a length; worded with the other errors.
                setCardErrors((prev) => ({ ...prev, [deviceId]: new ApiError(400, "invalid session body") }));
                return Promise.resolve({});
              }
              if (selectedIds.has(deviceId)) return startBulkSession(deviceId, minutes);
              return runCardAction(deviceId, () => startSession(key, deviceId, minutes));
            }}
            onExtend={(sessionId, minutes) => runCardAction(d.id, () => extendSession(key, sessionId, minutes))}
            onStop={(sessionId) => runCardAction(d.id, () => stopSession(key, sessionId))}
            onRemove={removeDevice}
            castBusy={liveView !== null}
            onRequestCast={(deviceId) => {
              const target = devices.find((device) => device.id === deviceId);
              if (target) void startLiveView(target);
            }}
          />
        ))}
      </section>
      {devices.length === 0 && globalError == null && (
        <section className="empty">
          <h2>{t.app.emptyTitle}</h2>
          <p>{t.app.emptyBody(<code>npm run simulator</code>)}</p>
        </section>
      )}
      </main>
      <footer className="foot">
        <CatalogButton
          entries={catalog?.entries ?? null}
          fetchedAt={catalog?.fetchedAt ?? null}
          now={now}
          serverOffsetMs={serverOffsetMs}
          busy={catalogBusy}
          error={catalogError != null ? friendlyError(catalogError, t) : null}
          onRefresh={runCatalogRefresh}
        />
      </footer>
      {liveView && (
        <LiveViewModal
          deviceName={liveView.deviceName}
          state={liveView.state}
          stream={liveView.stream}
          onStop={closeLiveView}
          onRetry={retryLiveView}
          onClose={closeLiveView}
        />
      )}
    </>
  );
}
