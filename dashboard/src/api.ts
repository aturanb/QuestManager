import type { ControllerBatteryMonitoringState, Device, Game, Note, Snapshot } from "./types";

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

export const getNotes = (key: string): Promise<{ notes: Note[] }> => apiFetch("/api/notes", key);

/** getRandomValues also works on the café's HTTP LAN origin, unlike randomUUID. */
export function newNoteRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createNote(key: string, content: string, requestId: string): Promise<{ note: Note }> {
  return apiFetch("/api/notes", key, { method: "POST", body: JSON.stringify({ content, requestId }) });
}

export function updateNote(key: string, id: string, content: string, revision: number): Promise<{ note: Note }> {
  return apiFetch(`/api/notes/${encodeURIComponent(id)}`, key, {
    method: "PUT", body: JSON.stringify({ content, revision }),
  });
}

export function deleteNote(key: string, id: string, revision: number): Promise<{ deleted: string }> {
  return apiFetch(`/api/notes/${encodeURIComponent(id)}`, key, {
    method: "DELETE", body: JSON.stringify({ revision }),
  });
}

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

/** Renames a headset; the server also pushes the name to the headset itself when it is connected. */
export function renameDevice(key: string, deviceId: string, name: string): Promise<{ device: unknown }> {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/rename`, key, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Reserves the selected headset's live-view slot. */
export function requestCast(key: string, deviceId: string): Promise<{ sessionId: string; status: string }> {
  return apiFetch("/api/casts", key, { method: "POST", body: JSON.stringify({ deviceId }) });
}

/**
 * The global controller-battery switch. Turning it on asks each headset to
 * enable Wireless Debugging; turning it off switches it off again where
 * CafeQuest enabled it.
 */
export function setControllerBatteryMonitoring(
  key: string,
  enabled: boolean
): Promise<{ controllerBatteryMonitoring: ControllerBatteryMonitoringState }> {
  return apiFetch("/api/settings/controller-battery-monitoring", key, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

/** Idempotent: 204 whether the session is active, terminal, or already gone. */
export function stopCast(key: string, sessionId: string): Promise<void> {
  return apiFetch(`/api/casts/${encodeURIComponent(sessionId)}`, key, { method: "DELETE" });
}

/** The dedicated signaling socket for a reservation; the admin key travels in the query. */
export function castSocketUrl(key: string, sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/cast-ws?key=${encodeURIComponent(key)}&sessionId=${encodeURIComponent(sessionId)}`;
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

export type { ControllerBatteryMonitoringState, Device, Game, Snapshot };
