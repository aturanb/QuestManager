import type { Device, Game, Snapshot } from "./types";

export class ApiError extends Error {
  status: number;
  detail: string | null;
  constructor(status: number, message: string, detail: string | null = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function apiFetch(path: string, key: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: {
      // Only when there is a body: Fastify answers 400 to an empty JSON body,
      // which broke bodyless calls like stop session and catalog refresh.
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON (proxy errors) */
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `request failed (${res.status})`, body?.detail ?? null);
  }
  return body;
}

export const getSnapshot = (key: string): Promise<Snapshot> => apiFetch("/api/devices", key);
export const getGames = (key: string): Promise<{ games: Game[] }> => apiFetch("/api/games", key);

export type CatalogStatus = { entries: number; fetchedAt: string | null; source: string };

export const getCatalogStatus = (key: string): Promise<CatalogStatus> => apiFetch("/api/catalog", key);

/** Re-downloads the community catalog; the server keeps the old mappings on failure. */
export function refreshCatalog(key: string): Promise<{ entries: number; fetchedAt: string }> {
  return apiFetch("/api/catalog/refresh", key, { method: "POST" });
}

export function launchGame(key: string, deviceId: string, gameId: string): Promise<{ commandId: string; status: string }> {
  return apiFetch(`/api/devices/${deviceId}/launch`, key, { method: "POST", body: JSON.stringify({ gameId }) });
}

export function launchInstalledApp(
  key: string,
  deviceId: string,
  packageName: string
): Promise<{ commandId: string; status: string }> {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/launch-installed`, key, {
    method: "POST",
    body: JSON.stringify({ packageName }),
  });
}

export function mapInstalledApp(
  key: string,
  deviceId: string,
  packageName: string,
  name: string,
  metaAppId: string
): Promise<{ app: unknown }> {
  return apiFetch(
    `/api/devices/${encodeURIComponent(deviceId)}/apps/${encodeURIComponent(packageName)}`,
    key,
    { method: "PUT", body: JSON.stringify({ name, metaAppId }) }
  );
}

/** `minutes: null` starts an unlimited session. */
export function startSession(key: string, deviceId: string, minutes: number | null): Promise<{ session: unknown }> {
  return apiFetch(`/api/devices/${deviceId}/sessions`, key, { method: "POST", body: JSON.stringify({ minutes }) });
}

export function extendSession(key: string, sessionId: string, minutes: number): Promise<{ session: unknown }> {
  return apiFetch(`/api/sessions/${sessionId}/extend`, key, { method: "POST", body: JSON.stringify({ minutes }) });
}

export function stopSession(key: string, sessionId: string): Promise<{ session: unknown }> {
  return apiFetch(`/api/sessions/${sessionId}/stop`, key, { method: "POST" });
}

/** Removes an offline headset and its history; the server answers 409 while it is connected. */
export function deleteDevice(key: string, deviceId: string): Promise<{ deleted: string }> {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}`, key, { method: "DELETE" });
}

export type WsState = { socket: WebSocket; close: () => void };

/** Live state channel (/dashboard-ws). Rejects with ApiError(4401) when the key is wrong. */
export function connectStateSocket(
  key: string,
  onState: (snap: Snapshot) => void,
  onClose: (clean: boolean, code: number) => void
): WsState {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/dashboard-ws${key ? `?key=${encodeURIComponent(key)}` : ""}`);
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg?.type === "state" && msg.payload) onState(msg.payload);
    } catch {
      /* ignore malformed pushes */
    }
  };
  socket.onclose = (ev) => onClose(ev.wasClean, ev.code);
  return { socket, close: () => socket.close() };
}

export type { Device, Game, Snapshot };
