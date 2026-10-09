import { useState } from "react";
import { useI18n } from "../i18n";
import type { Game } from "../types";

export type BulkResult =
  | { action: "session"; succeeded: number; failed: number }
  | { action: "launch"; gameName: string; succeeded: number; failed: number };

export type BulkActionsProps = {
  selectedCount: number;
  totalCount: number;
  games: Game[];
  busy: boolean;
  result: BulkResult | null;
  onSelectAll: () => void;
  onClear: () => void;
  onStartSession: (minutes: number | null) => void;
  onLaunchGame: (gameId: string, gameName: string) => void;
};

export function BulkActions({
  selectedCount,
  totalCount,
  games,
  busy,
  result,
  onSelectAll,
  onClear,
  onStartSession,
  onLaunchGame,
}: BulkActionsProps) {
  const { t } = useI18n();
  const [sessionMinutes, setSessionMinutes] = useState("60");
  const [customMinutes, setCustomMinutes] = useState("45");
  const [pickedGameId, setPickedGameId] = useState("");
  const chosenMinutes = sessionMinutes === "unlimited"
    ? null
    : sessionMinutes === "custom"
      ? Number(customMinutes)
      : Number(sessionMinutes);
  const sessionLengthValid = chosenMinutes === null
    || (Number.isInteger(chosenMinutes) && chosenMinutes >= 1 && chosenMinutes <= 24 * 60);
  const launchableGames = games.filter((game) => {
    const appId = game.metaAppId.trim();
    return game.enabled && appId !== "" && appId !== "UNCONFIGURED" && !appId.includes("FILL_");
  });
  const pickedGame = launchableGames.find((game) => game.id === pickedGameId) ?? launchableGames[0] ?? null;
  return (
    <section className="bulk" aria-label={t.bulk.actions}>
      <div className="bulk-top">
        <p className="bulk-count" aria-live="polite">{t.bulk.selected(selectedCount)}</p>
        <div className="bulk-pick">
          <button
            className="btn"
            type="button"
            aria-label={t.bulk.selectAll}
            disabled={selectedCount === totalCount}
            onClick={onSelectAll}
          >
            {t.bulk.selectAllShort}
          </button>
          {selectedCount > 0 && (
            <button className="btn-text" type="button" aria-label={t.bulk.clear} onClick={onClear}>
              {t.bulk.clearShort}
            </button>
          )}
        </div>
      </div>
      {selectedCount > 0 && (
        <div className="bulk-body">
          <div className="bulk-action">
            <label htmlFor="bulk-session-length">{t.bulk.sessionTitle}</label>
            <select
              id="bulk-session-length"
              aria-label={t.bulk.sessionLength}
              value={sessionMinutes}
              disabled={busy}
              onChange={(event) => setSessionMinutes(event.target.value)}
            >
              {[30, 60, 90].map((minutes) => (
                <option key={minutes} value={minutes}>{t.card.minutes(minutes)}</option>
              ))}
              <option value="custom">{t.bulk.custom}</option>
              <option value="unlimited">{t.card.unlimited}</option>
            </select>
            {sessionMinutes === "custom" && (
              <span className="minutes bulk-minutes">
                <input
                  aria-label={t.bulk.customMinutes}
                  inputMode="numeric"
                  value={customMinutes}
                  disabled={busy}
                  onChange={(event) => setCustomMinutes(event.target.value)}
                />
                <span aria-hidden="true">{t.card.minutesUnit}</span>
              </span>
            )}
            <button
              className="btn btn-primary"
              type="button"
              aria-label={t.bulk.startLabel(selectedCount)}
              disabled={busy || !sessionLengthValid}
              onClick={() => onStartSession(chosenMinutes)}
            >
              {busy ? t.bulk.working : t.bulk.start}
            </button>
          </div>
          <div className="bulk-action">
            <label htmlFor="bulk-game">{t.bulk.launchTitle}</label>
            <select
              id="bulk-game"
              aria-label={t.bulk.gameLabel}
              value={pickedGame?.id ?? ""}
              disabled={busy || launchableGames.length === 0}
              onChange={(event) => setPickedGameId(event.target.value)}
            >
              {launchableGames.length === 0 ? (
                <option value="">{t.card.noGamesReady}</option>
              ) : launchableGames.map((game) => (
                <option key={game.id} value={game.id}>{game.name}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              type="button"
              aria-label={pickedGame ? t.bulk.launchLabel(pickedGame.name, selectedCount) : t.bulk.launchUnavailable}
              disabled={busy || pickedGame === null}
              onClick={() => pickedGame && onLaunchGame(pickedGame.id, pickedGame.name)}
            >
              {busy ? t.bulk.launching : t.bulk.launch}
            </button>
          </div>
          {result && (
            <p className="bulk-result" role="status">
              {result.action === "session"
                ? t.bulk.sessionResult(result.succeeded, result.failed)
                : t.bulk.launchResult(result.gameName, result.succeeded, result.failed)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
