package com.charlie.widgets.widget.multi

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.charlie.widgets.R
import com.charlie.widgets.api.Device
import com.charlie.widgets.api.DeviceType
import com.charlie.widgets.util.DeviceRenderer
import com.charlie.widgets.util.PreferencesManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

class MultiDeviceViewsService : RemoteViewsService() {

    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        val appWidgetId = intent.getIntExtra(EXTRA_APPWIDGET_ID, -1)
        val devicesJson = intent.getStringExtra(EXTRA_DEVICES) ?: "[]"
        val devices: List<Device> = Gson().fromJson(devicesJson, object : TypeToken<List<Device>>() {}.type)
        return MultiDeviceViewsFactory(this, appWidgetId, devices)
    }

    companion object {
        private const val EXTRA_APPWIDGET_ID = "appWidgetId"
        private const val EXTRA_DEVICES = "devices"

        fun createIntent(context: Context, appWidgetId: Int, devices: List<Device>): Intent {
            return Intent(context, MultiDeviceViewsService::class.java).apply {
                putExtra(EXTRA_APPWIDGET_ID, appWidgetId)
                putExtra(EXTRA_DEVICES, Gson().toJson(devices))
            }
        }
    }
}

class MultiDeviceViewsFactory(
    private val context: Context,
    private val appWidgetId: Int,
    private val devices: List<Device>
) : RemoteViewsService.RemoteViewsFactory {

    override fun onCreate() {}
    override fun onDataSetChanged() {}
    override fun onDestroy() {}
    override fun getCount(): Int = devices.size

    override fun getViewAt(position: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_multi_device_item)
        val device = devices.getOrNull(position) ?: return views

        val deviceId = device.id ?: return views
        val power = device.state?.power ?: "off"
        val type = device.type

        // Set device name
        views.setTextViewText(R.id.item_device_name, device.name)

        if (!DeviceType.isToggleable(type)) {
            // Sensor - hide toggle, show value
            views.setViewVisibility(R.id.item_toggle_button, View.GONE)
            views.setTextViewText(R.id.item_device_state, device.state?.level?.toString() ?: power)
        } else {
            views.setViewVisibility(R.id.item_toggle_button, View.VISIBLE)
            val isOn = power == "on"
            views.setTextViewText(R.id.item_toggle_button, if (isOn) "ON" else "OFF")
            views.setTextColor(R.id.item_toggle_button, if (isOn) 0xFF4CAF50.toInt() else 0xFFF44336.toInt())

            // Set toggle PendingIntent with unique request code per widget+position
            val requestCode = 10000 + appWidgetId * 100 + position
            val toggleIntent = Intent(context, MultiDeviceWidget::class.java).apply {
                action = DeviceRenderer.ACTION_TOGGLE
                putExtra("deviceId", deviceId)
                putExtra("appWidgetId", appWidgetId)
                putExtra("position", position)
            }
            val togglePending = PendingIntent.getBroadcast(
                context, requestCode, toggleIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.item_toggle_button, togglePending)
        }

        // Set fill-in intent for item click (opens frontend) - using RemoteViews fill-in intent
        val fillInIntent = Intent().apply {
            action = DeviceRenderer.ACTION_OPEN
        }
        views.setOnClickFillInIntent(R.id.item_device_name, fillInIntent)

        return views
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
}