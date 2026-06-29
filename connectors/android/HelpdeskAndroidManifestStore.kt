package com.switchsave.helpdesk

import android.content.Context
import org.json.JSONObject

class HelpdeskAndroidManifestStore(context: Context) : HelpdeskManifestStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        "switchsave_helpdesk_manifest",
        Context.MODE_PRIVATE
    )

    override fun loadManifest(): JSONObject? {
        val text = preferences.getString(KEY_MANIFEST, null) ?: return null
        return runCatching { JSONObject(text) }.getOrNull()
    }

    override fun saveManifest(manifest: JSONObject) {
        preferences.edit()
            .putString(KEY_MANIFEST, manifest.toString())
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .apply()
    }

    fun lastUpdatedAt(): Long {
        return preferences.getLong(KEY_UPDATED_AT, 0L)
    }

    companion object {
        private const val KEY_MANIFEST = "manifest_json"
        private const val KEY_UPDATED_AT = "manifest_updated_at"
    }
}
