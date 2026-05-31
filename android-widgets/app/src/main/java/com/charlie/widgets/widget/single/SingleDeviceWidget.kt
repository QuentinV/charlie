package com.charlie.widgets.widget.single

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

class SingleDeviceWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "CharlieWidget.Single"
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
                    PreferencesManager.removeSingleDeviceId(context, appWidgetId)
                    cancelPeriodicRefresh(context, appWidgetId)
                }
            }
        }
    }

    private fun updateWidgetAsync(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        Thread {
            try {
                val host = PreferencesManager.getHost(context) ?: return@Thread
                val deviceId = PreferencesManager.getSingleDeviceId(context, appWidgetId) ?: return@Thread

                val device = CharlieApi.getDevice(host, deviceId)
                val views = RemoteViews(context.packageName, R.layout.widget_single_device)

                DeviceRenderer.applyDeviceView(
                    context, views, device!!,
                    R.id.widget_device_name, R.id.widget_device_state, R.id.widget_toggle_button,
                    SingleDeviceWidget::class.java, appWidgetId
                )
                DeviceRenderer.setOnClickOpenFrontend(
                    context, views, R.id.widget_device_name,
                    SingleDeviceWidget::class.java, appWidgetId
                )

                Handler(Looper.getMainLooper()).post {
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error updating widget $appWidgetId", e)
                Handler(Looper.getMainLooper()).post {
                    val views = RemoteViews(context.packageName, R.layout.widget_single_device)
                    views.setTextViewText(R.id.widget_device_name, "Error")
                    views.setTextViewText(R.id.widget_device_state, e.message ?: "Connection failed")
                    views.setViewVisibility(R.id.widget_toggle_button, android.view.View.GONE)
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            }
        }.start()
    }

    private fun toggleAndRefresh(context: Context, host: String, deviceId: String, appWidgetId: Int) {
        DeviceRenderer.toggleAndRefresh(host, deviceId,
            onResult = { newState ->
                val appWidgetManager = AppWidgetManager.getInstance(context)
                val device = CharlieApi.getDevice(host, deviceId)
                if (device != null && newState != null) {
                    val updatedDevice = device.copy(state = newState)
                    val views = RemoteViews(context.packageName, R.layout.widget_single_device)
                    DeviceRenderer.applyDeviceView(
                        context, views, updatedDevice,
                        R.id.widget_device_name, R.id.widget_device_state, R.id.widget_toggle_button,
                        SingleDeviceWidget::class.java, appWidgetId
                    )
                    DeviceRenderer.setOnClickOpenFrontend(
                        context, views, R.id.widget_device_name,
                        SingleDeviceWidget::class.java, appWidgetId
                    )
                    Handler(Looper.getMainLooper()).post {
                        appWidgetManager.updateAppWidget(appWidgetId, views)
                    }
                }
            },
            onError = { e -> Log.e(TAG, "Toggle error", e) }
        )
    }

    private fun schedulePeriodicRefresh(context: Context, appWidgetId: Int) {
        val workName = "${SingleDeviceWorker.WORK_NAME_PREFIX}$appWidgetId"
        val inputData = Data.Builder().putInt("appWidgetId", appWidgetId).build()
        val periodicWork = PeriodicWorkRequestBuilder<SingleDeviceWorker>(15, TimeUnit.MINUTES)
            .setInputData(inputData).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(workName, ExistingPeriodicWorkPolicy.KEEP, periodicWork)
    }

    private fun cancelPeriodicRefresh(context: Context, appWidgetId: Int) {
        WorkManager.getInstance(context).cancelUniqueWork("${SingleDeviceWorker.WORK_NAME_PREFIX}$appWidgetId")
    }
}