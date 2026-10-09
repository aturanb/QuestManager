import { useI18n } from "../i18n";
import type { ControllerBatteryMonitoringState } from "../types";

export type ControllerBatteryToggleProps = {
  /** Server-confirmed state; the switch never moves ahead of it. */
  state: ControllerBatteryMonitoringState;
  pending: boolean;
  error: string | null;
  onChange: (enabled: boolean) => void;
};

/**
 * The one global switch for optional controller-battery monitoring. It controls
 * CafeQuest's own ADB collection only — the help text says plainly that it does
 * not touch Wireless Debugging inside Horizon OS.
 */
export function ControllerBatteryToggle({ state, pending, error, onChange }: ControllerBatteryToggleProps) {
  const { t } = useI18n();
  const c = t.controller;
  const helpId = "controller-battery-help";
  // "Disabled" only ever describes the off position; ready needs no badge.
  const status = state.enabled && state.availability !== "ready" ? c.availability[state.availability] : null;
  return (
    <div className="controller-toggle" data-enabled={state.enabled}>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={state.enabled}
        aria-label={c.switchLabel}
        aria-describedby={helpId}
        disabled={pending}
        onClick={() => onChange(!state.enabled)}
      >
        <span className="switch-knob" aria-hidden="true" />
      </button>
      <span className="controller-copy">
        <span className="controller-label">{c.label}</span>
        <span className="controller-status" role="status">
          {pending ? c.pending : status ?? ""}
        </span>
      </span>
      <span className="sr-only" id={helpId}>
        {c.help}
      </span>
      {error != null && (
        <span className="controller-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
