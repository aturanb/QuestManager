import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerBatteryMonitoringState, Device, Game, Snapshot } from "./types";
import {
  ApiError,
  connectStateSocket,
  deleteDevice,
  renameDevice,
  extendSession,
  getCatalogStatus,
  getGames,
  getSnapshot,
  launchGame,
  launchInstalledApp,
  mapInstalledApp,
  refreshCatalog,
  setControllerBatteryMonitoring,
  startSession,
  stopSession,
} from "./api";
import type { CastClient, CastClientOptions } from "./casting";
import { useLiveViews } from "./useLiveViews";
import { BoardSummary } from "./components/BoardSummary";
import { CatalogButton } from "./components/CatalogButton";
import { ControllerBatteryToggle } from "./components/ControllerBatteryToggle";
import { DeviceCard } from "./components/DeviceCard";
import { DeviceBoard } from "./components/DeviceBoard";
import { KeyPrompt } from "./components/KeyPrompt";
import { LangToggle } from "./components/LangToggle";
import { LiveViewModal } from "./components/LiveViewModal";
import { NotesPage, type NoteDrafts } from "./components/NotesPage";
import { ResumeAppPrompt } from "./components/ResumeAppPrompt";
import { SelectionBar } from "./components/SelectionBar";
import { friendlyError } from "./errors";
import { useI18n } from "./i18n";
import { useDeviceOrder } from "./useDeviceOrder";

const KEY_STORAGE = "cq-admin-key";

type Page = "headsets" | "notes";
const currentPage = (): Page => window.location.hash === "#/notes" ? "notes" : "headsets";

type BulkResult =
  | { originDeviceId: string; action: "session"; succeeded: number; failed: number }
  | { originDeviceId: string; action: "launch"; gameName: string; succeeded: number; failed: number };

export type AppProps = {
  /** Injected in tests; defaults to the real signaling/WebRTC client. */
  castFactory?: (options: CastClientOptions) => CastClient;
};

export function App({ castFactory }: AppProps = {}) {
  const { t } = useI18n();
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [keyRequired, setKeyRequired] = useState(false);
  const [page, setPage] = useState<Page>(currentPage);
  const [noteDrafts, setNoteDrafts] = useState<NoteDrafts>({ content: "", edit: null, createRequest: null });
  const [devices, setDevices] = useState<Device[]>([]);
  const { orderedDevices, moveDevice, saveFailed: orderSaveFailed } = useDeviceOrder(devices);
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
  /** Server-confirmed controller-monitoring state; null until the first snapshot. */
  const [controllerMonitoring, setControllerMonitoring] = useState<ControllerBatteryMonitoringState | null>(null);
  const [controllerPending, setControllerPending] = useState(false);
  const [controllerFailed, setControllerFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mainRef = useRef<HTMLElement | null>(null);
  const wsRef = useRef<{ close: () => void } | null>(null);
  /** Blocks a second click synchronously, before React re-renders the disabled switch. */
  const controllerPendingRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    const navigate = () => setPage(currentPage());
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    // Preserve the summary's existing #bay-* links when coming back from Notes.
    const hash = window.location.hash;
    const target = page === "headsets" && hash.startsWith("#bay-")
      ? document.getElementById(hash.slice(1)) : mainRef.current;
    target?.scrollIntoView?.({ block: "start" });
  }, [page, keyRequired]);

  const applySnapshot = useCallback((snap: Snapshot) => {
    setDevices(snap.devices);
    setServerOffsetMs(new Date(snap.serverTime).getTime() - Date.now());
    if (snap.controllerBatteryMonitoring) setControllerMonitoring(snap.controllerBatteryMonitoring);
    setGlobalError(null);
  }, []);

  const demandKey = useCallback(() => {
    setKeyRequired(true);
    wsRef.current?.close();
  }, []);

  const { views: liveViews, resumePrompt, start: startLiveView, end: endLiveView, retry: retryLiveView, dismissResume } = useLiveViews({
    devices, apiKey: key, onUnauthorized: demandKey, castFactory, authRequired: keyRequired,
  });

  /**
   * One PUT per toggle. The switch shows the server-confirmed position, so a
   * failure simply leaves it where it was; nothing on a card is touched.
   */
  const toggleControllerMonitoring = useCallback(
    async (enabled: boolean) => {
      if (controllerPendingRef.current) return;
      controllerPendingRef.current = true;
      setControllerPending(true);
      setControllerFailed(false);
      try {
        const result = await setControllerBatteryMonitoring(keyRef.current, enabled);
        setControllerMonitoring(result.controllerBatteryMonitoring);
      } catch (error) {
        // 401 goes to the key prompt; anything else is a bounded admin message.
        if (error instanceof ApiError && error.status === 401) demandKey();
        else setControllerFailed(true);
      } finally {
        controllerPendingRef.current = false;
        setControllerPending(false);
      }
    },
    [demandKey]
  );

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
      ...Object.assign({}, ...selected.map((device) => ({ [device.id]: true }))),
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
      ...Object.assign({}, ...selected.map((device) => ({ [device.id]: false }))),
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
      ...Object.assign({}, ...selected.map((device) => ({ [device.id]: true }))),
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
      ...Object.assign({}, ...selected.map((device) => ({ [device.id]: false }))),
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
        <nav className="main-nav" aria-label={t.app.navigation}>
          <a href="#/" aria-current={page === "headsets" ? "page" : undefined}>{t.app.headsets}</a>
          <a href="#/notes" aria-current={page === "notes" ? "page" : undefined}>{t.notes.title}</a>
        </nav>
        <BoardSummary devices={orderedDevices} now={now} serverOffsetMs={serverOffsetMs} />
        <p className="feed" data-live={wsLive}>{wsLive ? t.app.live : t.app.connecting}</p>
        {controllerMonitoring && (
          <ControllerBatteryToggle
            state={controllerMonitoring}
            pending={controllerPending}
            error={controllerFailed ? t.controller.error : null}
            onChange={(enabled) => void toggleControllerMonitoring(enabled)}
          />
        )}
        <LangToggle />
      </header>
      <main className="shell" ref={mainRef}>
      {globalError != null && (
        <div className="banner" role="alert">
          <p>{friendlyError(globalError, t)}</p>
          <button className="btn" onClick={() => getSnapshot(key).then(applySnapshot).catch(setGlobalError)}>
            {t.app.retry}
          </button>
        </div>
      )}
      {page === "headsets" && <>
      {devices.length > 0 && (
        <SelectionBar
          selectedCount={selectedIds.size}
          totalCount={devices.length}
          onSelectAll={() => setSelectedIds(new Set(devices.map((device) => device.id)))}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      <DeviceBoard devices={orderedDevices} onMove={moveDevice} saveFailed={orderSaveFailed}>
        {(d, reorderControls) => (
          <DeviceCard
            key={d.id}
            reorderControls={reorderControls}
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
            onRename={(deviceId, name) => runCardAction(deviceId, () => renameDevice(key, deviceId, name))}
            castBusy={liveViews.some((view) => view.deviceId === d.id)}
            onRequestCast={(deviceId) => {
              const target = devices.find((device) => device.id === deviceId);
              if (target) void startLiveView(target);
            }}
          />
        )}
      </DeviceBoard>
      {devices.length === 0 && globalError == null && (
        <section className="empty">
          <h2>{t.app.emptyTitle}</h2>
          <p>{t.app.emptyBody(<code>npm run simulator</code>)}</p>
        </section>
      )}
      </>}
      <div hidden={page !== "notes"}>
        <NotesPage active={page === "notes"} apiKey={key} onUnauthorized={demandKey} drafts={noteDrafts} setDrafts={setNoteDrafts} />
      </div>
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
      {liveViews.length > 0 && (
        <div className="cast-views" data-multiple={liveViews.length > 1}>
          {liveViews.map((liveView, index) => (
            <LiveViewModal
              key={liveView.deviceId}
              closeOnUnfocusedEscape={index === liveViews.length - 1}
              escapeEnabled={resumePrompt === null}
              deviceName={liveView.deviceName}
              state={liveView.state}
              stream={liveView.stream}
              onStop={() => endLiveView(liveView.deviceId)}
              onRetry={() => retryLiveView(liveView.deviceId)}
              onClose={() => endLiveView(liveView.deviceId)}
              launch={(() => {
                const device = devices.find((d) => d.id === liveView.deviceId);
                if (!device) return undefined;
                return {
                  device,
                  games,
                  pendingCommandId: pending[device.id] ?? null,
                  busy: !!busy[device.id],
                  error: cardErrors[device.id] != null ? friendlyError(cardErrors[device.id], t) : null,
                  onLaunch: (deviceId: string, gameId: string) => void runCardAction(deviceId, () => launchGame(key, deviceId, gameId)),
                  onLaunchInstalled: (deviceId: string, packageName: string) =>
                    void runCardAction(deviceId, () => launchInstalledApp(key, deviceId, packageName)),
                };
              })()}
            />
          ))}
        </div>
      )}
      {resumePrompt && (
        <ResumeAppPrompt
          key={resumePrompt.deviceId}
          deviceName={resumePrompt.deviceName}
          appName={resumePrompt.app.name}
          canOpen={devices.find((d) => d.id === resumePrompt.deviceId)?.online === true}
          onDismiss={() => dismissResume(resumePrompt.deviceId)}
          onConfirm={() => {
            const { deviceId, app } = resumePrompt;
            dismissResume(deviceId);
            void runCardAction(deviceId, () => launchInstalledApp(key, deviceId, app.packageName));
          }}
        />
      )}
    </>
  );
}
