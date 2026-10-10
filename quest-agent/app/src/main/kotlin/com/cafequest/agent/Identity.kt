package com.cafequest.agent

import android.content.Context
import android.provider.Settings
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.util.UUID
import kotlinx.coroutines.flow.first

private val Context.identityStore by preferencesDataStore("cafequest_identity")

/** Stable device identity plus setup values from brief §17/§38. */
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
    /** Old random DataStore UUID retained so the server can migrate its existing row. */
    val previousDeviceId: String? = null,
    /** True from typing a name on the setup screen until the server confirms it. */
    val nameSetByStaff: Boolean = false,
)

/** The connect message for this identity; the typed-name flag rides along only while pending. */
fun AgentIdentity.toHello(deviceModel: String, agentVersion: String): Hello = Hello(
    deviceId = deviceId,
    deviceName = deviceName,
    deviceModel = deviceModel,
    agentVersion = agentVersion,
    previousDeviceId = previousDeviceId,
    deviceNameSetByStaff = true.takeIf { nameSetByStaff },
)

/**
 * Converts Android's app-signing-key/user/device-scoped id to the UUID shape
 * required by protocol v1. The raw Android id never leaves the headset.
 */
fun stableDeviceId(androidId: String): String = UUID.nameUUIDFromBytes(
    "com.cafequest.agent/device:$androidId".toByteArray(Charsets.UTF_8)
).toString()

data class DeviceIdResolution(val deviceId: String, val previousDeviceId: String?)

/** Chooses the stable id while retaining a legacy DataStore UUID for one server migration. */
fun resolveDeviceId(
    androidId: String?,
    storedId: String?,
    fallbackId: () -> String = { UUID.randomUUID().toString() },
): DeviceIdResolution {
    val previous = storedId?.takeIf { it.isNotBlank() }
    val stable = androidId?.takeIf { it.isNotBlank() }?.let(::stableDeviceId)
    val selected = stable ?: previous ?: fallbackId()
    return DeviceIdResolution(
        deviceId = selected,
        previousDeviceId = previous?.takeIf { stable != null && it != stable },
    )
}

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
    private val NAME_SET_BY_STAFF = stringPreferencesKey("device_name_set_by_staff")

    suspend fun load(): AgentIdentity {
        val prefs = context.identityStore.data.first()
        val storedId = prefs[ID]?.takeIf { it.isNotBlank() }
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val resolvedId = resolveDeviceId(androidId, storedId)
        if (storedId == null) context.identityStore.edit { it[ID] = resolvedId.deviceId }
        return resolveIdentity(
            deviceId = resolvedId.deviceId,
            stored = StoredSetup(
                deviceName = prefs[NAME],
                serverHost = prefs[HOST],
                serverPort = prefs[PORT],
                serverMode = prefs[MODE],
                serverName = prefs[SERVER_NAME],
                metaAppId = prefs[META],
                nameSetByStaff = prefs[NAME_SET_BY_STAFF],
            ),
            defaults = defaults,
            previousDeviceId = resolvedId.previousDeviceId,
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

    /**
     * Stores the name the server confirmed or assigned. One atomic edit of just
     * the name keys, so it cannot race the discovery save that rewrites the rest.
     */
    suspend fun saveServerName(name: String) {
        context.identityStore.edit {
            val stored = it[NAME]?.takeIf { value -> value.isNotBlank() }
            val trimmed = name.trim().takeIf { value -> value.isNotEmpty() } ?: return@edit
            // A name typed since the last hello has not reached the server yet; keep it.
            if (stored != null && it[NAME_SET_BY_STAFF] == "true" && trimmed != stored) return@edit
            it[NAME] = trimmed
            it.remove(NAME_SET_BY_STAFF)
        }
    }

    private suspend fun persist(identity: AgentIdentity) {
        context.identityStore.edit {
            it[NAME] = identity.deviceName
            if (identity.nameSetByStaff) it[NAME_SET_BY_STAFF] = "true" else it.remove(NAME_SET_BY_STAFF)
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
