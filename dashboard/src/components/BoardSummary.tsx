import type { Device } from "../types";
import { bayState, type BayKind, type BayState } from "../bay";
import { useI18n, type Messages } from "../i18n";

type Tally = "playing" | "timeup" | "free" | "offline";

const TALLY_ORDER: Tally[] = ["timeup", "playing", "free", "offline"];

// The last minutes and unlimited sessions are still people playing.
const TALLY_OF: Record<BayKind, Tally> = {
  playing: "playing",
  ending: "playing",
  unlimited: "playing",
  timeup: "timeup",
  free: "free",
  offline: "offline",
};

function wholeMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? "<1" : String(minutes);
}

function minutesLeft(state: BayState): string {
  return state.kind === "playing" || state.kind === "ending" ? wholeMinutes(state.remainingMs) : "";
}

function describe(name: string, state: BayState, t: Messages["summary"]): string {
  switch (state.kind) {
    case "playing":
    case "ending":
      return t.minutesLeft(name, minutesLeft(state));
    case "unlimited":
      return t.unlimited(name, wholeMinutes(state.playedMs));
    case "timeup":
    case "free":
    case "offline":
      return `${name}: ${t.tally[state.kind]}`;
  }
}

/**
 * The whole floor in one line: a pip per headset in board order, showing
 * minutes left, so staff on a phone see every bay without scrolling. Each pip
 * jumps to its card.
 */
export function BoardSummary({ devices, now, serverOffsetMs }: { devices: Device[]; now: number; serverOffsetMs: number }) {
  const t = useI18n().t.summary;
  const bays = devices.map((device) => ({ device, state: bayState(device, now, serverOffsetMs) }));
  const tally: Record<Tally, number> = { playing: 0, timeup: 0, free: 0, offline: 0 };
  for (const { state } of bays) tally[TALLY_OF[state.kind]] += 1;

  return (
    <div className="summary">
      {bays.length > 0 && (
        <ol className="pips" aria-label={t.floor}>
          {bays.map(({ device, state }) => (
            <li key={device.id}>
              <a className="pip" href={`#bay-${device.id}`} data-state={state.kind} aria-label={describe(device.name, state, t)} title={describe(device.name, state, t)}>
                {state.kind === "timeup" ? "!" : state.kind === "unlimited" ? "∞" : minutesLeft(state)}
              </a>
            </li>
          ))}
        </ol>
      )}
      <p className="tally" aria-live="polite">
        {TALLY_ORDER.filter((key) => tally[key] > 0).map((key) => (
          <span key={key} data-state={key}>{tally[key]} {t.tally[key]}</span>
        ))}
        {bays.length === 0 && <span>{t.none}</span>}
      </p>
    </div>
  );
}
