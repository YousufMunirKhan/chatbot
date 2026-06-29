package com.switchsave.helpdesk

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class HelpdeskEncryptedTokenStore(context: Context) : HelpdeskTokenProvider {
    private val appContext = context.applicationContext
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val preferences = EncryptedSharedPreferences.create(
        appContext,
        "switchsave_helpdesk_connector",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveToken(token: String) {
        require(token.startsWith("hdk_")) { "Connector token must start with hdk_." }
        preferences.edit().putString(KEY_TOKEN, token).apply()
    }

    fun clearToken() {
        preferences.edit().remove(KEY_TOKEN).apply()
    }

    override fun getToken(): String {
        return preferences.getString(KEY_TOKEN, null)
            ?: error("Help Desk connector token has not been configured.")
    }

    companion object {
        private const val KEY_TOKEN = "connector_token"
    }
}
