package com.cafequest.agent

import android.content.Context
import android.util.Log
import horizon.core.android.driver.coroutines.HorizonServiceConnection
import horizon.platform.application.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

fun parseMetaLaunchResult(raw: String): LaunchOutcome {
    val trimmed = raw.trim()
    val payload = runCatching {
        protocolJson.parseToJsonElement(trimmed).jsonObject["payload"]?.jsonPrimitive?.contentOrNull
    }.getOrNull()
    val successText = payload ?: trimmed
    return if (successText == "Success" || successText.startsWith("Successfully launched the target app ")) {
        LaunchOutcome.Success
    } else {
        LaunchOutcome.Failed(trimmed.take(200).ifBlank { "LAUNCH_FAILED" })
    }
}

/**
 * Real launcher on Meta's official Platform SDK v0.2.2 (§23, docs/meta-research.md):
 * `HorizonServiceConnection.connect(APP_ID, context)`, then
 * `Application(HorizonServiceConnection.getInstance()).launchOtherApp(appId)`.
 *
 * UNVERIFIED_HARDWARE until a physical Quest run: SDK init, launch behavior
 * while backgrounded, and the Game A → Game B switch.
 */
class MetaAppLauncher(
    private val context: Context,
    private val metaAppId: String,
) : AppLauncher {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override suspend fun launch(metaAppId: String): LaunchOutcome {
        if (isPlaceholder(metaAppId) || isPlaceholder(this.metaAppId)) {
            return LaunchOutcome.Failed("META_APP_ID_NOT_CONFIGURED")
        }
        return try {
            HorizonServiceConnection.connect(this.metaAppId, context.applicationContext, scope)
            // No-arg constructor binds the active service connection internally.
            val status = Application().launchOtherApp(metaAppId)
            Log.i(LOG_TAG, "launchOtherApp returned status=$status")
            parseMetaLaunchResult(status)
        } catch (e: Exception) {
            Log.w(LOG_TAG, "launchOtherApp failed: ${e.message}")
            LaunchOutcome.Failed(e.message?.take(200) ?: "LAUNCH_FAILED")
        }
    }

    private fun isPlaceholder(id: String): Boolean =
        id.isBlank() || id == "UNCONFIGURED" || "FILL_" in id
}
