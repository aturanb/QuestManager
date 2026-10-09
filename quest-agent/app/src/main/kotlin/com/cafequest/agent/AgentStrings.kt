package com.cafequest.agent

/** Languages the headset app speaks; [code] is what [LanguageStore] keeps. */
enum class AgentLanguage(val code: String) { EN("en"), TR("tr") }

/** A pick made on this headset wins; until then its system language decides. Junk in storage is no pick. */
fun resolveLanguage(stored: String?, systemLanguage: String): AgentLanguage =
    AgentLanguage.entries.firstOrNull { it.code == stored }
        ?: if (systemLanguage.lowercase().startsWith("tr")) AgentLanguage.TR else AgentLanguage.EN

val AgentLanguage.strings: AgentStrings
    get() = when (this) {
        AgentLanguage.EN -> EnglishStrings
        AgentLanguage.TR -> TurkishStrings
    }

/**
 * Every word the headset app shows. Both languages implement all of it, so a
 * string added here without its Turkish twin does not compile. [server] is
 * null when no host is set up yet.
 */
interface AgentStrings {
    val language: String
    fun agentVersion(version: String): String

    val connected: String
    val connectedCaption: String
    val connecting: String
    fun reaching(server: String?): String
    val notConnected: String
    fun cantReach(server: String?): String

    val server: String
    val battery: String
    val charging: String
    val service: String
    val running: String
    val stopped: String
    val lastLaunched: String
    val lastCommand: String
    val lastResult: String
    val success: String
    fun failed(code: String): String

    val reconnect: String
    val sendTestTelemetry: String
    val testAppLaunch: String
    val changeSetup: String

    val setupTitle: String
    val setupHint: String
    val deviceName: String
    val serverHost: String
    val serverPort: String
    val metaAppId: String
    val saveAndConnect: String
    val cancel: String

    val notificationChannel: String
    val notificationTitle: String
    val notificationText: String
}

object EnglishStrings : AgentStrings {
    override val language = "Language"
    override fun agentVersion(version: String) = "Agent $version"

    override val connected = "Connected"
    override val connectedCaption = "The café board can see this headset."
    override val connecting = "Connecting…"
    override fun reaching(server: String?) = "Reaching ${server ?: "the café PC"}"
    override val notConnected = "Not connected"
    override fun cantReach(server: String?) = "Can't reach ${server ?: "the café PC"}. Check the café Wi-Fi, then tap $reconnect."

    override val server = "Server"
    override val battery = "Battery"
    override val charging = "charging"
    override val service = "Service"
    override val running = "Running"
    override val stopped = "Stopped"
    override val lastLaunched = "Last launched"
    override val lastCommand = "Last command"
    override val lastResult = "Last result"
    override val success = "SUCCESS"
    override fun failed(code: String) = "FAILED $code"

    override val reconnect = "Reconnect"
    override val sendTestTelemetry = "Send test telemetry"
    override val testAppLaunch = "Test app launch"
    override val changeSetup = "Change setup"

    override val setupTitle = "Headset setup"
    override val setupHint = "A field left blank keeps its saved value."
    override val deviceName = "Device name"
    override val serverHost = "Server host"
    override val serverPort = "Server port"
    override val metaAppId = "Meta App ID"
    override val saveAndConnect = "Save and connect"
    override val cancel = "Cancel"

    override val notificationChannel = "CafeQuest agent"
    override val notificationTitle = "CafeQuest agent running"
    override val notificationText = "Connected to café server"
}

// Names and addresses never take a suffix ("Quest 02'yi"): they go before a suffixed noun instead.
object TurkishStrings : AgentStrings {
    override val language = "Dil"
    override fun agentVersion(version: String) = "Sürüm $version"

    override val connected = "Bağlı"
    override val connectedCaption = "Kafe panosu bu gözlüğü görüyor."
    override val connecting = "Bağlanıyor…"
    override fun reaching(server: String?) = if (server == null) "Kafe bilgisayarına ulaşılıyor" else "$server adresine ulaşılıyor"
    override val notConnected = "Bağlı değil"
    override fun cantReach(server: String?) =
        (if (server == null) "Kafe bilgisayarına ulaşılamıyor." else "$server adresine ulaşılamıyor.") +
            " Kafe Wi-Fi ağını kontrol edin, sonra “$reconnect” düğmesine dokunun."

    override val server = "Sunucu"
    override val battery = "Pil"
    override val charging = "şarj oluyor"
    override val service = "Servis"
    override val running = "Çalışıyor"
    override val stopped = "Durdu"
    override val lastLaunched = "Son açılan"
    override val lastCommand = "Son komut"
    override val lastResult = "Son sonuç"
    override val success = "BAŞARILI"
    override fun failed(code: String) = "BAŞARISIZ $code"

    override val reconnect = "Yeniden bağlan"
    override val sendTestTelemetry = "Test telemetrisi gönder"
    override val testAppLaunch = "Uygulama açmayı dene"
    override val changeSetup = "Kurulumu değiştir"

    override val setupTitle = "Gözlük kurulumu"
    override val setupHint = "Boş bırakılan alan kayıtlı değerini korur."
    override val deviceName = "Cihaz adı"
    override val serverHost = "Sunucu adresi"
    override val serverPort = "Sunucu portu"
    override val metaAppId = "Meta App ID"
    override val saveAndConnect = "Kaydet ve bağlan"
    override val cancel = "İptal"

    override val notificationChannel = "CafeQuest servisi"
    override val notificationTitle = "CafeQuest çalışıyor"
    override val notificationText = "Kafe sunucusuna bağlı"
}
