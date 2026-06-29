package com.switchsave.helpdesk

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

class HelpdeskConnectorLifecycleObserver(
    private val connector: HelpdeskConnectorClient,
    private val appVersion: String
) : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) {
        connector.startActiveSession(appVersion)
    }

    override fun onStop(owner: LifecycleOwner) {
        connector.stopActiveSession()
    }
}
