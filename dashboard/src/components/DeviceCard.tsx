import { useState } from "react";
import type { Device, Game, InstalledApp } from "../types";
import { bayState, type BayState } from "../bay";
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
  onStartSession: (deviceId: string, minutes: number) => void;
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
          aria-label={`Meta App ID for ${props.app.label}`}
          placeholder="Meta App ID"
          inputMode="numeric"
          value={metaAppId}
          onChange={(event) => setMetaAppId(event.target.value.trim())}
        />
        <button
          className="btn"
          aria-label={`Save mapping for ${props.app.label}`}
          disabled={props.busy || !valid}
          onClick={() => props.onMap(props.deviceId, props.app.packageName, props.app.label, metaAppId)}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** Launch badge derived from the tracked command id + snapshot lastCommand (§21 states). */
export function launchBadge(pendingCommandId: string | null, device: Device): string | null {
  if (!pendingCommandId) {
    if (device.lastCommand?.status === "failed") return `Failed: ${device.lastCommand.error ?? "unknown error"}`;
    if (device.lastCommand?.status === "timeout") return "Timed out";
    return null;
  }
  const last = device.lastCommand;
  if (!last || last.id !== pendingCommandId) return "Launching…";
  if (last.status === "success") return "Launched ✓";
  if (last.status === "failed") return `Failed: ${last.error ?? "unknown error"}`;
  if (last.status === "timeout") return "Timed out";
  return "Launching…";
}

function badgeTone(badge: string): "ok" | "bad" | "wait" {
  if (badge.startsWith("Launched")) return "ok";
  if (badge.startsWith("Failed") || badge === "Timed out") return "bad";
  return "wait";
}

/** Mirrors the server's isPlaceholderAppId: launches of these are refused, so they are not offered. */
function needsAppId(metaAppId: string): boolean {
  return !metaAppId.trim() || metaAppId === "UNCONFIGURED" || metaAppId.includes("FILL_");
}

type LaunchChoice = { value: string; label: string; disabled: boolean };

function Battery({ level, charging }: { level: number | null; charging: boolean | null }) {
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
      {charging && <span className="charging">charging</span>}
    </span>
  );
}

function Readout({ state, now, serverOffsetMs }: { state: BayState; now: number; serverOffsetMs: number }) {
  if (state.kind === "playing" || state.kind === "ending") {
    const fraction = state.totalMs > 0 ? Math.min(1, Math.max(0, state.remainingMs / state.totalMs)) : 1;
    const clock = formatRemaining(state.remainingMs);
    return (
      <div className="readout">
        <p className="clock" role="timer" aria-label={`${clock} remaining`}>{clock}</p>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${fraction * 100}%` }} />
        </div>
        {state.totalMs > 0 && <p className="caption">left of {Math.round(state.totalMs / 60_000)} min</p>}
      </div>
    );
  }
  const [word, caption] =
    state.kind === "timeup"
      ? ["Time up", `Ended ${formatAgo(state.endedAt, now, serverOffsetMs)}`]
      : state.kind === "free"
        ? ["Free", "Ready for the next player"]
        : ["Offline", "Check it's switched on and on the café Wi-Fi"];
  return (
    <div className="readout">
      <p className="word">{word}</p>
      <p className="caption">{caption}</p>
    </div>
  );
}

export function DeviceCard(props: DeviceCardProps) {
  const { device, games, now, serverOffsetMs } = props;
  const state = bayState(device, now, serverOffsetMs);
  const activeSession = state.kind === "playing" || state.kind === "ending" ? device.session : null;
  const [customMin, setCustomMin] = useState("45");
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const badge = launchBadge(props.pendingCommandId, device);

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
      return { value: `game:${g.id}`, label: blocked ? `${g.name} (needs Meta App ID)` : g.name, disabled: blocked };
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
      ? "Usage access required"
      : device.usageAccessGranted === null
        ? "Unavailable"
        : device.foregroundApp
          ? `${device.foregroundApp.name} for ${formatElapsedSince(device.foregroundApp.startedAt, now, serverOffsetMs)}`
          : "No game open";
  const connection = device.online
    ? "Online"
    : device.lastSeenAt
      ? `Seen ${formatAgo(device.lastSeenAt, now, serverOffsetMs)}`
      : "Never connected";

  return (
    <article
      id={`bay-${device.id}`}
      className="bay"
      data-state={state.kind}
      data-online={device.online}
      aria-label={`${device.name} ${device.online ? "online" : "offline"}`}
    >
      <header className="bay-head">
        <h2>{device.name}</h2>
        <p className="link-state">{connection}</p>
      </header>

      <Readout state={state} now={now} serverOffsetMs={serverOffsetMs} />

      <dl className="facts">
        <div><dt>Battery</dt><dd><Battery level={device.batteryLevel} charging={device.charging} /></dd></div>
        <div><dt>Open now</dt><dd>{openNow}</dd></div>
        <div><dt>Last launched</dt><dd>{device.expectedGame?.name ?? "—"}</dd></div>
      </dl>

      {activeSession ? (
        <div className="controls session" role="group" aria-label={`Session on ${device.name}`}>
          <button className="btn" aria-label={`Extend session 15 minutes on ${device.name}`} disabled={props.busy} onClick={() => props.onExtend(activeSession.id, 15)}>
            +15 min
          </button>
          <button className="btn" aria-label={`Extend session 30 minutes on ${device.name}`} disabled={props.busy} onClick={() => props.onExtend(activeSession.id, 30)}>
            +30 min
          </button>
          <button className="btn btn-stop" aria-label={`Stop session on ${device.name}`} disabled={props.busy} onClick={() => props.onStop(activeSession.id)}>
            Stop
          </button>
        </div>
      ) : (
        <div className="controls start" role="group" aria-label={`Start a session on ${device.name}`}>
          {[30, 60, 90].map((m) => (
            <button key={m} className="btn" aria-label={`Start ${m} minute session on ${device.name}`} disabled={props.busy} onClick={() => props.onStartSession(device.id, m)}>
              {m} min
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
                aria-label={`Custom session minutes for ${device.name}`}
                inputMode="numeric"
                value={customMin}
                onChange={(event) => setCustomMin(event.target.value)}
              />
              <span aria-hidden="true">min</span>
            </span>
            <button className="btn" type="submit" aria-label={`Start custom session on ${device.name}`} disabled={props.busy}>
              Start
            </button>
          </form>
        </div>
      )}

      <div className="controls launch">
        <select
          aria-label={`Game for ${device.name}`}
          value={selected}
          onChange={(event) => setPicked(event.target.value)}
          disabled={!device.online || props.busy || launchable.length === 0}
        >
          {launchable.length === 0 && <option value="">No games ready to launch</option>}
          {installedChoices.length > 0 && (
            <optgroup label="Installed on this headset">
              {installedChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </optgroup>
          )}
          {gameChoices.length > 0 && (
            <optgroup label="Café game list">
              {gameChoices.map((choice) => (
                <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="btn btn-primary"
          aria-label={`Launch game on ${device.name}`}
          disabled={!canLaunch}
          title={!device.online ? "Headset offline" : undefined}
          onClick={launch}
        >
          Launch
        </button>
      </div>

      {badge && <p className="note" data-tone={badgeTone(badge)} role="status" aria-live="polite">{badge}</p>}
      {props.error && <p className="note" data-tone="bad" role="alert">{props.error}</p>}

      {device.installedApps.length > 0 && (
        <p className="inventory">
          {device.installedApps.length} {device.installedApps.length === 1 ? "app" : "apps"} on this headset, {mappedInstalled.length} ready to launch
        </p>
      )}
      {unmatchedInstalled.length > 0 && (
        <details className="unmatched">
          <summary>
            {unmatchedInstalled.length} {unmatchedInstalled.length === 1 ? "app needs" : "apps need"} a Meta App ID
          </summary>
          <p className="hint">Try “Update app list” at the bottom of the page first. Enter an ID only for apps still listed here.</p>
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
              aria-label={`Remove ${device.name}?`}
              onKeyDown={(event) => {
                if (event.key === "Escape") setConfirmingRemove(false);
              }}
            >
              <p>
                Remove {device.name} from the board?
                {device.session?.status === "active" && " Its running session is discarded too."} It
                comes back if the headset connects again.
              </p>
              <div className="controls">
                <button className="btn btn-remove" aria-label={`Confirm removing ${device.name}`} disabled={props.busy} onClick={() => props.onRemove(device.id)}>
                  Remove
                </button>
                <button className="btn" aria-label={`Keep ${device.name}`} autoFocus onClick={() => setConfirmingRemove(false)}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-text" aria-label={`Remove ${device.name} from the board`} onClick={() => setConfirmingRemove(true)}>
              Remove headset
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
