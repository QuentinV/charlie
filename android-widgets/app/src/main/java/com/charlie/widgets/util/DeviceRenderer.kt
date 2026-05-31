package com.charlie.widgets.util

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.charlie.widgets.R
import com.charlie.widgets.api.CharlieApi
import com.charlie.widgets.api.Device
import com.charlie.widgets.api.DeviceState
import com.charlie.widgets.api.DeviceType

/**
 * Unified device rendering and interaction logic for both single and multi-device widgets.
 * Mirrors the logic from the frontend's Toggle.jsx component.
 */
object DeviceRenderer {

    // ---------- Intent action constants ----------
    const val ACTION_TOGGLE = "com.charlie.widgets.DEVICE_TOGGLE"
    const val ACTION_OPEN = "com.charlie.widgets.DEVICE_OPEN"

    private const val TOGGLE_REQUEST_BASE = 10000
    private const val OPEN_REQUEST_BASE = 20000

    // ---------- Rendering ----------

    /**
     * Apply device info to a RemoteViews layout.
     *
     * @param nameViewId    TextView for device name
     * @param stateViewId   TextView for state text ("On"/"Off"/"Toggle")
     * @param toggleViewId  Button that triggers the toggle
     * @param targetClass   The BroadcastReceiver class for the PendingIntent
     */
    fun applyDeviceView(
        context: Context,
        views: RemoteViews,
        device: Device,
        nameViewId: Int,
        stateViewId: Int,
        toggleViewId: Int,
        targetClass: Class<*>,
        appWidgetId: Int,
        position: Int = -1
    ) {
        val deviceId = device.id ?: return
        val power = device.state?.power ?: "off"
        val type = device.type

        views.setTextViewText(nameViewId, device.name)

        if (!DeviceType.isToggleable(type)) {
            // Sensor — hide toggle, show value as text
            views.setViewVisibility(toggleViewId, View.GONE)
            val valueText = device.state?.level?.toString()
                ?: device.state?.power
                ?: ""
            views.setTextViewText(nameViewId, "${device.name}: $valueText")
            return
        }

        // Toggleable device
        views.setViewVisibility(toggleViewId, View.VISIBLE)

        when (type) {
            DeviceType.BUTTON -> {
                views.setTextViewText(stateViewId, "Toggle")
                views.setTextViewText(toggleViewId, "\u26A1")
            }
            else -> {
                val isOn = power == "on"
                views.setTextViewText(stateViewId, if (isOn) "On" else "Off")
                views.setTextViewText(toggleViewId, if (isOn) "ON" else "OFF")
                views.setTextColor(
                    toggleViewId,
                    if (isOn) 0xFF4CAF50.toInt() else 0xFFF44336.toInt()
                )
            }
        }

        // Toggle click PendingIntent
        val requestCode = TOGGLE_REQUEST_BASE + appWidgetId * 100 + (if (position >= 0) position + 1 else 0)
        val toggleIntent = Intent(context, targetClass).apply {
            action = ACTION_TOGGLE
            putExtra("deviceId", deviceId)
            putExtra("appWidgetId", appWidgetId)
            if (position >= 0) putExtra("position", position)
        }
        val togglePending = PendingIntent.getBroadcast(
            context, requestCode, toggleIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(toggleViewId, togglePending)
    }

    /**
     * Set a click PendingIntent on a view that opens the frontend in the browser.
     */
    fun setOnClickOpenFrontend(
        context: Context,
        views: RemoteViews,
        viewId: Int,
        targetClass: Class<*>,
        appWidgetId: Int
    ) {
        val openIntent = Intent(context, targetClass).apply {
            action = ACTION_OPEN
        }
        val openPending = PendingIntent.getBroadcast(
            context, OPEN_REQUEST_BASE + appWidgetId, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(viewId, openPending)
    }

    // ---------- Toggle ----------

    /**
     * Execute toggle on a background thread and return the new state.
     */
    fun toggleAndRefresh(
        host: String,
        deviceId: String,
        onResult: (DeviceState?) -> Unit,
        onError: (Exception) -> Unit = {}
    ) {
        Thread {
            try {
                val newState = CharlieApi.toggleDeviceState(host, deviceId)
                onResult(newState)
            } catch (e: Exception) {
                onError(e)
            }
        }.start()
    }

    // ---------- Frontend ----------

    fun openFrontend(context: Context, host: String?) {
        val url = if (host != null) "http://$host:9305/" else "http://192.168.1.1:9305/"
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}