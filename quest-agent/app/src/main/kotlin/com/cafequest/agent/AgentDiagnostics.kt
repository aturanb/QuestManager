package com.cafequest.agent

import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** The server the agent dials right now, as the diagnostics screen shows it. */
data class ServerTarget(val name: String?, val host: String, val port: Int, val mode: ServerMode)

fun AgentIdentity.serverTarget(): ServerTarget = ServerTarget(serverName, serverHost, serverPort, serverMode)

data class AgentDiagnosticsState(
    val connection: ConnState = ConnState.DISCONNECTED,
    val battery: Battery? = null,
    val serviceRunning: Boolean = false,
    val expectedGame: ExpectedGame? = null,
    val lastCommand: String = "—",
    val lastResult: String = "—",
    /** Published by the connection; Auto discovery may move it. Null until the service starts. */
    val server: ServerTarget? = null,
    /** The name the server last assigned; null until a frame arrives, then it overrides the saved one on screen. */
    val deviceName: String? = null,
)

/** Process-local state shared by the foreground service and diagnostics UI. */
class AgentDiagnostics(
    private val now: () -> String = { Instant.now().toString() },
) {
    private val _state = MutableStateFlow(AgentDiagnosticsState())
    val state: StateFlow<AgentDiagnosticsState> = _state.asStateFlow()

    @Volatile private var lastLaunch: LaunchPayload? = null

    fun setConnection(connection: ConnState) = _state.update { it.copy(connection = connection) }
    fun setBattery(battery: Battery) = _state.update { it.copy(battery = battery) }
    fun setServiceRunning(running: Boolean) = _state.update { it.copy(serviceRunning = running) }
    fun setServer(server: ServerTarget) = _state.update { it.copy(server = server) }
    fun setDeviceName(name: String) = _state.update { it.copy(deviceName = name) }

    suspend fun launch(
        payload: LaunchPayload,
        launcher: AppLauncher,
        packageLauncher: PackageAppLauncher,
        command: String,
    ): LaunchOutcome {
        lastLaunch = payload
        _state.update { it.copy(lastCommand = command) }
        val outcome = payload.metaAppId?.let { launcher.launch(it) }
            ?: packageLauncher.launch(requireNotNull(payload.packageName))
        _state.update { state ->
            when (outcome) {
                is LaunchOutcome.Success -> state.copy(
                    expectedGame = ExpectedGame(payload.gameId, payload.gameName, now()),
                    lastResult = "SUCCESS",
                )
                is LaunchOutcome.Failed -> state.copy(lastResult = "FAILED ${outcome.error}")
            }
        }
        return outcome
    }

    suspend fun testLastLaunch(launcher: AppLauncher, packageLauncher: PackageAppLauncher): LaunchOutcome {
        val payload = lastLaunch
        if (payload == null) {
            val outcome = LaunchOutcome.Failed("NO_GAME_COMMAND_RECEIVED")
            _state.update { it.copy(lastCommand = "test_launch", lastResult = "FAILED ${outcome.error}") }
            return outcome
        }
        return launch(payload, launcher, packageLauncher, "test_launch ${payload.gameId}")
    }
}

object AgentRuntime {
    val diagnostics = AgentDiagnostics()
    /** Observable cast state; the foreground service owns the controller that writes it. */
    val casting = CastingStateStore()
}
