package com.switchsave.helpdesk

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

object HelpdeskConnectorPreviewRegistry {
    var connectorProvider: (() -> HelpdeskConnectorClient)? = null
}

class HelpdeskConnectorPreviewActivity : Activity() {
    private lateinit var output: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        output = TextView(this).apply {
            textSize = 14f
            setPadding(24, 24, 24, 24)
        }

        val previewButton = Button(this).apply {
            text = "Preview"
            setOnClickListener { renderPreview() }
        }
        val auditButton = Button(this).apply {
            text = "Audit"
            setOnClickListener { renderAudit() }
        }
        val syncButton = Button(this).apply {
            text = "Sync"
            setOnClickListener { syncManifest() }
        }

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(previewButton)
            addView(auditButton)
            addView(syncButton)
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(buttons)
            addView(output, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        setContentView(ScrollView(this).apply { addView(content) })
        renderPreview()
    }

    private fun connector(): HelpdeskConnectorClient {
        return HelpdeskConnectorPreviewRegistry.connectorProvider?.invoke()
            ?: error("HelpdeskConnectorPreviewRegistry.connectorProvider is not configured.")
    }

    private fun renderPreview() {
        output.text = runCatching { connector().previewManifest() }
            .getOrElse { "Preview failed: ${it.message}" }
    }

    private fun renderAudit() {
        output.text = runCatching { connector().auditManifest().toString(2) }
            .getOrElse { "Audit failed: ${it.message}" }
    }

    private fun syncManifest() {
        output.text = runCatching { connector().syncPosManifest().toString(2) }
            .getOrElse { "Sync failed: ${it.message}" }
    }
}
