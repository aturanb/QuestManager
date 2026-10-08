package com.cafequest.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground dataSync service (§24): keeps the WebSocket, heartbeats and
 * command reception alive while other apps run. START_STICKY asks the system
 * to recreate us after kills; reboot-autostart is UNVERIFIED_HARDWARE.
 */
class AgentService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var connections: AgentConnectionSupervisor

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundService()
        AgentRuntime.diagnostics.setServiceRunning(true)
        AgentRuntime.diagnostics.setBattery(readBattery(this))
        connections = AgentConnectionSupervisor {
            val identity = IdentityStore(this@AgentService).load()
            val launcher: AppLauncher = MetaAppLauncher(this@AgentService, identity.metaAppId)
            AgentConnection(this@AgentService, identity, launcher, AgentRuntime.diagnostics)
                .also { Log.i(LOG_TAG, "agent connection configured for ${identity.deviceName}") }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scope.launch {
            when (intent?.action) {
                ACTION_RECONNECT -> connections.reconnect()
                ACTION_TELEMETRY -> connections.sendTestTelemetry()
                ACTION_TEST_LAUNCH -> connections.testLastLaunch()
                ACTION_RECONFIGURE -> connections.replace()
                else -> connections.ensureStarted()
            }
            Log.i(LOG_TAG, "agent service action handled: ${intent?.action ?: "start"}")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        connections.destroy()
        AgentRuntime.diagnostics.setConnection(ConnState.DISCONNECTED)
        AgentRuntime.diagnostics.setServiceRunning(false)
        super.onDestroy()
    }

    private fun startForegroundService() {
        val channelId = "cafequest_agent"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(channelId, "CafeQuest agent", NotificationManager.IMPORTANCE_MIN)
        )
        val note = Notification.Builder(this, channelId)
            .setContentTitle("CafeQuest agent running")
            .setContentText("Connected to café server")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .build()
        startForeground(1, note)
    }

    companion object {
        const val ACTION_RECONNECT = "com.cafequest.agent.RECONNECT"
        const val ACTION_TELEMETRY = "com.cafequest.agent.TELEMETRY"
        const val ACTION_TEST_LAUNCH = "com.cafequest.agent.TEST_LAUNCH"
        const val ACTION_RECONFIGURE = "com.cafequest.agent.RECONFIGURE"
    }
}
