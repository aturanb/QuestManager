package com.cafequest.agent

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * A transparent bridge from the background agent to Quest's system-owned
 * MediaProjection selector. It finishes as soon as the customer answers, so
 * the app that was open before the support request comes back to the front.
 */
class CastConsentActivity : ComponentActivity() {
    private var launched = false
    private var sessionId: String? = null

    private val projectionConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val sessionId = sessionId
        if (sessionId != null) {
            val approved = result.resultCode == RESULT_OK && result.data != null
            val serviceIntent = Intent(this, AgentService::class.java)
                .setAction(if (approved) CastAction.APPROVED else CastAction.DENIED)
                .putExtra(AgentService.EXTRA_SESSION_ID, sessionId)
            if (approved) {
                serviceIntent.putExtra(AgentService.EXTRA_RESULT_CODE, result.resultCode)
                serviceIntent.putExtra(AgentService.EXTRA_RESULT_DATA, result.data)
            }
            startForegroundService(serviceIntent)
        }
        finishAndRemoveTask()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launched = savedInstanceState?.getBoolean(STATE_LAUNCHED) == true
        val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
        if (intent.getBooleanExtra(EXTRA_DISMISS, false) || sessionId == null || !isCastSessionId(sessionId)) {
            finishAndRemoveTask()
            return
        }
        this.sessionId = sessionId
        if (launched) return
        launched = true
        val manager = getSystemService(MediaProjectionManager::class.java)
        projectionConsent.launch(manager.createScreenCaptureIntent())
    }

    /**
     * A dismiss arrives as CLEAR_TOP on this root activity, which makes the
     * system finish whatever sits above it, namely Quest's selector.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_DISMISS, false)) finishAndRemoveTask()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(STATE_LAUNCHED, launched)
        super.onSaveInstanceState(outState)
    }

    companion object {
        private const val EXTRA_SESSION_ID = "com.cafequest.agent.CONSENT_SESSION_ID"
        private const val EXTRA_DISMISS = "com.cafequest.agent.CONSENT_DISMISS"
        private const val STATE_LAUNCHED = "cast_consent_launched"

        fun intent(context: Context, sessionId: String): Intent =
            Intent(context, CastConsentActivity::class.java)
                .putExtra(EXTRA_SESSION_ID, sessionId)
                .addFlags(LAUNCH_FLAGS)

        /** Takes down an unanswered prompt, selector included. */
        fun dismissIntent(context: Context): Intent =
            Intent(context, CastConsentActivity::class.java)
                .putExtra(EXTRA_DISMISS, true)
                .addFlags(LAUNCH_FLAGS)

        private const val LAUNCH_FLAGS =
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
}
