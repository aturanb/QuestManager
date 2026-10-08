package com.cafequest.agent

/** Result of one launch attempt; mirrors the wire `command_result`. */
sealed interface LaunchOutcome {
    data object Success : LaunchOutcome
    data class Failed(val error: String) : LaunchOutcome
}

/** Hardware seam from brief §22: MetaAppLauncher vs FakeAppLauncher. */
interface AppLauncher {
    suspend fun launch(metaAppId: String): LaunchOutcome
}

/** Test double for JVM unit tests and hardware-free verification. */
class FakeAppLauncher(
    private val installed: Set<String> = setOf("test-beat-saber", "test-walkabout"),
) : AppLauncher {
    val launched = mutableListOf<String>()
    override suspend fun launch(metaAppId: String): LaunchOutcome {
        if (metaAppId !in installed) return LaunchOutcome.Failed("TARGET_NOT_INSTALLED")
        launched.add(metaAppId)
        return LaunchOutcome.Success
    }
}
