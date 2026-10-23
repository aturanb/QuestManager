import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, castSocketUrl, requestCast, stopCast } from "./api";
import { CastClient, type CastClientOptions, type CastViewState } from "./casting";
import { castRequestError } from "./errors";
import { resumableApp, type ResumeApp } from "./resume-app";
import type { Device } from "./types";

type LiveView = {
  deviceId: string;
  deviceName: string;
  state: CastViewState;
  stream: MediaStream | null;
};

type ResumePrompt = { deviceId: string; deviceName: string; app: ResumeApp };
type OwnedView = {
  deviceName: string;
  client: CastClient | null;
  resume: ResumeApp | null;
  setup: Promise<void>;
};

/** Owns one independent request/client lifecycle per headset, including pending POSTs. */
export function useLiveViews({ devices, apiKey, onUnauthorized, castFactory, authRequired }: {
  devices: Device[];
  apiKey: string;
  onUnauthorized: () => void;
  castFactory?: (options: CastClientOptions) => CastClient;
  authRequired: boolean;
}) {
  const [views, setViews] = useState<LiveView[]>([]);
  const [resumePrompts, setResumePrompts] = useState<ResumePrompt[]>([]);
  // Object identity invalidates callbacks and pending POSTs across close, retry, and unmount.
  const owned = useRef(new Map<string, OwnedView>());
  const closing = useRef(new Map<string, Promise<void>>());

  const release = useCallback((deviceId: string, view: OwnedView) => {
    // A closed pending POST must finish its orphan DELETE before the same headset
    // can reserve again. Active clients expose the same barrier through close().
    const cleanup = (view.client ? view.client.close() : view.setup).catch(() => undefined);
    closing.current.set(deviceId, cleanup);
    void cleanup.then(() => {
      if (closing.current.get(deviceId) === cleanup) closing.current.delete(deviceId);
    });
  }, []);

  const close = useCallback((deviceId: string) => {
    const view = owned.current.get(deviceId);
    owned.current.delete(deviceId);
    if (view) release(deviceId, view);
    setViews((current) => current.filter((item) => item.deviceId !== deviceId));
    return view;
  }, [release]);

  const closeAll = useCallback(() => {
    const viewsToClose = [...owned.current.entries()];
    owned.current.clear();
    for (const [deviceId, view] of viewsToClose) release(deviceId, view);
    setViews([]);
    setResumePrompts([]);
  }, [release]);

  const start = useCallback((device: Device, previousResume: ResumeApp | null = null) => {
    if (owned.current.has(device.id)) return;
    const previousCleanup = closing.current.get(device.id);
    const view: OwnedView = {
      deviceName: device.name,
      client: null,
      resume: resumableApp(device) ?? previousResume,
      setup: Promise.resolve(),
    };
    owned.current.set(device.id, view);
    setResumePrompts((current) => current.filter((prompt) => prompt.deviceId !== device.id));
    setViews((current) => [...current, {
      deviceId: device.id, deviceName: device.name, state: { phase: "connecting" }, stream: null,
    }]);
    // Retain the credential used to reserve this session for its entire lifecycle.
    const sessionKey = apiKey;
    const isCurrent = () => owned.current.get(device.id) === view;
    const update = (patch: Partial<LiveView>) => {
      if (!isCurrent()) return;
      setViews((current) => isCurrent()
        ? current.map((item) => item.deviceId === device.id ? { ...item, ...patch } : item)
        : current);
    };
    view.setup = (async () => {
      if (previousCleanup) {
        await previousCleanup;
        if (!isCurrent()) return;
      }
      let sessionId: string;
      try {
        ({ sessionId } = await requestCast(sessionKey, device.id));
      } catch (error) {
        if (isCurrent() && error instanceof ApiError && error.status === 401) {
          closeAll();
          onUnauthorized();
          return;
        }
        update({ state: { phase: "failed", error: castRequestError(error) } });
        return;
      }
      if (!isCurrent()) {
        await stopCast(sessionKey, sessionId).catch(() => undefined);
        return;
      }
      const options: CastClientOptions = {
        sessionId,
        socketUrl: castSocketUrl(sessionKey, sessionId),
        callbacks: {
          onState: (state) => update({ state }),
          onStream: (stream) => update({ stream }),
          onUnauthorized: () => {
            if (!isCurrent()) return;
            closeAll();
            onUnauthorized();
          },
        },
        stopSession: () => stopCast(sessionKey, sessionId),
      };
      view.client = castFactory ? castFactory(options) : new CastClient(options);
      view.client.start();
    })();
    return view.setup;
  }, [apiKey, castFactory, closeAll, onUnauthorized]);

  // Staff may launch another customer app during any of the concurrent views.
  useEffect(() => {
    for (const [deviceId, view] of owned.current) {
      const app = resumableApp(devices.find((device) => device.id === deviceId));
      if (app) view.resume = app;
    }
  }, [devices]);

  const end = useCallback((deviceId: string) => {
    const view = close(deviceId);
    if (view?.resume) {
      const prompt = { deviceId, deviceName: view.deviceName, app: view.resume };
      setResumePrompts((current) => [...current.filter((item) => item.deviceId !== deviceId), prompt]);
    }
  }, [close]);

  const retry = useCallback((deviceId: string) => {
    const device = devices.find((item) => item.id === deviceId);
    const previous = close(deviceId);
    if (device) void start(device, previous?.resume);
  }, [close, devices, start]);

  const dismissResume = useCallback((deviceId: string) => {
    setResumePrompts((current) => current.filter((prompt) => prompt.deviceId !== deviceId));
  }, []);

  // Key replacement and unmount invalidate pending requests as well as active clients.
  useEffect(() => () => closeAll(), [apiKey, closeAll]);
  useEffect(() => { if (authRequired) closeAll(); }, [authRequired, closeAll]);

  return { views, resumePrompt: resumePrompts[0] ?? null, start, end, retry, dismissResume };
}
