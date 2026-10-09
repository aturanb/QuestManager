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
    /** "" until Auto finds a server or one is typed in Manual. */
    val serverHost: String,
    val serverPort: Int,
    val serverMode: ServerMode,
    /** The café PC's name from its last discovery reply; Auto accepts only this name afterwards. */
    val serverName: String?,
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
    private val MODE = stringPreferencesKey("server_mode")
    private val SERVER_NAME = stringPreferencesKey("server_name")
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
                serverMode = prefs[MODE],
                serverName = prefs[SERVER_NAME],
                metaAppId = prefs[META],
            ),
            defaults = defaults,
        )
    }

    /** Persists the setup screen. Blank fields keep their current values (see mergeSetup). */
    suspend fun save(input: AgentSetupInput): AgentIdentity = mergeSetup(load(), input).also { persist(it) }

    /** Persists a server Auto found; false (nothing written) when the setup is Manual by now. */
    suspend fun saveDiscovered(found: FoundServer): Boolean {
        val moved = withDiscovered(load(), found) ?: return false
        persist(moved)
        return true
    }

    private suspend fun persist(identity: AgentIdentity) {
        context.identityStore.edit {
            it[NAME] = identity.deviceName
            it[HOST] = identity.serverHost
            it[PORT] = identity.serverPort.toString()
            it[MODE] = identity.serverMode.stored
            val name = identity.serverName
            if (name == null) {
                it.remove(SERVER_NAME)
            } else {
                it[SERVER_NAME] = name
            }
            it[META] = identity.metaAppId
        }
    }

    fun wsUrl(host: String, port: Int): String = "ws://$host:$port/agent-ws"
}
