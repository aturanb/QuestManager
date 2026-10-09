import { useCallback, useEffect, useRef, useState } from "react";
import type { Device, Game, Snapshot } from "./types";
import {
  ApiError,
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
  startSession,
  stopSession,
} from "./api";
import { BoardSummary } from "./components/BoardSummary";
import { BulkActions, type BulkResult } from "./components/BulkActions";
import { CatalogButton } from "./components/CatalogButton";
import { DeviceCard } from "./components/DeviceCard";
import { KeyPrompt } from "./components/KeyPrompt";
import { LangToggle } from "./components/LangToggle";
import { friendlyError } from "./errors";
import { useI18n } from "./i18n";

const KEY_STORAGE = "cq-admin-key";

export function App() {
  const { t } = useI18n();
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [keyRequired, setKeyRequired] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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

  async function runCardAction(deviceId: string, fn: () => Promise<{ commandId?: string } | unknown>) {
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

  async function startBulkSession(minutes: number | null) {
    const selected = devices.filter((device) => selectedIds.has(device.id));
    setBulkBusy(true);
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
    setBulkBusy(false);
    setBulkResult({ action: "session", succeeded, failed: selected.length - succeeded });
  }

  async function launchBulkGame(gameId: string, gameName: string) {
    const selected = devices.filter((device) => selectedIds.has(device.id));
    const eligible = selected.filter((device) => device.online);
    setBulkBusy(true);
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
        const response = await launchGame(key, device.id, gameId);
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
    setBulkBusy(false);
    setBulkResult({ action: "launch", gameName, succeeded, failed: selected.length - succeeded });
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
        <BulkActions
          selectedCount={selectedIds.size}
          totalCount={devices.length}
          games={games}
          busy={bulkBusy}
          result={bulkResult}
          onSelectAll={() => setSelectedIds(new Set(devices.map((device) => device.id)))}
          onClear={() => {
            setSelectedIds(new Set());
            setBulkResult(null);
          }}
          onStartSession={startBulkSession}
          onLaunchGame={launchBulkGame}
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
            onSelectedChange={(deviceId, selected) => {
              setSelectedIds((current) => {
                const next = new Set(current);
                if (selected) next.add(deviceId);
                else next.delete(deviceId);
                return next;
              });
            }}
            onLaunch={(deviceId, gameId) => runCardAction(deviceId, () => launchGame(key, deviceId, gameId))}
            onLaunchInstalled={(deviceId, packageName) =>
              runCardAction(deviceId, () => launchInstalledApp(key, deviceId, packageName))
            }
            onMapInstalled={(deviceId, packageName, name, metaAppId) =>
              runCardAction(deviceId, () => mapInstalledApp(key, deviceId, packageName, name, metaAppId))
            }
            onStartSession={(deviceId, minutes) => {
              // null is the Unlimited button; only a typed length can be wrong.
              if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) {
                // The very answer the server gives such a length; worded with the other errors.
                setCardErrors((prev) => ({ ...prev, [deviceId]: new ApiError(400, "invalid session body") }));
                return Promise.resolve({});
              }
              return runCardAction(deviceId, () => startSession(key, deviceId, minutes));
            }}
            onExtend={(sessionId, minutes) => runCardAction(d.id, () => extendSession(key, sessionId, minutes))}
            onStop={(sessionId) => runCardAction(d.id, () => stopSession(key, sessionId))}
            onRemove={removeDevice}
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
    </>
  );
}
