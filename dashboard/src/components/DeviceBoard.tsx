import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { Device } from "../types";

type Props = {
  devices: Device[];
  onMove: (deviceId: string, targetId: string) => void;
  saveFailed: boolean;
  children: (device: Device, reorderControls: ReactNode) => ReactNode;
};

export function DeviceBoard({ devices, onMove, saveFailed, children }: Props) {
  const { t } = useI18n();
  const c = t.reorder;
  const draggingId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{ name: string; position: number; total: number } | null>(null);

  function cancelDrag() {
    draggingId.current = null;
    setDragging(null);
    setTarget(null);
  }

  function move(deviceId: string, targetId: string) {
    const device = devices.find((item) => item.id === deviceId);
    const position = devices.findIndex((item) => item.id === targetId);
    if (!device || position < 0 || deviceId === targetId) return;
    onMove(deviceId, targetId);
    setAnnouncement({ name: device.name, position: position + 1, total: devices.length });
  }

  function acceptDrop(event: DragEvent, deviceId: string) {
    if (!draggingId.current || draggingId.current === deviceId
      || !devices.some((device) => device.id === draggingId.current)) return false;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    return true;
  }

  return (
    <>
      <p id="headset-reorder-help" className="sr-only">{c.help}</p>
      <p className="sr-only" role="status" aria-label={c.status} aria-live="polite" aria-atomic="true">
        {announcement && c.moved(announcement.name, announcement.position, announcement.total)}
      </p>
      {saveFailed && <p className="note reorder-error" role="alert">{c.saveFailed}</p>}
      <section className="board" aria-label={t.app.headsets}>
        {devices.map((device, index) => {
          const earlier = devices[index - 1];
          const later = devices[index + 1];
          const controls = (
            <div className="reorder-controls" role="group" aria-label={c.group(device.name)}>
              <button
                type="button"
                className="icon-btn drag-handle"
                draggable={devices.length > 1}
                disabled={devices.length < 2}
                aria-label={c.drag(device.name)}
                aria-describedby="headset-reorder-help"
                title={c.help}
                onDragStart={(event) => {
                  draggingId.current = device.id;
                  setDragging(device.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", device.id);
                  const card = event.currentTarget.closest(".board-slot");
                  if (card && event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(card, 24, 24);
                }}
                onDragEnd={cancelDrag}
                onKeyDown={(event) => {
                  const neighbor = event.key === "ArrowLeft" || event.key === "ArrowUp" ? earlier
                    : event.key === "ArrowRight" || event.key === "ArrowDown" ? later : null;
                  if (event.key.startsWith("Arrow")) event.preventDefault();
                  if (neighbor) move(device.id, neighbor.id);
                }}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  {[4, 8, 12].map((y) => <g key={y}><circle cx="5" cy={y} r="1" /><circle cx="11" cy={y} r="1" /></g>)}
                </svg>
              </button>
              <button type="button" className="icon-btn" disabled={!earlier}
                aria-label={c.earlier(device.name)} title={c.earlier(device.name)}
                onClick={() => earlier && move(device.id, earlier.id)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 9 4-4 4 4" /></svg>
              </button>
              <button type="button" className="icon-btn" disabled={!later}
                aria-label={c.later(device.name)} title={c.later(device.name)}
                onClick={() => later && move(device.id, later.id)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 7 4 4 4-4" /></svg>
              </button>
            </div>
          );
          return (
            <div key={device.id} className="board-slot" data-dragging={dragging === device.id} data-drop-target={target === device.id}
              onDragEnter={(event) => {
                if (acceptDrop(event, device.id)) setTarget(device.id);
              }}
              onDragOver={(event) => {
                if (acceptDrop(event, device.id)) setTarget(device.id);
                else setTarget(null);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
              }}
              onDrop={(event) => {
                if (acceptDrop(event, device.id)) move(draggingId.current!, device.id);
                cancelDrag();
              }}>
              {children(device, controls)}
            </div>
          );
        })}
      </section>
    </>
  );
}
