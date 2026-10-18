package com.cafequest.agent

import android.content.Context
import java.util.Locale

/**
 * The headset app's language pick, kept across app and headset restarts.
 * SharedPreferences rather than DataStore: it is read synchronously, so the
 * first frame is already in the right language and the service can word its
 * notification without a coroutine.
 */
class LanguageStore(context: Context) {
    private val prefs = context.getSharedPreferences("cafequest_prefs", Context.MODE_PRIVATE)

    fun load(): AgentLanguage = resolveLanguage(prefs.getString(KEY, null), Locale.getDefault().language)

    fun save(language: AgentLanguage) {
        prefs.edit().putString(KEY, language.code).apply()
    }

    private companion object {
        const val KEY = "language"
    }
}
