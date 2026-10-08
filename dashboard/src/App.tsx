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
import { CatalogButton } from "./components/CatalogButton";
import { DeviceCard } from "./components/DeviceCard";
import { KeyPrompt } from "./components/KeyPrompt";
import { friendlyError } from "./errors";

const KEY_STORAGE = "cq-admin-key";

export function App() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [keyRequired, setKeyRequired] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [wsLive, setWsLive] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<{ entries: number; fetchedAt: string | null } | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
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
        else setGlobalError(friendlyError(e));
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
    setCardErrors((e) => ({ ...e, [deviceId]: "" }));
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
      setCardErrors((prev) => ({ ...prev, [deviceId]: friendlyError(e) }));
    } finally {
      setBusy((b) => ({ ...b, [deviceId]: false }));
    }
  }

  async function removeDevice(deviceId: string) {
    setBusy((b) => ({ ...b, [deviceId]: true }));
    setCardErrors((e) => ({ ...e, [deviceId]: "" }));
    try {
      await deleteDevice(key, deviceId);
      // The state push removes it too; dropping it now keeps the board honest if the socket lags.
      setDevices((list) => list.filter((d) => d.id !== deviceId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        demandKey();
        return;
      }
      setCardErrors((prev) => ({ ...prev, [deviceId]: friendlyError(e) }));
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
      else setCatalogError(friendlyError(e));
    } finally {
      setCatalogBusy(false);
    }
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
        <p className="feed" data-live={wsLive}>{wsLive ? "Live" : "Connecting…"}</p>
      </header>
      <main className="shell">
      {globalError && (
        <div className="banner" role="alert">
          <p>{globalError}</p>
          <button className="btn" onClick={() => getSnapshot(key).then(applySnapshot).catch((e) => setGlobalError(friendlyError(e)))}>
            Retry
          </button>
        </div>
      )}
      <section className="board" aria-label="Headsets">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            games={games}
            now={now}
            serverOffsetMs={serverOffsetMs}
            pendingCommandId={pending[d.id] ?? null}
            busy={!!busy[d.id]}
            error={cardErrors[d.id] || null}
            onLaunch={(deviceId, gameId) => runCardAction(deviceId, () => launchGame(key, deviceId, gameId))}
            onLaunchInstalled={(deviceId, packageName) =>
              runCardAction(deviceId, () => launchInstalledApp(key, deviceId, packageName))
            }
            onMapInstalled={(deviceId, packageName, name, metaAppId) =>
              runCardAction(deviceId, () => mapInstalledApp(key, deviceId, packageName, name, metaAppId))
            }
            onStartSession={(deviceId, minutes) => {
              if (!Number.isInteger(minutes) || minutes < 1) {
                setCardErrors((prev) => ({ ...prev, [deviceId]: "enter 1–1440 minutes" }));
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
      {devices.length === 0 && !globalError && (
        <section className="empty">
          <h2>No headsets yet</h2>
          <p>
            Open CafeQuest on a headset and it shows up here within a few seconds. To try the board
            without hardware, run <code>npm run simulator</code> on this PC.
          </p>
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
          error={catalogError}
          onRefresh={runCatalogRefresh}
        />
      </footer>
    </>
  );
}
