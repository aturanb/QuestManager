import type { ReactNode } from "react";

export type Lang = "en" | "tr";

/**
 * Every word the board shows, per language. `tr` is typed as `Messages`, so a
 * key added here without its Turkish twin fails the build. Device and game
 * names never take a Turkish suffix ("Quest 02" would need "'yi", "Quest 01"
 * "'i"): phrases put the name before "için" or before a suffixed noun instead.
 */
const en = {
  locale: "en-US",
  language: "Language",
  time: {
    never: "never",
    justNow: "just now",
    secondsAgo: (s: number) => `${s}s ago`,
    minutesAgo: (m: number) => `${m} min ago`,
    hoursAgo: (h: number, m: number) => `${h}h ${m}m ago`,
  },
  app: {
    live: "Live",
    connecting: "Connecting…",
    retry: "Retry",
    headsets: "Headsets",
    emptyTitle: "No headsets yet",
    emptyBody: (command: ReactNode) => (
      <>
        Open CafeQuest on a headset and it shows up here within a few seconds. To try the board without hardware, run{" "}
        {command} on this PC.
      </>
    ),
  },
  keyPrompt: {
    title: "Enter the admin key",
    body: (key: ReactNode, file: ReactNode) => (
      <>
        It's {key} in the {file} file on the café PC. This browser remembers it, so you only enter it once.
      </>
    ),
    label: "Admin key",
    connect: "Connect",
  },
  summary: {
    floor: "Headsets on the floor",
    none: "No headsets yet",
    tally: { timeup: "time up", playing: "playing", free: "free", offline: "offline" },
    minutesLeft: (name: string, minutes: string) => `${name}: ${minutes} min left`,
    unlimited: (name: string, minutes: string) => `${name}: unlimited, ${minutes} min played`,
  },
  catalog: {
    status: (entries: string, fetched: string) => `App list: ${entries}, ${fetched}`,
    sizeUnknown: "size unknown",
    appsKnown: (count: string) => `${count} apps known`,
    updated: (ago: string) => `updated ${ago}`,
    neverFetched: "never fetched",
    update: "Update app list",
    updating: "Updating…",
  },
  bulk: {
    actions: "Headset selection",
    selected: (count: number) => `${count} ${count === 1 ? "headset" : "headsets"} selected`,
    selectAll: "Select all headsets",
    selectAllShort: "Select all",
    clear: "Clear headset selection",
    clearShort: "Clear",
    scope: (count: number) => `Start and Launch apply to ${count} selected ${count === 1 ? "headset" : "headsets"}`,
    startMinutesLabel: (minutes: number, count: number) =>
      `Start ${minutes} minute session on ${count} selected ${count === 1 ? "headset" : "headsets"}`,
    customMinutes: (count: number) =>
      `Custom session minutes for ${count} selected ${count === 1 ? "headset" : "headsets"}`,
    startCustomLabel: (count: number) =>
      `Start custom session on ${count} selected ${count === 1 ? "headset" : "headsets"}`,
    startUnlimitedLabel: (count: number) =>
      `Start unlimited session on ${count} selected ${count === 1 ? "headset" : "headsets"}`,
    sessionResult: (succeeded: number, failed: number) =>
      `Started ${succeeded} ${succeeded === 1 ? "session" : "sessions"}; skipped ${failed} ${failed === 1 ? "headset" : "headsets"}.`,
    launchLabel: (game: string, count: number) =>
      `Launch ${game} on ${count} selected ${count === 1 ? "headset" : "headsets"}`,
    launchResult: (game: string, succeeded: number, failed: number) =>
      `Sent ${game} to ${succeeded} ${succeeded === 1 ? "headset" : "headsets"}; skipped ${failed} ${failed === 1 ? "headset" : "headsets"}.`,
  },
  card: {
    selectLabel: (name: string) => `Select ${name}`,
    online: "Online",
    seen: (ago: string) => `Seen ${ago}`,
    neverConnected: "Never connected",
    state: (name: string, online: boolean) => `${name} ${online ? "online" : "offline"}`,
    remaining: (clock: string) => `${clock} remaining`,
    leftOf: (minutes: number) => `left of ${minutes} min`,
    played: (clock: string) => `${clock} played`,
    unlimitedCaption: "Played so far, no time limit",
    timeUp: "Time up",
    ended: (ago: string) => `Ended ${ago}`,
    free: "Free",
    freeCaption: "Ready for the next player",
    offline: "Offline",
    offlineCaption: "Check it's switched on and on the café Wi-Fi",
    battery: "Battery",
    charging: "charging",
    openNow: "Open now",
    usageAccessRequired: "Usage access required",
    unavailable: "Unavailable",
    openFor: (game: string, elapsed: string) => `${game} for ${elapsed}`,
    noGameOpen: "No game open",
    lastLaunched: "Last launched",
    model: "Model",
    sessionGroup: (name: string) => `Session on ${name}`,
    extendLabel: (minutes: number, name: string) => `Extend session ${minutes} minutes on ${name}`,
    plusMinutes: (minutes: number) => `+${minutes} min`,
    stop: "Stop",
    stopLabel: (name: string) => `Stop session on ${name}`,
    startGroup: (name: string) => `Start a session on ${name}`,
    startLabel: (minutes: number, name: string) => `Start ${minutes} minute session on ${name}`,
    minutes: (minutes: number) => `${minutes} min`,
    minutesUnit: "min",
    customLabel: (name: string) => `Custom session minutes for ${name}`,
    start: "Start",
    startCustomLabel: (name: string) => `Start custom session on ${name}`,
    unlimited: "Unlimited",
    startUnlimitedLabel: (name: string) => `Start unlimited session on ${name}`,
    gameFor: (name: string) => `Game for ${name}`,
    noGamesReady: "No games ready to launch",
    installedGroup: "Installed on this headset",
    cafeGroup: "Café game list",
    needsAppId: (game: string) => `${game} (needs Meta App ID)`,
    launch: "Launch",
    launchLabel: (name: string) => `Launch game on ${name}`,
    headsetOffline: "Headset offline",
    launching: "Launching…",
    launched: "Launched ✓",
    failed: (error: string | null) => `Failed: ${error ?? "unknown error"}`,
    timedOut: "Timed out",
    inventory: (total: number, ready: number) =>
      `${total} ${total === 1 ? "app" : "apps"} on this headset, ${ready} ready to launch`,
    needIds: (count: number) => `${count} ${count === 1 ? "app needs" : "apps need"} a Meta App ID`,
    needIdsHint: (button: string) =>
      `Try “${button}” at the bottom of the page first. Enter an ID only for apps still listed here.`,
    appIdLabel: (app: string) => `Meta App ID for ${app}`,
    appIdPlaceholder: "Meta App ID",
    save: "Save",
    saveLabel: (app: string) => `Save mapping for ${app}`,
    removeGroup: (name: string) => `Remove ${name}?`,
    removeQuestion: (name: string, discardsSession: boolean) =>
      `Remove ${name} from the board?${discardsSession ? " Its running session is discarded too." : ""} It comes back if the headset connects again.`,
    remove: "Remove",
    confirmRemoveLabel: (name: string) => `Confirm removing ${name}`,
    keep: "Keep",
    keepLabel: (name: string) => `Keep ${name}`,
    removeHeadset: "Remove headset",
    removeLabel: (name: string) => `Remove ${name} from the board`,
  },
  errors: {
    // Server error codes, in the words staff need at the counter.
    codes: {
      "headset offline": "Headset is offline. Wait for it to reconnect.",
      headset_online: "This headset is connected. Remove it once it shows offline.",
      "session already active": "A session is already running on this headset.",
      "no active session to extend": "No running session to extend.",
      "no active session to stop": "No running session to stop.",
      app_not_installed: "That game isn't installed on this headset.",
      meta_app_id_unknown: "This app has no Meta App ID yet.",
    } as Record<string, string>,
    // The server's English detail names the game and where to set its ID.
    gameNeedsAppId: (serverDetail: string | null) => serverDetail ?? "This game has no Meta App ID yet.",
    catalogFailed: (detail: string | null) =>
      `Couldn't update the app list${detail ? ` (${detail})` : ""}. The saved list is still in use.`,
    minutes: "enter 1–1440 minutes",
    unreachable: "Can't reach the CafeQuest server. Check it's running on the café PC.",
    requestFailed: (status: number) => `request failed (${status})`,
    fallback: "Request failed.",
  },
};

export type Messages = typeof en;

const tr: Messages = {
  locale: "tr-TR",
  language: "Dil",
  time: {
    never: "hiç",
    justNow: "az önce",
    secondsAgo: (s) => `${s} sn önce`,
    minutesAgo: (m) => `${m} dk önce`,
    hoursAgo: (h, m) => `${h} sa ${m} dk önce`,
  },
  app: {
    live: "Canlı",
    connecting: "Bağlanıyor…",
    retry: "Tekrar dene",
    headsets: "Gözlükler",
    emptyTitle: "Henüz gözlük yok",
    emptyBody: (command) => (
      <>
        Bir gözlükte CafeQuest'i açın, birkaç saniye içinde burada görünür. Panoyu cihaz olmadan denemek için bu
        bilgisayarda {command} komutunu çalıştırın.
      </>
    ),
  },
  keyPrompt: {
    title: "Yönetici anahtarını girin",
    body: (key, file) => (
      <>
        Kafe bilgisayarındaki {file} dosyasında {key} olarak yazılı. Bu tarayıcı anahtarı hatırlar, bir kez girmeniz
        yeterli.
      </>
    ),
    label: "Yönetici anahtarı",
    connect: "Bağlan",
  },
  summary: {
    floor: "Salondaki gözlükler",
    none: "Henüz gözlük yok",
    tally: { timeup: "süre doldu", playing: "oynuyor", free: "boş", offline: "çevrimdışı" },
    minutesLeft: (name, minutes) => `${name}: ${minutes} dk kaldı`,
    unlimited: (name, minutes) => `${name}: sınırsız, ${minutes} dk oynandı`,
  },
  catalog: {
    status: (entries, fetched) => `Uygulama listesi: ${entries}, ${fetched}`,
    sizeUnknown: "boyutu bilinmiyor",
    appsKnown: (count) => `${count} uygulama biliniyor`,
    updated: (ago) => `${ago} güncellendi`,
    neverFetched: "hiç indirilmedi",
    update: "Uygulama listesini güncelle",
    updating: "Güncelleniyor…",
  },
  bulk: {
    actions: "Gözlük seçimi",
    selected: (count) => `${count} gözlük seçildi`,
    selectAll: "Tüm gözlükleri seç",
    selectAllShort: "Tümünü seç",
    clear: "Gözlük seçimini temizle",
    clearShort: "Temizle",
    scope: (count) => `Başlat ve Oyunu aç işlemleri seçili ${count} gözlüğe uygulanır`,
    startMinutesLabel: (minutes, count) => `Seçili ${count} gözlükte ${minutes} dakikalık seans başlat`,
    customMinutes: (count) => `Seçili ${count} gözlük için özel seans süresi (dakika)`,
    startCustomLabel: (count) => `Seçili ${count} gözlükte özel seans başlat`,
    startUnlimitedLabel: (count) => `Seçili ${count} gözlükte sınırsız seans başlat`,
    sessionResult: (succeeded, failed) => `${succeeded} seans başlatıldı; ${failed} gözlük atlandı.`,
    launchLabel: (game, count) => `${game} oyununu seçili ${count} gözlükte aç`,
    launchResult: (game, succeeded, failed) => `${game} ${succeeded} gözlüğe gönderildi; ${failed} gözlük atlandı.`,
  },
  card: {
    selectLabel: (name) => `${name} gözlüğünü seç`,
    online: "Çevrimiçi",
    seen: (ago) => `Son görülme ${ago}`,
    neverConnected: "Hiç bağlanmadı",
    state: (name, online) => `${name} ${online ? "çevrimiçi" : "çevrimdışı"}`,
    remaining: (clock) => `${clock} kaldı`,
    leftOf: (minutes) => `toplam ${minutes} dk`,
    played: (clock) => `${clock} oynandı`,
    unlimitedCaption: "Şu ana kadar oynanan süre, sınır yok",
    timeUp: "Süre doldu",
    ended: (ago) => `${ago} bitti`,
    free: "Boş",
    freeCaption: "Sıradaki oyuncuya hazır",
    offline: "Çevrimdışı",
    offlineCaption: "Açık ve kafe Wi-Fi ağına bağlı olduğunu kontrol edin",
    battery: "Pil",
    charging: "şarj oluyor",
    openNow: "Şu an açık",
    usageAccessRequired: "Kullanım erişimi gerekli",
    unavailable: "Bilgi yok",
    openFor: (game, elapsed) => `${game}, ${elapsed} süredir`,
    noGameOpen: "Açık oyun yok",
    lastLaunched: "Son açılan",
    model: "Model",
    sessionGroup: (name) => `${name} seansı`,
    extendLabel: (minutes, name) => `${name} seansını ${minutes} dakika uzat`,
    plusMinutes: (minutes) => `+${minutes} dk`,
    stop: "Durdur",
    stopLabel: (name) => `${name} seansını durdur`,
    startGroup: (name) => `${name} için seans başlat`,
    startLabel: (minutes, name) => `${name} için ${minutes} dakikalık seans başlat`,
    minutes: (minutes) => `${minutes} dk`,
    minutesUnit: "dk",
    customLabel: (name) => `${name} için özel seans süresi (dakika)`,
    start: "Başlat",
    startCustomLabel: (name) => `${name} için özel seans başlat`,
    unlimited: "Sınırsız",
    startUnlimitedLabel: (name) => `${name} için sınırsız seans başlat`,
    gameFor: (name) => `${name} için oyun`,
    noGamesReady: "Açılmaya hazır oyun yok",
    installedGroup: "Bu gözlükte yüklü",
    cafeGroup: "Kafenin oyun listesi",
    needsAppId: (game) => `${game} (Meta App ID gerekli)`,
    launch: "Oyunu aç",
    launchLabel: (name) => `${name} gözlüğünde oyunu aç`,
    headsetOffline: "Gözlük çevrimdışı",
    launching: "Açılıyor…",
    launched: "Açıldı ✓",
    failed: (error) => `Açılamadı: ${error ?? "bilinmeyen hata"}`,
    timedOut: "Zaman aşımı",
    inventory: (total, ready) => `Bu gözlükte ${total} uygulama var, ${ready} tanesi açılmaya hazır`,
    needIds: (count) => `${count} uygulamanın Meta App ID'si eksik`,
    needIdsHint: (button) =>
      `Önce sayfanın altındaki “${button}” düğmesini deneyin. Yalnızca hâlâ burada listelenen uygulamalar için ID girin.`,
    appIdLabel: (app) => `${app} için Meta App ID`,
    appIdPlaceholder: "Meta App ID",
    save: "Kaydet",
    saveLabel: (app) => `${app} için eşleştirmeyi kaydet`,
    removeGroup: (name) => `${name} gözlüğü kaldırılsın mı?`,
    removeQuestion: (name, discardsSession) =>
      `${name} gözlüğü panodan kaldırılsın mı?${discardsSession ? " Devam eden seansı da silinir." : ""} Yeniden bağlanırsa panoya geri gelir.`,
    remove: "Kaldır",
    confirmRemoveLabel: (name) => `${name} gözlüğünü kaldırmayı onayla`,
    keep: "Vazgeç",
    keepLabel: (name) => `${name} gözlüğü kalsın`,
    removeHeadset: "Gözlüğü kaldır",
    removeLabel: (name) => `${name} gözlüğünü panodan kaldır`,
  },
  errors: {
    codes: {
      "headset offline": "Gözlük çevrimdışı. Yeniden bağlanmasını bekleyin.",
      headset_online: "Bu gözlük bağlı. Çevrimdışı görününce kaldırabilirsiniz.",
      "session already active": "Bu gözlükte zaten bir seans sürüyor.",
      "no active session to extend": "Uzatılacak bir seans yok.",
      "no active session to stop": "Durdurulacak bir seans yok.",
      app_not_installed: "Bu oyun bu gözlükte yüklü değil.",
      meta_app_id_unknown: "Bu uygulamanın henüz Meta App ID'si yok.",
    },
    // The server's detail is English, so Turkish says it in general terms.
    gameNeedsAppId: () => "Bu oyunun henüz Meta App ID'si yok. Gerçek ID'yi cafequest.config.json dosyasına girin.",
    catalogFailed: (detail) =>
      `Uygulama listesi güncellenemedi${detail ? ` (${detail})` : ""}. Kayıtlı liste kullanılmaya devam ediyor.`,
    minutes: "1–1440 dakika girin",
    unreachable: "CafeQuest sunucusuna ulaşılamıyor. Kafe bilgisayarında çalıştığını kontrol edin.",
    requestFailed: (status) => `İstek başarısız oldu (${status})`,
    fallback: "İstek başarısız oldu.",
  },
};

export const messages: Record<Lang, Messages> = { en, tr };
