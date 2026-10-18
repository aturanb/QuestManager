import { useState } from "react";
import type { Device, Game } from "../types";
import { useI18n } from "../i18n";

/** Mirrors the server's isPlaceholderAppId: launches of these are refused, so they are not offered. */
function needsAppId(metaAppId: string): boolean {
  return !metaAppId.trim() || metaAppId === "UNCONFIGURED" || metaAppId.includes("FILL_");
}

type LaunchChoice = { value: string; label: string; disabled: boolean };

export type LaunchPickerState = {
  installedChoices: LaunchChoice[];
  gameChoices: LaunchChoice[];
  launchable: LaunchChoice[];
  /** `pkg:<package>` or `game:<id>`; empty when nothing can be launched. */
  selected: string;
  selectedLabel: string;
  select: (value: string) => void;
};

/**
 * One picker for both launch paths. Installed apps use their Android package
 * on capable agents; catalog/manual Meta IDs remain a fallback for older
 * agents. Shared by the headset card and the live-view panel so the two never
 * offer different lists.
 */
export function useLaunchPicker(device: Device, games: Game[]): LaunchPickerState {
  const { t } = useI18n();
  const c = t.card;
  const [picked, setPicked] = useState<string | null>(null);

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

  return { installedChoices, gameChoices, launchable, selected, selectedLabel, select: setPicked };
}

/** Routes the picked value to the matching launch callback. */
export function launchSelected(
  selected: string,
  deviceId: string,
  handlers: {
    onLaunch: (deviceId: string, gameId: string) => void;
    onLaunchInstalled: (deviceId: string, packageName: string) => void;
  }
): void {
  if (selected.startsWith("pkg:")) handlers.onLaunchInstalled(deviceId, selected.slice("pkg:".length));
  else if (selected.startsWith("game:")) handlers.onLaunch(deviceId, selected.slice("game:".length));
}

export function LaunchSelect({
  picker,
  ariaLabel,
  disabled,
}: {
  picker: LaunchPickerState;
  ariaLabel: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const c = t.card;
  return (
    <select
      aria-label={ariaLabel}
      value={picker.selected}
      onChange={(event) => picker.select(event.target.value)}
      disabled={disabled || picker.launchable.length === 0}
    >
      {picker.launchable.length === 0 && <option value="">{c.noGamesReady}</option>}
      {picker.installedChoices.length > 0 && (
        <optgroup label={c.installedGroup}>
          {picker.installedChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </optgroup>
      )}
      {picker.gameChoices.length > 0 && (
        <optgroup label={c.cafeGroup}>
          {picker.gameChoices.map((choice) => (
            <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
