package com.charlie.widgets.widget.single

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.charlie.widgets.R
import com.charlie.widgets.api.CharlieApi
import com.charlie.widgets.api.Device
import com.charlie.widgets.databinding.ActivitySingleConfigBinding
import com.charlie.widgets.util.PreferencesManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SingleDeviceConfigActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "CharlieWidget"
    }

    private lateinit var binding: ActivitySingleConfigBinding
    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val devices = mutableListOf<Device>()
    private var selectedDeviceId: String? = null
    private lateinit var adapter: DeviceSelectionAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySingleConfigBinding.inflate(layoutInflater)
        setContentView(binding.root)

        appWidgetId = intent?.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        Log.d(TAG, "SingleDeviceConfigActivity onCreate appWidgetId=$appWidgetId")

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        setupRecyclerView()
        loadDevices()

        binding.btnConfirm.setOnClickListener {
            val deviceId = selectedDeviceId
            if (deviceId != null) {
                Log.d(TAG, "Confirming widget $appWidgetId with device $deviceId")
                PreferencesManager.setSingleDeviceId(this, appWidgetId, deviceId)

                // Set result and finish - system will call onUpdate automatically
                val resultValue = Intent().putExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID,
                    appWidgetId
                )
                setResult(RESULT_OK, resultValue)

                // Don't send broadcast here - Android system handles the update
                // after RESULT_OK is returned
                finish()
            } else {
                Toast.makeText(this, "Please select a device", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupRecyclerView() {
        adapter = DeviceSelectionAdapter { device ->
            selectedDeviceId = device.id
            binding.btnConfirm.isEnabled = true
        }
        binding.rvDevices.layoutManager = LinearLayoutManager(this)
        binding.rvDevices.adapter = adapter
    }

    private fun loadDevices() {
        val host = PreferencesManager.getHost(this)
        if (host == null) {
            Toast.makeText(this, R.string.host_not_configured, Toast.LENGTH_LONG).show()
            finish()
            return
        }

        Log.d(TAG, "Loading devices from host: $host")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val fetchedDevices = CharlieApi.getDevices(host)
                withContext(Dispatchers.Main) {
                    devices.clear()
                    devices.addAll(fetchedDevices)
                    adapter.submitList(devices.toList())
                    binding.progressBar.visibility = View.GONE
                    binding.tvLoading.visibility = View.GONE

                    if (devices.isEmpty()) {
                        binding.tvEmpty.visibility = View.VISIBLE
                    } else {
                        binding.rvDevices.visibility = View.VISIBLE
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load devices", e)
                withContext(Dispatchers.Main) {
                    binding.progressBar.visibility = View.GONE
                    binding.tvLoading.visibility = View.GONE
                    binding.tvEmpty.visibility = View.VISIBLE
                    binding.tvEmpty.text = "Error: ${e.message}"
                }
            }
        }
    }
}