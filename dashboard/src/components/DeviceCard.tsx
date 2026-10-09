import { useState } from "react";
import type { Device, Game, InstalledApp } from "../types";
import { bayState, type BayState } from "../bay";
import { useI18n, type Messages } from "../i18n";
import { formatAgo, formatElapsedSince, formatRemaining } from "../time";

export type DeviceCardProps = {
  device: Device;
  games: Game[];
  now: number;
  serverOffsetMs: number;
  pendingCommandId: string | null;
  busy: boolean;
  error: string | null;
  onLaunch: (deviceId: string, gameId: string) => void;
  onLaunchInstalled: (deviceId: string, packageName: string) => void;
  onMapInstalled: (deviceId: string, packageName: string, name: string, metaAppId: string) => void;
  /** `minutes: null` starts an unlimited session. */
  onStartSession: (deviceId: string, minutes: number | null) => void;
  onExtend: (sessionId: string, minutes: number) => void;
  onStop: (sessionId: string) => void;
  onRemove: (deviceId: string) => void;
};

function UnmatchedAppMapping(props: {
  app: InstalledApp;
  deviceId: string;
  busy: boolean;
  onMap: DeviceCardProps["onMapInstalled"];
}) {
  const { t } = useI18n();
  const [metaAppId, setMetaAppId] = useState("");
  const valid = /^\d{5,32}$/.test(metaAppId);
  return (
    <div className="mapping">
      <div className="mapping-app">
        <strong>{props.app.label}</strong>
        <code>{props.app.packageName}</code>
      </div>
      <div className="mapping-entry">
        <input
          aria-label={t.card.appIdLabel(props.app.label)}
          placeholder={t.card.appIdPlaceholder}
          inputMode="numeric"
          value={metaAppId}
          onChange={(event) => setMetaAppId(event.target.value.trim())}
        />
        <button
          className="btn"
          aria-label={t.card.saveLabel(props.app.label)}
          disabled={props.busy || !valid}
          onClick={() => props.onMap(props.deviceId, props.app.packageName, props.app.label, metaAppId)}
        >
          {t.card.save}
        </button>
      </div>
    </div>
  );
}

export type LaunchStatus =
  | { kind: "launching" }
  | { kind: "launched" }
  | { kind: "failed"; error: string | null }
  | { kind: "timeout" };

/** Launch badge state from the tracked command id + snapshot lastCommand (§21 states). */
export function launchStatus(pendingCommandId: string | null, device: Device): LaunchStatus | null {
  const last = device.lastCommand;
  if (!pendingCommandId) {
    if (last?.status === "failed") return { kind: "failed", error: last.error };
    if (last?.status === "timeout") return { kind: "timeout" };
    return null;
  }
  if (!last || last.id !== pendingCommandId) return { kind: "launching" };
  if (last.status === "success") return { kind: "launched" };
  if (last.status === "failed") return { kind: "failed", error: last.error };
  if (last.status === "timeout") return { kind: "timeout" };
  return { kind: "launching" };
}

// Tone follows the state, never the words, so it survives a language switch.
const BADGE_TONE: Record<LaunchStatus["kind"], "ok" | "bad" | "wait"> = {
  launching: "wait",
  launched: "ok",
  failed: "bad",
  timeout: "bad",
};

function badgeText(status: LaunchStatus, t: Messages["card"]): string {
  switch (status.kind) {
    case "launching":
      return t.launching;
    case "launched":
      return t.launched;
    case "failed":
      return t.failed(status.error);
    case "timeout":
      return t.timedOut;
  }
}

/** Mirrors the server's isPlaceholderAppId: launches of these are refused, so they are not offered. */
function needsAppId(metaAppId: string): boolean {
  return !metaAppId.trim() || metaAppId === "UNCONFIGURED" || metaAppId.includes("FILL_");
}

type LaunchChoice = { value: string; label: string; disabled: boolean };

function Battery({ level, charging }: { level: number | null; charging: boolean | null }) {
  const { t } = useI18n();
  if (level === null) return <>—</>;
  const tone = level <= 20 ? "low" : level <= 40 ? "mid" : "ok";
  // A nearly flat headset keeps one red cell: empty would read as "unknown".
  const lit = level > 0 ? Math.max(1, Math.round(level / 20)) : 0;
  return (
    <span className="battery" data-tone={tone}>
      <span className="cells" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <i key={i} data-lit={i < lit} />)}
      </span>
      <span className="pct">{level}%</span>
      {charging && <span className="charging">{t.card.charging}</span>}
    </span>
  );
}

function Readout({ state, now, serverOffsetMs }: { state: BayState; now: number; serverOffsetMs: number }) {
  const { t } = useI18n();
  if (state.kind === "playing" || state.kind === "ending") {
    const fraction = state.totalMs > 0 ? Math.min(1, Math.max(0, state.remainingMs / state.totalMs)) : 1;
    const clock = formatRemaining(state.remainingMs);
    return (
      <div className="readout">
        <p className="clock" role="timer" aria-label={t.card.remaining(clock)}>{clock}</p>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${fraction * 100}%` }} />
        </div>
        {state.totalMs > 0 && <p className="caption">{t.card.leftOf(Math.round(state.totalMs / 60_000))}</p>}
      </div>
    );
  }
  if (state.kind === "unlimited") {
    const clock = formatRemaining(state.playedMs);
    return (
      <div className="readout">
        <p className="clock" role="timer" aria-label={t.card.played(clock)}>{clock}</p>
        <p className="caption">{t.card.unlimitedCaption}</p>
      </div>
    );
  }
  const [word, caption] =
    state.kind === "timeup"
      ? [t.card.timeUp, t.card.ended(formatAgo(state.endedAt, now, serverOffsetMs, t.time))]
      : state.kind === "free"
        ? [t.card.free, t.card.freeCaption]
        : [t.card.offline, t.card.offlineCaption];
  // After an unlimited session, the time to charge takes the big line until the next session.
  const played = state.kind === "free" || state.kind === "offline" ? state.playedMs : undefined;
  return (
    <div className="readout">
      <p className="word">{played === undefined ? word : t.card.played(formatRemaining(played))}</p>
      <p className="caption">{caption}</p>
    </div>
  );
}

export function DeviceCard(props: DeviceCardProps) {
  const { device, games, now, serverOffsetMs } = props;
  const { t } = useI18n();
  const c = t.card;
  const state = bayState(device, now, serverOffsetMs);
  const activeSession =
    state.kind === "playing" || state.kind === "ending" || state.kind === "unlimited" ? device.session : null;
  const [customMin, setCustomMin] = useState("45");
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const status = launchStatus(props.pendingCommandId, device);

  // One picker for both launch paths: apps the headset reported (with a known
  // Meta App ID) and the café's configured game list.
  const mappedInstalled = device.installedApps.filter((app) => app.metaAppId !== null);
  const unmatchedInstalled = device.installedApps.filter((app) => app.metaAppId === null);
  const installedChoices: LaunchChoice[] = mappedInstalled.map((app) => ({
    value: `pkg:${app.packageName}`,
    label: app.name,
    disabled: false,
  }));
  const gameChoices: LaunchChoice[] = games
    .filter((g) => g.enabled)
    .map((g) => {
      const blocked = needsAppId(g.metaAppId);
      return { value: `game:${g.id}`, label: blocked ? c.needsAppId(g.name) : g.name, disabled: blocked };
    });
  const launchable = [...installedChoices, ...gameChoices].filter((choice) => !choice.disabled);
  const lastLaunched = device.expectedGame
    ? device.expectedGame.gameId.startsWith("installed:")
      ? `pkg:${device.expectedGame.gameId.slice("installed:".length)}`
      : `game:${device.expectedGame.gameId}`
    : null;
  const fallback = launchable.find((choice) => choice.value === lastLaunched)?.value ?? launchable[0]?.value ?? "";
  // A pick that vanished (app uninstalled, game disabled) falls back instead of launching stale.
  const selected = picked !== null && launchable.some((choice) => choice.value === picked) ? picked : fallback;
  const canLaunch = device.online && !props.busy && selected !== "";

  function launch() {
    if (selected.startsWith("pkg:")) props.onLaunchInstalled(device.id, selected.slice("pkg:".length));
    else if (selected.startsWith("game:")) props.onLaunch(device.id, selected.slice("game:".length));
  }

  // A disconnected headset's last report is stale; don't present it as what is open now.
  const openNow = !device.online
    ? "—"
    : device.usageAccessGranted === false
      ? c.usageAccessRequired
      : device.usageAccessGranted === null
        ? c.unavailable
        : device.foregroundApp
          ? c.openFor(device.foregroundApp.name, formatElapsedSince(device.foregroundApp.startedAt, now, serverOffsetMs))
          : c.noGameOpen;
  const connection = device.online
    ? c.online
    : device.lastSeenAt
      ? c.seen(formatAgo(device.lastSeenAt, now, serverOffsetMs, t.time))
      : c.neverConnected;

  return (
    <article
      id={`bay-${device.id}`}
      className="bay"
      data-state={state.kind}
      data-online={device.online}
      aria-label={c.state(device.name, device.online)}
    >
      <header className="bay-head">
        <h2>{device.name}</h2>
        <p className="link-state">{connection}</p>
      </header>

      <Readout state={state} now={now} serverOffsetMs={serverOffsetMs} />

      <dl className="facts">
        <div><dt>{c.battery}</dt><dd><Battery level={device.batteryLevel} charging={device.charging} /></dd></div>
        <div><dt>{c.openNow}</dt><dd>{openNow}</dd></div>
        <div><dt>{c.lastLaunched}</dt><dd>{device.expectedGame?.name ?? "—"}</dd></div>
        <div><dt>{c.model}</dt><dd>{device.model ?? "—"}</dd></div>
      </dl>

      {activeSession ? (
        <div className="controls session" role="group" aria-label={c.sessionGroup(device.name)}>
          {/* An unlimited session has no end to extend. */}
          {state.kind !== "unlimited" && (
            <>
              <button className="btn" aria-label={c.extendLabel(15, device.name)} disabled={props.busy} onClick={() => props.onExtend(activeSession.id, 15)}>
                {c.plusMinutes(15)}
              </button>
              <button className="btn" aria-label={c.extendLabel(30, device.name)} disabled={props.busy} onClick={() => props.onExtend(activeSession.id, 30)}>
                {c.plusMinutes(30)}
              </button>
            </>
          )}
          <button className="btn btn-stop" aria-label={c.stopLabel(device.name)} disabled={props.busy} onClick={() => props.onStop(activeSession.id)}>
            {c.stop}
          </button>
        </div>
      ) : (
        <div className="controls start" role="group" aria-label={c.startGroup(device.name)}>
          {[30, 60, 90].map((m) => (
            <button key={m} className="btn" aria-label={c.startLabel(m, device.name)} disabled={props.busy} onClick={() => props.onStartSession(device.id, m)}>
              {c.minutes(m)}
            </button>
          ))}
          <form
            className="custom"
            onSubmit={(event) => {
              event.preventDefault();
              props.onStartSession(device.id, Number(customMin));
            }}
          >
            <span className="minutes">
              <input
                aria-label={c.customLabel(device.name)}
                inputMode="numeric"
                value={customMin}
                onChange={(event) => setCustomMin(event.target.value)}
              />
              <span aria-hidden="true">{c.minutesUnit}</span>
            </span>
            <button className="btn" type="submit" aria-label={c.startCustomLabel(device.name)} disabled={props.busy}>
              {c.start}
            </button>
            <button className="btn" type="button" aria-label={c.startUnlimitedLabel(device.name)} disabled={props.busy} onClick={() => props.onStartSession(device.id, null)}>
              {c.unlimited}
            </button>
          </form>
        </div>
      )}

      <div className="controls launch">
        <select
          aria-label={c.gameFor(device.name)}
          value={selected}
          onChange={(event) => setPicked(event.target.value)}
          disabled={!device.online || props.busy || launchable.length === 0}
        >
          {launchable.length === 0 && <option value="">{c.noGamesReady}</option>}
          {installedChoices.length > 0 && (
            <optgroup label={c.installedGroup}>
              {installedChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </optgroup>
          )}
          {gameChoices.length > 0 && (
            <optgroup label={c.cafeGroup}>
              {gameChoices.map((choice) => (
                <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="btn btn-primary"
          aria-label={c.launchLabel(device.name)}
          disabled={!canLaunch}
          title={!device.online ? c.headsetOffline : undefined}
          onClick={launch}
        >
          {c.launch}
        </button>
      </div>

      {status && (
        <p className="note" data-tone={BADGE_TONE[status.kind]} role="status" aria-live="polite">
          {badgeText(status, c)}
        </p>
      )}
      {props.error && <p className="note" data-tone="bad" role="alert">{props.error}</p>}

      {device.installedApps.length > 0 && (
        <p className="inventory">{c.inventory(device.installedApps.length, mappedInstalled.length)}</p>
      )}
      {unmatchedInstalled.length > 0 && (
        <details className="unmatched">
          <summary>{c.needIds(unmatchedInstalled.length)}</summary>
          <p className="hint">{c.needIdsHint(t.catalog.update)}</p>
          {unmatchedInstalled.map((app) => (
            <UnmatchedAppMapping
              key={app.packageName}
              app={app}
              deviceId={device.id}
              busy={props.busy}
              onMap={props.onMapInstalled}
            />
          ))}
        </details>
      )}

      {!device.online && (
        <footer className="bay-foot">
          {confirmingRemove ? (
            <div
              className="confirm"
              role="group"
              aria-label={c.removeGroup(device.name)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setConfirmingRemove(false);
              }}
            >
              <p>{c.removeQuestion(device.name, device.session?.status === "active")}</p>
              <div className="controls">
                <button className="btn btn-remove" aria-label={c.confirmRemoveLabel(device.name)} disabled={props.busy} onClick={() => props.onRemove(device.id)}>
                  {c.remove}
                </button>
                <button className="btn" aria-label={c.keepLabel(device.name)} autoFocus onClick={() => setConfirmingRemove(false)}>
                  {c.keep}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-text" aria-label={c.removeLabel(device.name)} onClick={() => setConfirmingRemove(true)}>
              {c.removeHeadset}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
