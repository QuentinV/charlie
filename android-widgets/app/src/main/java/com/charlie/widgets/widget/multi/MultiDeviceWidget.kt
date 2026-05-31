package com.charlie.widgets.widget.multi

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.RemoteViews
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.charlie.widgets.R
import com.charlie.widgets.api.CharlieApi
import com.charlie.widgets.util.DeviceRenderer
import com.charlie.widgets.util.PreferencesManager
import java.util.concurrent.TimeUnit

class MultiDeviceWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "CharlieWidget.Multi"
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateWidgetAsync(context, appWidgetManager, appWidgetId)
            schedulePeriodicRefresh(context, appWidgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        Log.d(TAG, "onReceive action=${intent.action}")

        when (intent.action) {
            DeviceRenderer.ACTION_TOGGLE -> {
                val deviceId = intent.getStringExtra("deviceId") ?: return
                val appWidgetId = intent.getIntExtra("appWidgetId", -1)
                if (appWidgetId == -1) return
                val host = PreferencesManager.getHost(context) ?: return
                toggleAndRefresh(context, host, deviceId, appWidgetId)
            }
            DeviceRenderer.ACTION_OPEN -> {
                val host = PreferencesManager.getHost(context)
                DeviceRenderer.openFrontend(context, host)
            }
            AppWidgetManager.ACTION_APPWIDGET_DELETED -> {
                val appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    PreferencesManager.removeMultiDeviceIds(context, appWidgetId)
                    cancelPeriodicRefresh(context, appWidgetId)
                }
            }
        }
    }

    private fun updateWidgetAsync(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        Thread {
            try {
                val host = PreferencesManager.getHost(context) ?: return@Thread
                val deviceIds = PreferencesManager.getMultiDeviceIds(context, appWidgetId)
                if (deviceIds.isEmpty()) return@Thread

                val devices = deviceIds.mapNotNull { id ->
                    try { CharlieApi.getDevice(host, id) } catch (_: Exception) { null }
                }

                val views = RemoteViews(context.packageName, R.layout.widget_multi_device)
                views.setTextViewText(R.id.widget_title, "Charlie Devices (${devices.size})")

                if (devices.isNotEmpty()) {
                    val serviceIntent = MultiDeviceViewsService.createIntent(context, appWidgetId, devices)
                    views.setRemoteAdapter(R.id.widget_device_list, serviceIntent)
                }

                Handler(Looper.getMainLooper()).post {
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                    appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_device_list)
                    Log.d(TAG, "Widget $appWidgetId updated with ${devices.size} devices")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error updating widget $appWidgetId", e)
                Handler(Looper.getMainLooper()).post {
                    val views = RemoteViews(context.packageName, R.layout.widget_multi_device)
                    views.setTextViewText(R.id.widget_title, "Error: ${e.message}")
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            }
        }.start()
    }

    private fun toggleAndRefresh(context: Context, host: String, deviceId: String, appWidgetId: Int) {
        DeviceRenderer.toggleAndRefresh(host, deviceId,
            onResult = { updateWidgetAsync(context, AppWidgetManager.getInstance(context), appWidgetId) },
            onError = { e -> Log.e(TAG, "Toggle error", e) }
        )
    }

    private fun schedulePeriodicRefresh(context: Context, appWidgetId: Int) {
        val workName = "${MultiDeviceWorker.WORK_NAME_PREFIX}$appWidgetId"
        val inputData = Data.Builder().putInt("appWidgetId", appWidgetId).build()
        val periodicWork = PeriodicWorkRequestBuilder<MultiDeviceWorker>(15, TimeUnit.MINUTES)
            .setInputData(inputData).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(workName, ExistingPeriodicWorkPolicy.KEEP, periodicWork)
    }

    private fun cancelPeriodicRefresh(context: Context, appWidgetId: Int) {
        WorkManager.getInstance(context).cancelUniqueWork("${MultiDeviceWorker.WORK_NAME_PREFIX}$appWidgetId")
    }
}