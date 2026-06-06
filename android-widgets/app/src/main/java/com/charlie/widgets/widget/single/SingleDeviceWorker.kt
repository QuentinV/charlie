package com.charlie.widgets.widget.single

import android.content.Context
import android.widget.RemoteViews
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.charlie.widgets.R
import com.charlie.widgets.api.CharlieApi
import com.charlie.widgets.util.DeviceRenderer
import com.charlie.widgets.util.PreferencesManager

/**
 * Worker that refreshes the single device widget data.
 */
class SingleDeviceWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val appWidgetId = inputData.getInt("appWidgetId", -1)
        if (appWidgetId == -1) return Result.failure()

        val context = applicationContext
        val host = PreferencesManager.getHost(context) ?: return Result.failure()
        val deviceId = PreferencesManager.getSingleDeviceId(context, appWidgetId)
            ?: return Result.failure()

        return try {
            val device = CharlieApi.getDevice(host, deviceId)
            if (device != null) {
                val views = RemoteViews(
                    context.packageName,
                    R.layout.widget_single_device
                )
                DeviceRenderer.applyDeviceView(
                    context, views, device,
                    R.id.widget_device_name, R.id.widget_device_state, R.id.widget_toggle_button,
                    SingleDeviceWidget::class.java, appWidgetId
                )
                DeviceRenderer.setOnClickOpenFrontend(
                    context, views, R.id.widget_device_name,
                    SingleDeviceWidget::class.java, appWidgetId
                )

                val appWidgetManager = android.appwidget.AppWidgetManager.getInstance(context)
                appWidgetManager.updateAppWidget(appWidgetId, views)
                Result.success()
            } else {
                Result.failure()
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val WORK_NAME_PREFIX = "single_device_refresh_"
    }
}