import { useState } from "react";
import type { Device, DeviceControllerBattery, Game, InstalledApp } from "../types";
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
  selected?: boolean;
  actionTargetCount?: number;
  actionResult?: string | null;
  /** True while this dashboard owns a live view; every card's live-view action is disabled. */
  castBusy?: boolean;
  onRequestCast?: (deviceId: string) => void;
  onSelectedChange?: (deviceId: string, selected: boolean) => void;
  onLaunch: (deviceId: string, gameId: string) => void;
  onLaunchInstalled: (deviceId: string, packageName: string) => void;
  onMapInstalled: (deviceId: string, packageName: string, name: string, metaAppId: string) => void;
  /** `minutes: null` starts an unlimited session. */
  onStartSession: (deviceId: string, minutes: number | null) => void;
  onExtend: (sessionId: string, minutes: number) => void;
  onStop: (sessionId: string) => void;
  onRemove: (deviceId: string) => void;
};

function InstalledAppDetails(props: {
  app: InstalledApp;
  deviceId: string;
  busy: boolean;
  onMap: DeviceCardProps["onMapInstalled"];
}) {
  const { t } = useI18n();
  const [metaAppId, setMetaAppId] = useState("");
  const valid = /^\d{5,32}$/.test(metaAppId);
  const source = props.app.source === "catalog"
    ? t.card.sourceCatalog
    : props.app.source === "manual"
      ? t.card.sourceManual
      : t.card.sourcePackage;
  return (
    <div className="mapping">
      <div className="mapping-app">
        <div className="mapping-title">
          <strong>{props.app.label}</strong>
          <span className="app-source">{source}</span>
        </div>
        <dl className="app-identifiers">
          <div><dt>{t.card.packageId}</dt><dd><code>{props.app.packageName}</code></dd></div>
          <div><dt>{t.card.metaAppId}</dt><dd>{props.app.metaAppId ? <code>{props.app.metaAppId}</code> : t.card.noMetaAppId}</dd></div>
        </dl>
      </div>
      {props.app.metaAppId === null && (
        <div className="mapping-entry">
          <label className="mapping-field">
            <span>{t.card.appIdLabel(props.app.label)}</span>
            <input
              placeholder={t.card.appIdPlaceholder}
              inputMode="numeric"
              value={metaAppId}
              onChange={(event) => setMetaAppId(event.target.value.trim())}
            />
          </label>
          <button
            className="btn"
            aria-label={t.card.saveLabel(props.app.label)}
            disabled={props.busy || !valid}
            onClick={() => props.onMap(props.deviceId, props.app.packageName, props.app.label, metaAppId)}
          >
            {t.card.save}
          </button>
        </div>
      )}
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

/**
 * Left/right Touch controller levels beside the headset battery. Only rendered
 * while controller monitoring is on (the server sends null when it is off).
 * An inactive or stale reading keeps its percentage and says "last known", so a
 * controller asleep in the drawer is never presented as fresh data.
 */
function ControllerBadges({
  battery,
  name,
  now,
  serverOffsetMs,
}: {
  battery: DeviceControllerBattery;
  name: string;
  now: number;
  serverOffsetMs: number;
}) {
  const { t } = useI18n();
  const c = t.controller;
  const hands = [
    { key: "left" as const, short: c.left, word: c.leftWord },
    { key: "right" as const, short: c.right, word: c.rightWord },
  ];
  const stale = battery.status === "stale";
  // Only ever shown for a reading that exists: "Updated never" would be noise.
  const updated = battery.observedAt ? formatAgo(battery.observedAt, now, serverOffsetMs, t.time) : null;
  return (
    <span className="controllers" role="group" aria-label={c.group(name)}>
      {hands.map(({ key, short, word }) => {
        const reading = battery[key];
        if (!reading) {
          const why = battery.reason ? c.reasons[battery.reason] : c.waiting;
          return (
            <span key={key} className="controller-badge" data-state="unavailable" aria-label={c.unavailable(word)} title={why}>
              {short} <span className="pct">—</span>
            </span>
          );
        }
        const lastKnown = reading.state === "inactive" || stale;
        const label = lastKnown ? c.readingLastKnown(word, reading.level) : c.reading(word, reading.level);
        const why = reading.state === "inactive" ? c.lastKnown : battery.reason ? c.reasons[battery.reason] : null;
        return (
          <span
            key={key}
            className="controller-badge"
            data-state={stale ? "stale" : reading.state}
            aria-label={label}
            title={why ?? label}
          >
            {short} <span className="pct">{reading.level}%</span>
            {lastKnown && <span className="controller-last">{c.lastKnown}</span>}
          </span>
        );
      })}
      {updated && <span className="controller-updated">{c.updated(updated)}</span>}
    </span>
  );
}

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

  // One picker for both launch paths: catalog matches use Meta's API; anything
  // else falls back to its Android package name on the headset.
  const installedChoices: LaunchChoice[] = device.installedApps.map((app) => ({
    value: `pkg:${app.packageName}`,
    label: app.metaAppId === null ? c.androidPackageChoice(app.name) : app.name,
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
  const selectedLabel = launchable.find((choice) => choice.value === selected)?.label ?? "";
  const canLaunch = device.online && !props.busy && selected !== "";
  const actionTargetCount = props.selected === true ? props.actionTargetCount ?? 0 : 0;
  const targetsSelection = actionTargetCount > 0;

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
      data-selected={props.selected === true}
      aria-label={c.state(device.name, device.online)}
    >
      <header className="bay-head">
        <div className="bay-title">
          {props.onSelectedChange && (
            <label className="bay-select">
              <input
                type="checkbox"
                aria-label={c.selectLabel(device.name)}
                checked={props.selected === true}
                onChange={(event) => props.onSelectedChange?.(device.id, event.target.checked)}
              />
            </label>
          )}
          <h2>{device.name}</h2>
        </div>
        <p className="link-state">{connection}</p>
      </header>

      <Readout state={state} now={now} serverOffsetMs={serverOffsetMs} />

      <dl className="facts">
        <div>
          <dt>{c.battery}</dt>
          <dd>
            <Battery level={device.batteryLevel} charging={device.charging} />
            {device.controllerBattery && (
              <ControllerBadges
                battery={device.controllerBattery}
                name={device.name}
                now={now}
                serverOffsetMs={serverOffsetMs}
              />
            )}
          </dd>
        </div>
        <div><dt>{c.openNow}</dt><dd>{openNow}</dd></div>
        <div><dt>{c.lastLaunched}</dt><dd>{device.expectedGame?.name ?? "—"}</dd></div>
        <div><dt>{c.model}</dt><dd>{device.model ?? "—"}</dd></div>
      </dl>

      {/* Live view: online + capable asks; an older agent is told to update. */}
      <div className="controls live-view" role="group" aria-label={t.cast.group(device.name)}>
        {!device.online ? (
          <button className="btn" aria-label={t.cast.offlineLabel(device.name)} title={c.headsetOffline} disabled>
            {t.cast.request}
          </button>
        ) : device.supportsScreenCast ? (
          <button
            className="btn"
            aria-label={t.cast.requestLabel(device.name)}
            disabled={props.busy || props.castBusy === true}
            onClick={() => props.onRequestCast?.(device.id)}
          >
            {t.cast.request}
          </button>
        ) : (
          <button className="btn" aria-label={t.cast.updateAgentLabel(device.name)} title={t.cast.updateAgent} disabled>
            {t.cast.updateAgent}
          </button>
        )}
      </div>

      {targetsSelection && <p className="action-scope">{t.bulk.scope(actionTargetCount)}</p>}

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
            <button
              key={m}
              className="btn"
              aria-label={targetsSelection ? t.bulk.startMinutesLabel(m, actionTargetCount) : c.startLabel(m, device.name)}
              disabled={props.busy}
              onClick={() => props.onStartSession(device.id, m)}
            >
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
                aria-label={targetsSelection ? t.bulk.customMinutes(actionTargetCount) : c.customLabel(device.name)}
                inputMode="numeric"
                value={customMin}
                onChange={(event) => setCustomMin(event.target.value)}
              />
              <span aria-hidden="true">{c.minutesUnit}</span>
            </span>
            <button
              className="btn"
              type="submit"
              aria-label={targetsSelection ? t.bulk.startCustomLabel(actionTargetCount) : c.startCustomLabel(device.name)}
              disabled={props.busy}
            >
              {c.start}
            </button>
            <button
              className="btn"
              type="button"
              aria-label={targetsSelection ? t.bulk.startUnlimitedLabel(actionTargetCount) : c.startUnlimitedLabel(device.name)}
              disabled={props.busy}
              onClick={() => props.onStartSession(device.id, null)}
            >
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
          aria-label={targetsSelection && selectedLabel
            ? t.bulk.launchLabel(selectedLabel, actionTargetCount)
            : c.launchLabel(device.name)}
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
      {props.actionResult && <p className="note action-result" data-tone="wait" role="status">{props.actionResult}</p>}
      {props.error && <p className="note" data-tone="bad" role="alert">{props.error}</p>}

      {device.installedApps.length > 0 && (
        <p className="inventory">{c.inventory(device.installedApps.length)}</p>
      )}
      {device.installedApps.length > 0 && (
        <details className="app-id-list">
          <summary>{c.appIds(device.installedApps.length)}</summary>
          <p className="hint">{c.appIdsHint(t.catalog.update)}</p>
          {device.installedApps.map((app) => (
            <InstalledAppDetails
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
