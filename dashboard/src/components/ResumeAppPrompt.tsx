import { useEffect, useId, useRef } from "react";
import { useI18n } from "../i18n";

export type ResumeAppPromptProps = {
  deviceName: string;
  appName: string;
  /** False once the headset is offline: the launch would be refused. */
  canOpen: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

/**
 * Shown after staff end a live view: the customer's app may no longer be in
 * front (CafeQuest's own consent screen took over), so offer to bring it back.
 * Non-modal, like the viewer it replaces; the dashboard stays usable.
 */
export function ResumeAppPrompt({ deviceName, appName, canOpen, onConfirm, onDismiss }: ResumeAppPromptProps) {
  const { t } = useI18n();
  const titleId = useId();
  const bodyId = useId();
  const yesRef = useRef<HTMLButtonElement | null>(null);

  // Staff just pressed Stop on the panel that vanished; keep the keyboard flow going.
  useEffect(() => {
    yesRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <aside className="cast-panel resume-prompt" role="alertdialog" aria-labelledby={titleId} aria-describedby={bodyId}>
      <h2 id={titleId}>{t.cast.resumeTitle}</h2>
      <p id={bodyId} className="cast-body">{t.cast.resumeBody(appName, deviceName)}</p>
      <div className="controls cast-controls">
        <button className="btn" onClick={onDismiss}>
          {t.cast.resumeNo}
        </button>
        <button
          ref={yesRef}
          className="btn btn-primary"
          aria-label={t.cast.resumeYesLabel(appName, deviceName)}
          disabled={!canOpen}
          title={!canOpen ? t.card.headsetOffline : undefined}
          onClick={onConfirm}
        >
          {t.cast.resumeYes}
        </button>
      </div>
    </aside>
  );
}
