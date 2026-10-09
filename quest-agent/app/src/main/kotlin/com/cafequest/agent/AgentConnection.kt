package com.cafequest.agent

import android.content.Context
import android.util.Log
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** Connection state surfaced on the diagnostics screen. */
enum class ConnState { DISCONNECTED, SEARCHING, CONNECTING, CONNECTED }

/**
 * OkHttp WebSocket agent loop (§24): hello → telemetry every 5s → ack/result
 * on launch commands, with §25 backoff reconnect. Network loss never crashes.
 * In Auto mode the loop finds the café PC on the Wi-Fi first (ServerLocator).
 */
class AgentConnection(
    private val context: Context,
    private val identity: AgentIdentity,
    private val launcher: AppLauncher,
    private val diagnostics: AgentDiagnostics = AgentRuntime.diagnostics,
    private val installedAppsProvider: () -> InstalledAppScanResult = { scanInstalledApps(context) },
    private val foregroundAppReader: ForegroundAppReader = AndroidForegroundAppReader(context),
    private val discovery: ServerDiscovery = ServerDiscovery({ wifiBroadcastTargets(context) }),
) : ManagedAgentConnection {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        // A LAN connect takes milliseconds; an old IP the café PC left must not cost 10s a try.
        .connectTimeout(3, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private val locator = ServerLocator(
        initial = identity.serverTarget(),
        search = { discovery.search() },
        persist = { found -> IdentityStore(context).saveDiscovered(found) },
        onSearching = { diagnostics.setConnection(ConnState.SEARCHING) },
        onTarget = {
            diagnostics.setServer(it)
            Log.i(LOG_TAG, "found ${it.name} at ${it.host}:${it.port}")
        },
    )

    @Volatile private var socket: WebSocket? = null
    @Volatile private var running = false
    @Volatile private var managedPackages: Set<String> = emptySet()
    private var attempt = 0

    override fun start() {
        if (running) return
        running = true
        diagnostics.setServer(locator.target)
        scope.launch { loop() }
        scope.launch { telemetryLoop() }
    }

    fun stop() {
        running = false
        val activeSocket = socket
        socket = null
        try { activeSocket?.close(1000, "stop") } catch (_: Exception) { }
        diagnostics.setConnection(ConnState.DISCONNECTED)
    }

    override fun reconnect() {
        val activeSocket = socket
        socket = null
        try { activeSocket?.close(1000, "manual-reconnect") } catch (_: Exception) { }
    }

    override fun destroy() {
        stop()
        scope.cancel()
        client.dispatcher.executorService.shutdown()
    }

    /** One-shot telemetry used by the diagnostics [Send test telemetry] button. */
    override fun sendTestTelemetry() {
        scope.launch { sendTelemetry() }
    }

    override suspend fun testLastLaunch() {
        diagnostics.testLastLaunch(launcher)
    }

    private suspend fun loop() {
        while (running && scope.isActive) {
            val server = locator.beforeConnect(attempt)
            if (!running) break
            if (server.host.isBlank()) {
                // Nothing saved and nothing answered: wait like a failed connect, then search again.
                diagnostics.setConnection(ConnState.DISCONNECTED)
            } else {
                diagnostics.setConnection(ConnState.CONNECTING)
                try { connectOnce(server) } catch (e: Exception) {
                    Log.w(LOG_TAG, "connect failed: ${e.message}")
                }
                if (!running) break
            }
            // connectOnce returns only after the socket dies; back off, then retry.
            val wait = backoffDelayMs(attempt++)
            Log.i(LOG_TAG, "reconnecting in ${wait}ms (attempt $attempt)")
            delay(wait)
        }
        diagnostics.setConnection(ConnState.DISCONNECTED)
    }

    private suspend fun connectOnce(server: ServerTarget) {
        val url = IdentityStore(context).wsUrl(server.host, server.port)
        val request = Request.Builder().url(url).build()
        val opened = kotlinx.coroutines.CompletableDeferred<WebSocket>()
        val dead = kotlinx.coroutines.CompletableDeferred<Unit>()
        val listener = object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                attempt = 0 // §25: reset backoff after successful connection
                diagnostics.setConnection(ConnState.CONNECTED)
                val hello = Hello(
                    deviceId = identity.deviceId,
                    deviceName = identity.deviceName,
                    deviceModel = android.os.Build.MODEL ?: "Quest",
                    agentVersion = BuildConfig.VERSION_NAME,
                )
                ws.send(protocolJson.encodeToString(hello))
                scope.launch {
                    val scan = installedAppsProvider()
                    val inventory = installedAppsReport(
                        deviceId = identity.deviceId,
                        scannedAt = Instant.now().toString(),
                        result = scan,
                    )
                    if (inventory == null) {
                        val detail = (scan as InstalledAppScanResult.Failure).message
                        Log.w(LOG_TAG, "installed app report skipped: $detail")
                        return@launch
                    }
                    managedPackages = inventory.apps.mapTo(mutableSetOf()) { it.packageName }
                    try {
                        ws.send(protocolJson.encodeToString(inventory))
                        Log.i(LOG_TAG, "reported ${inventory.apps.size} installed third-party apps")
                    } catch (error: Exception) {
                        Log.w(LOG_TAG, "installed app report failed: ${error.message}")
                    }
                }
                Log.i(LOG_TAG, "connected to $url")
                if (!opened.complete(ws)) ws.close(1000, "superseded")
            }

            override fun onMessage(ws: WebSocket, text: String) {
                val cmd = parseLaunchCommand(text) ?: return
                scope.launch { handleLaunch(ws, cmd) }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                dead.complete(Unit)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.w(LOG_TAG, "socket failure: ${t.message}")
                if (!opened.completeExceptionally(t)) dead.complete(Unit)
            }
        }
        socket = client.newWebSocket(request, listener)
        try {
            socket = opened.await() // throws on immediate failure
            dead.await() // suspends until the socket dies
        } finally {
            diagnostics.setConnection(ConnState.DISCONNECTED)
            if (socket != null) {
                try { socket?.close(1000, "reconnect") } catch (_: Exception) { }
                socket = null
            }
        }
    }

    private suspend fun handleLaunch(ws: WebSocket, cmd: ServerCommand) {
        val payload = cmd.payload ?: return
        ws.send(protocolJson.encodeToString(CommandAck(commandId = cmd.commandId, deviceId = identity.deviceId)))
        Log.i(LOG_TAG, "acknowledged ${cmd.commandId}")
        val outcome = diagnostics.launch(payload, launcher, "launch_app ${payload.gameId}")
        val result = when (outcome) {
            is LaunchOutcome.Success -> {
                CommandResult(commandId = cmd.commandId, status = "success", deviceId = identity.deviceId)
            }
            is LaunchOutcome.Failed -> {
                CommandResult(commandId = cmd.commandId, status = "failed", error = outcome.error.take(200), deviceId = identity.deviceId)
            }
        }
        try { ws.send(protocolJson.encodeToString(result)) } catch (_: Exception) { }
        Log.i(LOG_TAG, "command ${cmd.commandId} -> ${result.status}")
    }

    private suspend fun telemetryLoop() {
        while (running && scope.isActive) {
            delay(5_000) // §15: telemetry every 5s
            if (diagnostics.state.value.connection == ConnState.CONNECTED) sendTelemetry()
        }
    }

    private fun sendTelemetry() {
        val battery = readBattery(context)
        diagnostics.setBattery(battery)
        val ws = socket ?: return
        val usageSnapshot = foregroundAppReader.read(managedPackages)
        val foregroundApp = usageSnapshot.foregroundApp?.let {
            ForegroundApp(
                packageName = it.packageName,
                startedAt = Instant.ofEpochMilli(it.startedAtMs).toString(),
            )
        }
        val tel = Telemetry(
            deviceId = identity.deviceId,
            timestamp = Instant.now().toString(),
            battery = battery,
            agent = AgentState(foreground = true),
            expectedCurrentGame = diagnostics.state.value.expectedGame,
            usage = UsageState(
                accessGranted = usageSnapshot.accessGranted,
                foregroundApp = foregroundApp,
            ),
        )
        try { ws.send(protocolJson.encodeToString(tel)) } catch (_: Exception) { }
    }
}
