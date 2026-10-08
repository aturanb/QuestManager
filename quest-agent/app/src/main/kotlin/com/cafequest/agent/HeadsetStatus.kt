package com.cafequest.agent

/** Tone of the headset's link to the café PC; mapped to the dashboard's colors in Theme.kt. */
enum class LinkTone { READY, WAITING, OFFLINE }

data class LinkStatus(val word: String, val caption: String, val tone: LinkTone)

/** What the headset app says about its connection, in the words staff use at the counter. */
fun linkStatus(connection: ConnState, serverHost: String?, serverPort: Int?): LinkStatus {
    val server = if (serverHost.isNullOrBlank()) "the café PC" else "$serverHost:${serverPort ?: 3000}"
    return when (connection) {
        ConnState.CONNECTED -> LinkStatus("Connected", "The café board can see this headset.", LinkTone.READY)
        ConnState.CONNECTING -> LinkStatus("Connecting…", "Reaching $server", LinkTone.WAITING)
        ConnState.DISCONNECTED -> LinkStatus(
            "Not connected",
            "Can't reach $server. Check the café Wi-Fi, then tap Reconnect.",
            LinkTone.OFFLINE,
        )
    }
}

/** Battery cells lit out of five; a nearly flat battery keeps one so it never reads as unknown. */
fun litBatteryCells(level: Int): Int = if (level <= 0) 0 else maxOf(1, Math.round(level / 20f))
