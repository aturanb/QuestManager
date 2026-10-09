package com.cafequest.agent

/** Tone of the headset's link to the café PC; mapped to the dashboard's colors in Theme.kt. */
enum class LinkTone { READY, WAITING, OFFLINE }

data class LinkStatus(val word: String, val caption: String, val tone: LinkTone)

/** What the headset app says about its connection, in the words staff use at the counter. */
fun linkStatus(
    connection: ConnState,
    serverHost: String?,
    serverPort: Int?,
    strings: AgentStrings = EnglishStrings,
): LinkStatus {
    val server = if (serverHost.isNullOrBlank()) null else "$serverHost:${serverPort ?: 3000}"
    return when (connection) {
        ConnState.CONNECTED -> LinkStatus(strings.connected, strings.connectedCaption, LinkTone.READY)
        ConnState.SEARCHING -> LinkStatus(strings.searching, strings.searchingCaption, LinkTone.WAITING)
        ConnState.CONNECTING -> LinkStatus(strings.connecting, strings.reaching(server), LinkTone.WAITING)
        ConnState.DISCONNECTED -> LinkStatus(strings.notConnected, strings.cantReach(server), LinkTone.OFFLINE)
    }
}

/** The diagnostics' raw result ("SUCCESS", "FAILED <code>", "—") in the app's language; codes stay as sent. */
fun displayResult(raw: String, strings: AgentStrings): String = when {
    raw == "SUCCESS" -> strings.success
    raw.startsWith("FAILED ") -> strings.failed(raw.removePrefix("FAILED "))
    else -> raw
}

/** Battery cells lit out of five; a nearly flat battery keeps one so it never reads as unknown. */
fun litBatteryCells(level: Int): Int = if (level <= 0) 0 else maxOf(1, Math.round(level / 20f))
