package com.charlie.widgets.util

import android.content.Context
import android.content.SharedPreferences

/**
 * Manages SharedPreferences for the app and widget configurations.
 */
object PreferencesManager {

    private const val PREFS_NAME = "charlie_widgets_prefs"
    private const val KEY_HOST = "server_host"
    private const val PREFIX_SINGLE_DEVICE = "single_device_"
    private const val PREFIX_MULTI_DEVICES = "multi_devices_"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // --- Global settings ---

    fun getHost(context: Context): String? = prefs(context).getString(KEY_HOST, null)

    fun setHost(context: Context, host: String) {
        prefs(context).edit().putString(KEY_HOST, host).apply()
    }

    // --- Single device widget config ---

    fun getSingleDeviceId(context: Context, appWidgetId: Int): String? =
        prefs(context).getString("$PREFIX_SINGLE_DEVICE$appWidgetId", null)

    fun setSingleDeviceId(context: Context, appWidgetId: Int, deviceId: String) {
        prefs(context).edit().putString("$PREFIX_SINGLE_DEVICE$appWidgetId", deviceId).apply()
    }

    fun removeSingleDeviceId(context: Context, appWidgetId: Int) {
        prefs(context).edit().remove("$PREFIX_SINGLE_DEVICE$appWidgetId").apply()
    }

    // --- Multi device widget config ---

    fun getMultiDeviceIds(context: Context, appWidgetId: Int): Set<String> =
        prefs(context).getStringSet("$PREFIX_MULTI_DEVICES$appWidgetId", emptySet()) ?: emptySet()

    fun setMultiDeviceIds(context: Context, appWidgetId: Int, deviceIds: Set<String>) {
        prefs(context).edit().putStringSet("$PREFIX_MULTI_DEVICES$appWidgetId", deviceIds).apply()
    }

    fun removeMultiDeviceIds(context: Context, appWidgetId: Int) {
        prefs(context).edit().remove("$PREFIX_MULTI_DEVICES$appWidgetId").apply()
    }

    // --- Cleanup ---

    fun removeWidgetConfig(context: Context, appWidgetId: Int) {
        removeSingleDeviceId(context, appWidgetId)
        removeMultiDeviceIds(context, appWidgetId)
    }
}