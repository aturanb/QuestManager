package com.cafequest.agent

import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** The active language's words; screens read them instead of hard-coding English. */
val LocalStrings = staticCompositionLocalOf<AgentStrings> { EnglishStrings }

/** Setup (§38) + diagnostics (§37) screens. No secrets are ever logged. */
class MainActivity : ComponentActivity() {
    /** The session whose Share screen action opened Quest's dialog; cleared on every result. */
    private var pendingCastSession: String? = null
    private lateinit var projectionConsent: ActivityResultLauncher<Intent>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = IdentityStore(this)
        val languages = LanguageStore(this)
        projectionConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val session = pendingCastSession
            pendingCastSession = null
            // A result with no session (or none at all) is a stale dialog: tell nobody.
            if (session == null) return@registerForActivityResult
            val data = result.data
            val approved = result.resultCode == RESULT_OK && data != null
            val intent = Intent(this, AgentService::class.java)
                .setAction(if (approved) CastAction.APPROVED else CastAction.DENIED)
                .putExtra(AgentService.EXTRA_SESSION_ID, session)
            if (approved) {
                // The one-use consent result travels straight to the service; never stored.
                intent.putExtra(AgentService.EXTRA_RESULT_CODE, result.resultCode)
                intent.putExtra(AgentService.EXTRA_RESULT_DATA, data)
            }
            startForegroundService(intent)
        }
        setContent {
            var language by remember { mutableStateOf(languages.load()) }
            CompositionLocalProvider(LocalStrings provides language.strings) {
                CafeQuestTheme {
                    Surface(Modifier.fillMaxSize(), color = CqColors.Board) {
                        Screens(
                            store,
                            language = language,
                            onLanguage = { picked ->
                                languages.save(picked)
                                language = picked
                                // Any start re-posts the service notification, now in the picked language.
                                startAgentService()
                            },
                            onStartService = { action -> startAgentService(action) },
                            onShareScreen = { sessionId -> askForProjection(sessionId) },
                        )
                    }
                }
            }
        }
    }

    private fun startAgentService(action: String? = null) {
        val intent = Intent(this, AgentService::class.java)
        if (action != null) intent.action = action
        startForegroundService(intent)
    }

    /**
     * Developer Mode does not remove Quest's per-session capture consent: the
     * system dialog is the only way to get a usable MediaProjection result.
     */
    private fun askForProjection(sessionId: String) {
        val manager = getSystemService(MediaProjectionManager::class.java)
        pendingCastSession = sessionId
        projectionConsent.launch(manager.createScreenCaptureIntent())
    }
}

@Composable
fun Screens(
    store: IdentityStore,
    language: AgentLanguage,
    onLanguage: (AgentLanguage) -> Unit,
    onStartService: (String?) -> Unit,
    onShareScreen: (String) -> Unit,
) {
    val s = LocalStrings.current
    val scope = rememberCoroutineScope()
    var identity by remember { mutableStateOf<AgentIdentity?>(null) }
    var tab by remember { mutableStateOf(0) } // 0 = diagnostics, 1 = setup
    val diagnostics by AgentRuntime.diagnostics.state.collectAsState()
    LaunchedEffect(Unit) {
        identity = store.load()
        // Opening CafeQuest connects. In Auto (the default) the agent finds the café PC
        // itself, so a freshly installed headset needs no typing at all: install, open, online.
        onStartService(AgentService.ACTION_RECONFIGURE)
    }
    // Back leaves setup without saving instead of closing the app.
    BackHandler(enabled = tab == 1) { tab = 0 }
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 1040.dp).fillMaxWidth().padding(horizontal = 32.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("CafeQuest", style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    LanguageSwitch(language, onLanguage)
                    Text(s.agentVersion(BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                }
            }
            if (tab == 0) {
                DiagnosticsScreen(
                    identity = identity,
                    diagnostics = diagnostics,
                    onOpenSetup = { tab = 1 },
                    onShareScreen = onShareScreen,
                )
            } else {
                SetupScreen(
                    identity = identity,
                    store = store,
                    onSaved = {
                        scope.launch {
                            identity = store.load()
                            onStartService(AgentService.ACTION_RECONFIGURE)
                            tab = 0
                        }
                    },
                    onCancel = { tab = 0 },
                )
            }
        }
    }
}

@Composable
fun DiagnosticsScreen(
    identity: AgentIdentity?,
    diagnostics: AgentDiagnosticsState,
    onOpenSetup: () -> Unit,
    onShareScreen: (String) -> Unit,
) {
    val s = LocalStrings.current
    val ctx = LocalContext.current
    val send = { action: String ->
        ctx.startForegroundService(Intent(ctx, AgentService::class.java).setAction(action))
        Unit
    }
    val sendCast = { action: String, sessionId: String? ->
        val intent = Intent(ctx, AgentService::class.java).setAction(action)
        if (sessionId != null) intent.putExtra(AgentService.EXTRA_SESSION_ID, sessionId)
        ctx.startForegroundService(intent)
        Unit
    }
    val casting = AgentRuntime.casting.state.collectAsState().value
    // The service publishes where it dials (Auto may have moved it); before that, the saved setup.
    val server = diagnostics.server ?: identity?.serverTarget()
    val link = linkStatus(diagnostics.connection, server?.host, server?.port, s)

    val status: @Composable () -> Unit = {
        Panel(rail = link.tone.color()) {
            Text(identity?.deviceName ?: "…", style = MaterialTheme.typography.headlineSmall)
            Text(link.word, style = MaterialTheme.typography.displaySmall, color = link.tone.color())
            Text(link.caption, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
        }
    }
    val facts: @Composable () -> Unit = {
        Panel {
            Fact(s.server) { FactText(server?.let { serverSummary(it, s) } ?: "…") }
            Fact(s.battery) {
                val battery = diagnostics.battery
                if (battery == null) FactText("…") else BatteryGauge(battery.level, battery.charging)
            }
            Fact(s.service) { FactText(if (diagnostics.serviceRunning) s.running else s.stopped) }
            Fact(s.lastLaunched) { FactText(diagnostics.expectedGame?.name ?: "—") }
            Fact(s.lastCommand) { FactText(diagnostics.lastCommand) }
            Fact(s.lastResult) {
                val result = diagnostics.lastResult
                FactText(
                    displayResult(result, s),
                    color = when {
                        result == "SUCCESS" -> CqColors.Ready
                        result.startsWith("FAILED") -> CqColors.Alert
                        else -> CqColors.Chalk
                    },
                )
            }
        }
    }
    // Only visible while a request, a session, or a failure is on screen. Nothing
    // about the live view is stored, so this panel is the whole headset-side trace.
    val liveView: @Composable () -> Unit = {
        when (casting.phase) {
            CastingPhase.IDLE -> Unit
            else -> Panel(rail = castRail(casting.phase)) {
                Text(s.casting, style = MaterialTheme.typography.headlineSmall)
                when (casting.phase) {
                    CastingPhase.AWAITING_APPROVAL -> {
                        Text(s.castRequestPending, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                        PrimaryAction(
                            label = s.castShare,
                            description = s.castShareLabel(identity?.deviceName ?: "CafeQuest"),
                        ) { casting.sessionId?.let(onShareScreen) }
                    }
                    CastingPhase.NEGOTIATING -> {
                        Text(s.castNegotiating, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                        SecondaryAction(s.castStop) { sendCast(CastAction.STOP, casting.sessionId) }
                    }
                    CastingPhase.LIVE -> {
                        Text(s.castSharing, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                        SecondaryAction(s.castStop) { sendCast(CastAction.STOP, casting.sessionId) }
                    }
                    CastingPhase.FAILED -> {
                        Text(s.castFailedTitle, style = MaterialTheme.typography.titleMedium, color = CqColors.Alert)
                        Text(s.castFailure(casting.error), style = MaterialTheme.typography.bodyLarge)
                        Text(s.castFailedHint, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                    }
                    CastingPhase.IDLE -> Unit
                }
            }
        }
    }
    val actions: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            liveView()
            PrimaryAction(s.reconnect) { send(AgentService.ACTION_RECONNECT) }
            SecondaryAction(s.sendTestTelemetry) { send(AgentService.ACTION_TELEMETRY) }
            SecondaryAction(s.testAppLaunch) { send(AgentService.ACTION_TEST_LAUNCH) }
            TextButton(onClick = onOpenSetup, modifier = Modifier.height(48.dp)) {
                Text(s.changeSetup, style = MaterialTheme.typography.labelLarge, color = CqColors.ChalkDim)
            }
        }
    }

    // Wide headset panels get two columns; a narrow window stacks status, facts, actions.
    BoxWithConstraints {
        if (maxWidth >= 760.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    status()
                    actions()
                }
                Column(Modifier.weight(1f)) { facts() }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                status()
                facts()
                actions()
            }
        }
    }
}

/** The panel edge no headset user can miss: waiting is amber, live is green, failure is red. */
private fun castRail(phase: CastingPhase): Color = when (phase) {
    CastingPhase.AWAITING_APPROVAL -> CqColors.Live
    CastingPhase.NEGOTIATING -> CqColors.ChalkDim
    CastingPhase.LIVE -> CqColors.Ready
    CastingPhase.FAILED -> CqColors.Alert
    CastingPhase.IDLE -> CqColors.Rail
}

@Composable
fun SetupScreen(identity: AgentIdentity?, store: IdentityStore, onSaved: () -> Unit, onCancel: () -> Unit) {
    val s = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember(identity) { mutableStateOf(identity?.deviceName ?: "") }
    var mode by remember(identity) { mutableStateOf(identity?.serverMode ?: ServerMode.AUTO) }
    var host by remember(identity) { mutableStateOf(identity?.serverHost ?: "") }
    var port by remember(identity) { mutableStateOf((identity?.serverPort ?: DEFAULT_SERVER_PORT).toString()) }
    var meta by remember(identity) { mutableStateOf(identity?.metaAppId?.takeUnless { it == UNCONFIGURED_APP_ID } ?: "") }
    // Find server: null = not searched yet. A pick is applied by Save and connect, like every other field.
    var found by remember(identity) { mutableStateOf<List<FoundServer>?>(null) }
    var picked by remember(identity) { mutableStateOf<FoundServer?>(null) }
    var searching by remember { mutableStateOf(false) }
    Panel {
        Text(s.setupTitle, style = MaterialTheme.typography.headlineSmall)
        Text(
            s.setupHint,
            style = MaterialTheme.typography.bodyMedium,
            color = CqColors.ChalkDim,
        )
        SetupField(s.deviceName, name) { name = it }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(s.server, style = MaterialTheme.typography.bodyLarge)
            TwoWaySwitch(
                options = ServerMode.entries,
                current = mode,
                description = s.server,
                label = { if (it == ServerMode.AUTO) s.auto else s.manual },
                onPick = { mode = it },
            )
        }
        if (mode == ServerMode.AUTO) {
            // What Auto dials after Save: the pick, else what Auto found before (a Manual setup found nothing).
            val shown = picked?.let { ServerTarget(it.name, it.host, it.port, ServerMode.AUTO) }
                ?: identity?.takeIf { it.serverMode == ServerMode.AUTO }?.serverTarget()
            Text(
                shown?.let { serverSummary(it, s) } ?: s.notFoundYet,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
            SecondaryAction(if (searching) s.findingServer else s.findServer) {
                if (searching) return@SecondaryAction
                searching = true
                scope.launch {
                    val results = ServerDiscovery({ wifiBroadcastTargets(context) }).search()
                    found = results
                    results.singleOrNull()?.let { picked = it }
                    searching = false
                }
            }
            val answers = found
            if (answers != null && answers.isEmpty()) {
                Text(s.noServerFound, style = MaterialTheme.typography.bodyMedium, color = CqColors.Alert)
            }
            if (answers != null && answers.size > 1) {
                Text(s.pickServer, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
                answers.forEach { server ->
                    SecondaryAction(serverSummary(ServerTarget(server.name, server.host, server.port, ServerMode.AUTO), s)) {
                        picked = server
                    }
                }
            }
        } else {
            SetupField(s.serverHost, host) { host = it }
            SetupField(s.serverPort, port, KeyboardType.Number) { port = it }
        }
        SetupField(s.metaAppId, meta, KeyboardType.Number) { meta = it }
        Spacer(Modifier.height(4.dp))
        PrimaryAction(s.saveAndConnect) {
            scope.launch {
                store.save(AgentSetupInput(
                    deviceName = name,
                    serverMode = mode,
                    serverHost = host,
                    serverPort = port,
                    metaAppId = meta,
                    picked = picked,
                ))
                onSaved()
            }
        }
        TextButton(onClick = onCancel, modifier = Modifier.height(48.dp)) {
            Text(s.cancel, style = MaterialTheme.typography.labelLarge, color = CqColors.ChalkDim)
        }
    }
}

/** EN | TR, the same two-way switch as the dashboard header; the pressed side is live. */
@Composable
private fun LanguageSwitch(current: AgentLanguage, onPick: (AgentLanguage) -> Unit) {
    TwoWaySwitch(
        options = AgentLanguage.entries,
        current = current,
        description = LocalStrings.current.language,
        label = { it.code.uppercase() },
        onPick = onPick,
    )
}

/** A segmented switch drawn like the dashboard header's EN | TR; the pressed side is live. */
@Composable
private fun <T> TwoWaySwitch(
    options: List<T>,
    current: T,
    description: String,
    label: (T) -> String,
    onPick: (T) -> Unit,
) {
    Row(
        Modifier
            .border(1.dp, CqColors.Rail, RoundedCornerShape(8.dp))
            .padding(2.dp)
            .semantics { contentDescription = description }
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { option ->
            val picked = option == current
            Box(
                Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (picked) CqColors.Raised else Color.Transparent)
                    .selectable(selected = picked, role = Role.RadioButton, onClick = { onPick(option) })
                    .height(44.dp)
                    .widthIn(min = 56.dp)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label(option),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (picked) CqColors.Chalk else CqColors.ChalkDim,
                )
            }
        }
    }
}

/** A dashboard-style panel; [rail] paints the same state edge the board's cards use. */
@Composable
private fun Panel(rail: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(CqColors.Bay)
            .then(if (rail != null) Modifier.drawBehind { drawRect(rail, size = Size(6.dp.toPx(), size.height)) } else Modifier)
            .border(1.dp, CqColors.Rail, shape)
            .padding(start = if (rail != null) 28.dp else 22.dp, top = 22.dp, end = 22.dp, bottom = 22.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** Label on the left, value right-aligned in whatever width is left (long values wrap). */
@Composable
private fun Fact(label: String, value: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) { value() }
    }
}

@Composable
private fun FactText(text: String, color: Color = CqColors.Chalk) {
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        fontWeight = FontWeight.SemiBold,
        color = color,
        textAlign = TextAlign.End,
    )
}

/** Mirrors the dashboard's battery cell: five segments, amber at 40%, red at 20%. */
@Composable
private fun BatteryGauge(level: Int, charging: Boolean) {
    val tone = when {
        level <= 20 -> CqColors.Alert
        level <= 40 -> CqColors.Live
        else -> CqColors.Chalk
    }
    val lit = litBatteryCells(level)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.border(1.5.dp, CqColors.ChalkDim, RoundedCornerShape(4.dp)).padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                repeat(5) { i ->
                    Box(
                        Modifier
                            .size(width = 7.dp, height = 14.dp)
                            .background(if (i < lit) tone else Color.Transparent, RoundedCornerShape(1.dp))
                    )
                }
            }
            Box(Modifier.size(width = 3.dp, height = 8.dp).background(CqColors.ChalkDim, RoundedCornerShape(topEnd = 1.dp, bottomEnd = 1.dp)))
        }
        Text(
            "$level%",
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = if (level <= 20) CqColors.Alert else CqColors.Chalk,
        )
        if (charging) Text(LocalStrings.current.charging, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
    }
}

@Composable
private fun PrimaryAction(label: String, description: String? = null, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = CqColors.Chalk, contentColor = CqColors.Board),
    ) { Text(label, style = MaterialTheme.typography.labelLarge) }
}

@Composable
private fun SecondaryAction(label: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, CqColors.Rail),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = CqColors.Raised, contentColor = CqColors.Chalk),
    ) { Text(label, style = MaterialTheme.typography.labelLarge) }
}

@Composable
private fun SetupField(label: String, value: String, keyboard: KeyboardType = KeyboardType.Text, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        textStyle = MaterialTheme.typography.bodyLarge,
        modifier = Modifier.fillMaxWidth(),
    )
}
