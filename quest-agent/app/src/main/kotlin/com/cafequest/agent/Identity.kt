package com.cafequest.agent

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.identityStore by preferencesDataStore("cafequest_identity")

/** Persistent UUID + setup values from brief §17/§38 (DataStore, no HW ids). */
data class AgentIdentity(
    val deviceId: String,
    val deviceName: String,
    val serverHost: String,
    val serverPort: Int,
    val enrollmentKey: String,
    val metaAppId: String,
)

class IdentityStore(
    private val context: Context,
    private val defaults: AgentSetupDefaults = AgentSetupDefaults.fromBuildConfig(),
) {
    private val ID = stringPreferencesKey("device_id")
    private val NAME = stringPreferencesKey("device_name")
    private val HOST = stringPreferencesKey("server_host")
    private val PORT = stringPreferencesKey("server_port")
    private val ENROLL = stringPreferencesKey("enrollment_key")
    private val META = stringPreferencesKey("meta_app_id")

    suspend fun load(): AgentIdentity {
        var id = context.identityStore.data.map { it[ID] }.first()
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            context.identityStore.edit { it[ID] = id }
        }
        val prefs = context.identityStore.data.first()
        return resolveIdentity(
            deviceId = id,
            stored = StoredSetup(
                deviceName = prefs[NAME],
                serverHost = prefs[HOST],
                serverPort = prefs[PORT],
                enrollmentKey = prefs[ENROLL],
                metaAppId = prefs[META],
            ),
            defaults = defaults,
        )
    }

    /** Persists the setup screen. Blank fields keep their current values (see mergeSetup). */
    suspend fun save(input: AgentSetupInput): AgentIdentity {
        val merged = mergeSetup(load(), input)
        context.identityStore.edit {
            it[NAME] = merged.deviceName
            it[HOST] = merged.serverHost
            it[PORT] = merged.serverPort.toString()
            it[ENROLL] = merged.enrollmentKey
            it[META] = merged.metaAppId
        }
        return merged
    }

    fun wsUrl(host: String, port: Int): String = "ws://$host:$port/agent-ws"
}
