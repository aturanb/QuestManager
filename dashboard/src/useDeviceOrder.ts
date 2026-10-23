import { useMemo, useState } from "react";
import type { Device } from "./types";

const ORDER_STORAGE = "cq-headset-order";

function readOrder(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(ORDER_STORAGE) ?? "[]");
    return Array.isArray(saved) && saved.every((id) => typeof id === "string")
      ? [...new Set(saved as string[])] : [];
  } catch {
    return [];
  }
}

/** Presentation order stays independent of the server's live device snapshots. */
export function useDeviceOrder(devices: Device[]) {
  const [order, setOrder] = useState(readOrder);
  const [saveFailed, setSaveFailed] = useState(false);
  const orderedDevices = useMemo(() => {
    const remaining = new Map(devices.map((device) => [device.id, device]));
    const ordered: Device[] = [];
    for (const id of order) {
      const device = remaining.get(id);
      if (device) {
        ordered.push(device);
        remaining.delete(id);
      }
    }
    return [...ordered, ...remaining.values()];
  }, [devices, order]);

  function moveDevice(deviceId: string, targetId: string) {
    const from = orderedDevices.findIndex((device) => device.id === deviceId);
    const to = orderedDevices.findIndex((device) => device.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = orderedDevices.map((device) => device.id);
    next.splice(from, 1);
    next.splice(to, 0, deviceId);
    setOrder(next);
    try {
      localStorage.setItem(ORDER_STORAGE, JSON.stringify(next));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }

  return { orderedDevices, moveDevice, saveFailed };
}
