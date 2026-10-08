import type { Device } from "../types";
import { bayState, type BayKind, type BayState } from "../bay";

type Tally = "playing" | "timeup" | "free" | "offline";

const TALLY_WORDS: Array<[Tally, string]> = [
  ["timeup", "time up"],
  ["playing", "playing"],
  ["free", "free"],
  ["offline", "offline"],
];

function minutesLeft(state: BayState): string {
  if (state.kind !== "playing" && state.kind !== "ending") return "";
  const minutes = Math.floor(state.remainingMs / 60_000);
  return minutes < 1 ? "<1" : String(minutes);
}

function describe(name: string, state: BayState): string {
  switch (state.kind) {
    case "playing":
    case "ending":
      return `${name}: ${minutesLeft(state)} min left`;
    case "timeup":
      return `${name}: time up`;
    case "free":
      return `${name}: free`;
    case "offline":
      return `${name}: offline`;
  }
}

/**
 * The whole floor in one line: a pip per headset in board order, showing
 * minutes left, so staff on a phone see every bay without scrolling. Each pip
 * jumps to its card.
 */
export function BoardSummary({ devices, now, serverOffsetMs }: { devices: Device[]; now: number; serverOffsetMs: number }) {
  const bays = devices.map((device) => ({ device, state: bayState(device, now, serverOffsetMs) }));
  const tally: Record<Tally, number> = { playing: 0, timeup: 0, free: 0, offline: 0 };
  for (const { state } of bays) tally[state.kind === "ending" ? "playing" : (state.kind as Exclude<BayKind, "ending">)] += 1;

  return (
    <div className="summary">
      {bays.length > 0 && (
        <ol className="pips" aria-label="Headsets on the floor">
          {bays.map(({ device, state }) => (
            <li key={device.id}>
              <a className="pip" href={`#bay-${device.id}`} data-state={state.kind} aria-label={describe(device.name, state)} title={describe(device.name, state)}>
                {state.kind === "timeup" ? "!" : minutesLeft(state)}
              </a>
            </li>
          ))}
        </ol>
      )}
      <p className="tally" aria-live="polite">
        {TALLY_WORDS.filter(([key]) => tally[key] > 0).map(([key, word]) => (
          <span key={key} data-state={key}>{tally[key]} {word}</span>
        ))}
        {bays.length === 0 && <span>No headsets yet</span>}
      </p>
    </div>
  );
}
