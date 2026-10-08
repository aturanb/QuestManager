package com.cafequest.agent

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Setup (§38) + diagnostics (§37) screens. No secrets are ever logged. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = IdentityStore(this)
        setContent {
            CafeQuestTheme {
                Surface(Modifier.fillMaxSize(), color = CqColors.Board) {
                    Screens(store, onStartService = { action -> startAgentService(action) })
                }
            }
        }
    }

    private fun startAgentService(action: String? = null) {
        val intent = Intent(this, AgentService::class.java)
        if (action != null) intent.action = action
        startForegroundService(intent)
    }
}

@Composable
fun Screens(store: IdentityStore, onStartService: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    var identity by remember { mutableStateOf<AgentIdentity?>(null) }
    var tab by remember { mutableStateOf(0) } // 0 = diagnostics, 1 = setup
    val diagnostics by AgentRuntime.diagnostics.state.collectAsState()
    LaunchedEffect(Unit) {
        identity = store.load()
        // Opening CafeQuest connects. With the baked-in setup defaults this means a
        // freshly installed headset needs no typing at all: install, open, online.
        onStartService(AgentService.ACTION_RECONFIGURE)
    }
    // Back leaves setup without saving instead of closing the app.
    BackHandler(enabled = tab == 1) { tab = 0 }
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 1040.dp).fillMaxWidth().padding(horizontal = 32.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("CafeQuest", style = MaterialTheme.typography.titleMedium)
                Text("Agent ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
            }
            if (tab == 0) {
                DiagnosticsScreen(
                    identity = identity,
                    diagnostics = diagnostics,
                    onOpenSetup = { tab = 1 },
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
) {
    val ctx = LocalContext.current
    val send = { action: String ->
        ctx.startForegroundService(Intent(ctx, AgentService::class.java).setAction(action))
        Unit
    }
    val link = linkStatus(diagnostics.connection, identity?.serverHost, identity?.serverPort)

    val status: @Composable () -> Unit = {
        Panel(rail = link.tone.color()) {
            Text(identity?.deviceName ?: "…", style = MaterialTheme.typography.headlineSmall)
            Text(link.word, style = MaterialTheme.typography.displaySmall, color = link.tone.color())
            Text(link.caption, style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
        }
    }
    val facts: @Composable () -> Unit = {
        Panel {
            Fact("Server") { FactText(identity?.let { "${it.serverHost}:${it.serverPort}" } ?: "…") }
            Fact("Battery") {
                val battery = diagnostics.battery
                if (battery == null) FactText("…") else BatteryGauge(battery.level, battery.charging)
            }
            Fact("Service") { FactText(if (diagnostics.serviceRunning) "Running" else "Stopped") }
            Fact("Last launched") { FactText(diagnostics.expectedGame?.name ?: "—") }
            Fact("Last command") { FactText(diagnostics.lastCommand) }
            Fact("Last result") {
                val result = diagnostics.lastResult
                FactText(
                    result,
                    color = when {
                        result == "SUCCESS" -> CqColors.Ready
                        result.startsWith("FAILED") -> CqColors.Alert
                        else -> CqColors.Chalk
                    },
                )
            }
        }
    }
    val actions: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PrimaryAction("Reconnect") { send(AgentService.ACTION_RECONNECT) }
            SecondaryAction("Send test telemetry") { send(AgentService.ACTION_TELEMETRY) }
            SecondaryAction("Test app launch") { send(AgentService.ACTION_TEST_LAUNCH) }
            TextButton(onClick = onOpenSetup, modifier = Modifier.height(48.dp)) {
                Text("Change setup", style = MaterialTheme.typography.labelLarge, color = CqColors.ChalkDim)
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

@Composable
fun SetupScreen(identity: AgentIdentity?, store: IdentityStore, onSaved: () -> Unit, onCancel: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember(identity) { mutableStateOf(identity?.deviceName ?: "") }
    var host by remember(identity) { mutableStateOf(identity?.serverHost ?: "") }
    var port by remember(identity) { mutableStateOf(identity?.serverPort?.toString() ?: "3000") }
    // Prefilled, unlike before: a blank field used to be saved over the stored
    // value, so renaming a headset silently wiped its enrollment key.
    var enroll by remember(identity) { mutableStateOf(identity?.enrollmentKey ?: "") }
    var meta by remember(identity) { mutableStateOf(identity?.metaAppId?.takeUnless { it == UNCONFIGURED_APP_ID } ?: "") }
    Panel {
        Text("Headset setup", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Filled in from the café PC's settings. A field left blank keeps its saved value.",
            style = MaterialTheme.typography.bodyMedium,
            color = CqColors.ChalkDim,
        )
        SetupField("Device name", name) { name = it }
        SetupField("Server host", host) { host = it }
        SetupField("Server port", port, KeyboardType.Number) { port = it }
        SetupField("Enrollment key", enroll) { enroll = it }
        SetupField("Meta App ID", meta, KeyboardType.Number) { meta = it }
        Spacer(Modifier.height(4.dp))
        PrimaryAction("Save and connect") {
            scope.launch {
                store.save(AgentSetupInput(
                    deviceName = name,
                    serverHost = host,
                    serverPort = port,
                    enrollmentKey = enroll,
                    metaAppId = meta,
                ))
                onSaved()
            }
        }
        TextButton(onClick = onCancel, modifier = Modifier.height(48.dp)) {
            Text("Cancel", style = MaterialTheme.typography.labelLarge, color = CqColors.ChalkDim)
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
        if (charging) Text("charging", style = MaterialTheme.typography.bodyMedium, color = CqColors.ChalkDim)
    }
}

@Composable
private fun PrimaryAction(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(56.dp),
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
