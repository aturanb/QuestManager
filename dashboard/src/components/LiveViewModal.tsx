import { useEffect, useId, useRef, useState } from "react";
import type { CastViewState } from "../casting";
import { castErrorText } from "../errors";
import { useI18n } from "../i18n";

export type LiveViewModalProps = {
  deviceName: string;
  state: CastViewState;
  stream: MediaStream | null;
  /** Ends capture and closes the viewer. */
  onStop: () => void;
  onRetry: () => void;
  onClose: () => void;
};

/**
 * The only cast viewer. It renders CastClient state and never touches WebRTC
 * directly; the remote MediaStream is attached to the <video> element and never
 * copied into application state.
 */
export function LiveViewModal({ deviceName, state, stream, onStop, onRetry, onClose }: LiveViewModalProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [noPicture, setNoPicture] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const contentId = useId();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.srcObject = state.phase === "live" ? stream : null;
    } catch {
      /* a browser without srcObject just shows a blank frame */
    }
    // Autoplay rejection is not a stream failure.
    void Promise.resolve(video.play()).catch(() => undefined);
    return () => {
      try {
        video.srcObject = null;
      } catch {
        /* already detached */
      }
    };
  }, [state.phase, stream]);

  // A game that blocks capture yields no track; say so instead of failing the session.
  useEffect(() => {
    if (state.phase !== "live" || stream) {
      setNoPicture(false);
      return;
    }
    const timer = setTimeout(() => setNoPicture(true), 10_000);
    return () => clearTimeout(timer);
  }, [state.phase, stream]);

  // Escape closes the viewer, which stops the stream in App.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const phaseWord =
    state.phase === "connecting"
      ? t.cast.connecting
      : state.phase === "awaiting_approval"
        ? t.cast.awaiting
        : state.phase === "negotiating"
          ? t.cast.negotiating
          : state.phase === "live"
            ? t.cast.live
            : t.cast.failed;

  const body =
    state.phase === "connecting"
      ? t.cast.connectingBody
      : state.phase === "awaiting_approval"
        ? t.cast.awaitingBody
        : state.phase === "negotiating"
          ? t.cast.negotiatingBody
          : state.phase === "live"
            ? t.cast.liveBody(deviceName)
            : castErrorText(state.error, t);

  return (
      <aside className="cast-panel" aria-label={t.cast.modalTitle(deviceName)} data-minimized={minimized}>
        <header className="cast-head">
          <div className="cast-title">
          <h2>{t.cast.modalTitle(deviceName)}</h2>
          <p className="cast-phase" role="status" aria-live="polite" data-phase={state.phase}>
            {phaseWord}
          </p>
          </div>
          <div className="cast-head-actions">
            <button
              className="btn"
              aria-controls={contentId}
              aria-expanded={!minimized}
              aria-label={minimized ? t.cast.expandLabel(deviceName) : t.cast.minimizeLabel(deviceName)}
              onClick={() => setMinimized((current) => !current)}
            >
              {minimized ? t.cast.expand : t.cast.minimize}
            </button>
            <button className="btn" aria-label={t.cast.closeLabel(deviceName)} onClick={onClose}>
              {t.cast.close}
            </button>
          </div>
        </header>
        {!minimized && (
          <div className="cast-content" id={contentId}>
            <p className="cast-body">{body}</p>

            {state.phase === "live" && (
              <div className="cast-video">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live video has no audio track */}
                <video ref={videoRef} autoPlay muted playsInline aria-label={t.cast.videoLabel(deviceName)} />
                {noPicture && (
                  <p className="note" data-tone="wait" role="status">
                    {t.cast.noPicture}
                  </p>
                )}
              </div>
            )}

            <div className="controls cast-controls">
              {state.phase === "live" && (
                <button className="btn btn-stop" onClick={onStop}>
                  {t.cast.stop}
                </button>
              )}
              {state.phase === "failed" && (
                <button className="btn btn-primary" aria-label={t.cast.retryLabel(deviceName)} onClick={onRetry}>
                  {t.cast.retry}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
  );
}
