package com.charlie.widgets.widget.multi

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.RemoteViews
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.charlie.widgets.R
import com.charlie.widgets.api.CharlieApi
import com.charlie.widgets.util.DeviceRenderer
import com.charlie.widgets.util.PreferencesManager

class MultiDeviceWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val appWidgetId = inputData.getInt("appWidgetId", -1)
        if (appWidgetId == -1) return Result.failure()

        val context = applicationContext
        val host = PreferencesManager.getHost(context) ?: return Result.failure()
        val deviceIds = PreferencesManager.getMultiDeviceIds(context, appWidgetId)
        if (deviceIds.isEmpty()) return Result.failure()

        return try {
            val devices = deviceIds.mapNotNull { id ->
                try { CharlieApi.getDevice(host, id) } catch (_: Exception) { null }
            }

            val views = RemoteViews(context.packageName, R.layout.widget_multi_device)
            views.setTextViewText(R.id.widget_title, "Charlie Devices (${devices.size})")

            views.removeAllViews(R.id.widget_device_list)
            for (device in devices) {
                val itemView = RemoteViews(context.packageName, R.layout.widget_multi_device_item)
                DeviceRenderer.applyDeviceView(
                    context, itemView, device,
                    R.id.item_device_name, R.id.item_device_state, R.id.item_toggle_button,
                    MultiDeviceWidget::class.java, appWidgetId
                )
                views.addView(R.id.widget_device_list, itemView)
            }

            val appWidgetManager = android.appwidget.AppWidgetManager.getInstance(context)
            Handler(Looper.getMainLooper()).post {
                appWidgetManager.updateAppWidget(appWidgetId, views)
            }
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val WORK_NAME_PREFIX = "multi_device_refresh_"
    }
}