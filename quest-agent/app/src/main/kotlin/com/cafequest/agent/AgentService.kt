package com.cafequest.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground dataSync service (§24): keeps the WebSocket, heartbeats and
 * command reception alive while other apps run. START_STICKY asks the system
 * to recreate us after kills; reboot-autostart is UNVERIFIED_HARDWARE.
 *
 * It also owns the single [CastingController] for the whole process, so a
 * connection replacement never inherits a running screen share.
 */
class AgentService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var connections: AgentConnectionSupervisor
    private lateinit var casting: CastingController
    /** Whether the foreground service is currently carrying the projection type. */
    private var projectionForeground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundService()
        AgentRuntime.diagnostics.setServiceRunning(true)
        AgentRuntime.diagnostics.setBattery(readBattery(this))
        casting = CastingController(
            publisherFactory = WebRtcPublisherFactory(AndroidRtcPeerFactory(this), CastVideoProfile.SUPPORT),
            store = AgentRuntime.casting,
        )
        connections = AgentConnectionSupervisor {
            val identity = IdentityStore(this@AgentService).load()
            val launcher: AppLauncher = MetaAppLauncher(this@AgentService, identity.metaAppId)
            val packageLauncher: PackageAppLauncher = AndroidPackageAppLauncher(this@AgentService)
            AgentConnection(
                this@AgentService,
                identity,
                launcher,
                packageLauncher,
                AgentRuntime.diagnostics,
                casting = casting,
            ).also { Log.i(LOG_TAG, "agent connection configured for ${identity.deviceName}") }
        }
        // The foreground type follows the session: mediaProjection only while one is live.
        scope.launch {
            AgentRuntime.casting.state.collect { state ->
                if (projectionForeground && state.phase != CastingPhase.NEGOTIATING && state.phase != CastingPhase.LIVE) {
                    setProjectionForeground(false)
                }
                notify(state.phase)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Re-posted on every start so a language picked in the app reaches the notification.
        startForegroundService()
        scope.launch {
            when (intent?.action) {
                ACTION_RECONNECT -> connections.reconnect()
                ACTION_TELEMETRY -> connections.sendTestTelemetry()
                ACTION_TEST_LAUNCH -> connections.testLastLaunch()
                ACTION_RECONFIGURE -> connections.replace()
                CastAction.APPROVED -> approveProjection(intent)
                CastAction.DENIED -> denyProjection(intent)
                CastAction.STOP -> stopByUser(intent)
                else -> connections.ensureStarted()
            }
            Log.i(LOG_TAG, "agent service action handled: ${intent?.action ?: "start"}")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        // Stop capture before the socket goes away, so nothing is left projecting.
        casting.shutdown()
        setProjectionForeground(false)
        scope.cancel()
        connections.destroy()
        AgentRuntime.diagnostics.setConnection(ConnState.DISCONNECTED)
        AgentRuntime.diagnostics.setServiceRunning(false)
        super.onDestroy()
    }

    /**
     * Quest's consent dialog returned OK for the session the controller is still
     * waiting on: promote the foreground type, then hand the one-use result over.
     * A stale or malformed result never reaches the publisher (Step 6).
     */
    @Suppress("DEPRECATION")
    private suspend fun approveProjection(intent: Intent) {
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
        val action = parseCastServiceAction(
            action = intent.action,
            sessionId = intent.getStringExtra(EXTRA_SESSION_ID),
            resultCode = resultCode,
            hasResultData = resultData != null,
            currentSessionId = AgentRuntime.casting.state.value.sessionId,
        )
        val approve = action as? CastServiceAction.Approve ?: return
        if (resultData == null) return
        // Android 14 wants the projection type on the service that does the capture;
        // grant the one-use consent result to exactly one publisher afterwards.
        setProjectionForeground(true)
        casting.approve(approve.sessionId, AndroidProjectionGrant(resultCode, resultData))
        // The projection exists once the publisher started, so a type the platform
        // refused a moment earlier is legal now.
        if (AgentRuntime.casting.state.value.phase == CastingPhase.NEGOTIATING) setProjectionForeground(true)
    }

    private fun denyProjection(intent: Intent) {
        val action = parseCastServiceAction(
            action = intent.action,
            sessionId = intent.getStringExtra(EXTRA_SESSION_ID),
            resultCode = null,
            hasResultData = false,
            currentSessionId = AgentRuntime.casting.state.value.sessionId,
        )
        val deny = action as? CastServiceAction.Deny ?: return
        casting.deny(deny.sessionId)
    }

    private fun stopByUser(intent: Intent) {
        val sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: return
        casting.stopByUser(sessionId)
    }

    /** Only the projection's presence makes the mediaProjection type legal. */
    private fun setProjectionForeground(projection: Boolean) {
        if (projectionForeground == projection) return
        val types = if (projection) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(AgentRuntime.casting.state.value.phase), types)
            projectionForeground = projection
        } catch (e: Exception) {
            Log.w(LOG_TAG, "foreground type ${if (projection) "mediaProjection" else "dataSync"} rejected: ${e.javaClass.simpleName}")
            if (projection) {
                // Never crash the agent over the type: keep dataSync and let the
                // capture attempt report its own failure to the board.
                projectionForeground = false
                startForegroundService()
            }
        }
    }

    private fun notify(phase: CastingPhase) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, notification(phase))
    }

    private fun startForegroundService() {
        val strings = LanguageStore(this).load().strings
        val channelId = "cafequest_agent"
        val nm = getSystemService(NotificationManager::class.java)
        // Re-creating an existing channel only renames it.
        nm.createNotificationChannel(
            NotificationChannel(channelId, strings.notificationChannel, NotificationManager.IMPORTANCE_MIN)
        )
        startForeground(NOTIFICATION_ID, notification(AgentRuntime.casting.state.value.phase))
    }

    /** One notification for both the agent and the live-view session. */
    private fun notification(phase: CastingPhase): Notification {
        val strings = LanguageStore(this).load().strings
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(strings.notificationTitle)
            .setContentText(notificationText(phase, strings))
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(open)
            .build()
    }

    companion object {
        const val ACTION_RECONNECT = "com.cafequest.agent.RECONNECT"
        const val ACTION_TELEMETRY = "com.cafequest.agent.TELEMETRY"
        const val ACTION_TEST_LAUNCH = "com.cafequest.agent.TEST_LAUNCH"
        const val ACTION_RECONFIGURE = "com.cafequest.agent.RECONFIGURE"
        const val EXTRA_SESSION_ID = "com.cafequest.agent.SESSION_ID"
        const val EXTRA_RESULT_CODE = "com.cafequest.agent.RESULT_CODE"
        const val EXTRA_RESULT_DATA = "com.cafequest.agent.RESULT_DATA"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "cafequest_agent"
    }
}

/** Waiting beats connected: staff need to know the headset is asking for a tap. */
fun notificationText(phase: CastingPhase, strings: AgentStrings): String = when (phase) {
    CastingPhase.AWAITING_APPROVAL -> strings.notificationAwaiting
    CastingPhase.NEGOTIATING, CastingPhase.LIVE -> strings.notificationSharing
    else -> strings.notificationText
}
