import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { friendlyError } from "./errors";
import { messages } from "./messages";

const tr = messages.tr;

describe("friendlyError", () => {
  it("tells staff a connected headset cannot be removed yet", () => {
    expect(friendlyError(new ApiError(409, "headset_online", "this headset is connected"))).toBe(
      "This headset is connected. Remove it once it shows offline."
    );
  });

  it("does not call every 409 an offline headset", () => {
    expect(friendlyError(new ApiError(409, "session already active"))).toBe("A session is already running on this headset.");
    expect(friendlyError(new ApiError(409, "headset offline", "device not connected"))).toBe(
      "Headset is offline. Wait for it to reconnect."
    );
  });

  it("asks staff to update an older headset agent before package launching", () => {
    expect(friendlyError(new ApiError(409, "agent_update_required"))).toBe(
      "Update CafeQuest Agent on this headset to launch apps by Android package."
    );
    expect(friendlyError(new ApiError(409, "agent_update_required"), tr)).toBe(
      "Uygulamaları Android paketiyle açmak için bu gözlükteki CafeQuest Agent'ı güncelleyin."
    );
  });

  it("passes through the server's explanation for an unconfigured game", () => {
    expect(friendlyError(new ApiError(400, "game_meta_app_id_not_configured", 'game "Beat Saber" still has a placeholder'))).toBe(
      'game "Beat Saber" still has a placeholder'
    );
  });

  it("keeps unknown codes and their detail visible", () => {
    expect(friendlyError(new ApiError(500, "brand_new_code", "boom"))).toBe("brand_new_code: boom");
    expect(friendlyError(new ApiError(500, "brand_new_code", "boom"), tr)).toBe("brand_new_code: boom");
  });

  it("says a failed app list update kept the saved list", () => {
    expect(friendlyError(new ApiError(502, "catalog_refresh_failed", "HTTP 503"))).toBe(
      "Couldn't update the app list (HTTP 503). The saved list is still in use."
    );
    expect(friendlyError(new ApiError(502, "catalog_refresh_failed", "HTTP 503"), tr)).toBe(
      "Uygulama listesi güncellenemedi (HTTP 503). Kayıtlı liste kullanılmaya devam ediyor."
    );
  });

  it("asks for 1–1440 minutes when the server refuses a session length", () => {
    expect(friendlyError(new ApiError(400, "invalid session body"))).toBe("enter 1–1440 minutes");
    expect(friendlyError(new ApiError(400, "invalid session body"), tr)).toBe("1–1440 dakika girin");
  });

  it("explains an unreachable server", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/can't reach the CafeQuest server/i);
  });
});

describe("friendlyError in Turkish", () => {
  it("says known server codes in Turkish", () => {
    expect(friendlyError(new ApiError(409, "headset_online", "this headset is connected"), tr)).toBe(
      "Bu gözlük bağlı. Çevrimdışı görününce kaldırabilirsiniz."
    );
    expect(friendlyError(new ApiError(409, "headset offline", "device not connected"), tr)).toBe(
      "Gözlük çevrimdışı. Yeniden bağlanmasını bekleyin."
    );
  });

  it("does not show the server's English detail for an unconfigured game", () => {
    const message = friendlyError(new ApiError(400, "game_meta_app_id_not_configured", 'game "Beat Saber" still has a placeholder'), tr);
    expect(message).toMatch(/^Bu oyunun henüz Meta App ID'si yok/);
    expect(message).not.toMatch(/placeholder/);
  });

  it("translates a reply that carried no error code", () => {
    expect(friendlyError(new ApiError(500, "request failed (500)"), tr)).toBe("İstek başarısız oldu (500)");
  });

  it("explains an unreachable server", () => {
    expect(friendlyError(new TypeError("Failed to fetch"), tr)).toBe(
      "CafeQuest sunucusuna ulaşılamıyor. Kafe bilgisayarında çalıştığını kontrol edin."
    );
  });
});
