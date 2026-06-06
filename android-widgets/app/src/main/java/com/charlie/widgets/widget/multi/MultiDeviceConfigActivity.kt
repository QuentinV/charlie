package com.charlie.widgets.widget.multi

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.charlie.widgets.R
import com.charlie.widgets.api.CharlieApi
import com.charlie.widgets.api.Device
import com.charlie.widgets.databinding.ActivityMultiConfigBinding
import com.charlie.widgets.util.PreferencesManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MultiDeviceConfigActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMultiConfigBinding
    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val devices = mutableListOf<Device>()
    private val selectedDeviceIds = mutableSetOf<String>()
    private lateinit var adapter: DeviceCheckboxAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMultiConfigBinding.inflate(layoutInflater)
        setContentView(binding.root)

        appWidgetId = intent?.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        setupRecyclerView()
        loadDevices()

        binding.btnConfirm.setOnClickListener {
            if (selectedDeviceIds.isNotEmpty()) {
                PreferencesManager.setMultiDeviceIds(this, appWidgetId, selectedDeviceIds.toSet())
                val resultValue = Intent().putExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID,
                    appWidgetId
                )
                setResult(RESULT_OK, resultValue)

                // Trigger immediate widget update
                val updateIntent = Intent(this, MultiDeviceWidget::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, intArrayOf(appWidgetId))
                }
                sendBroadcast(updateIntent)

                finish()
            } else {
                Toast.makeText(this, "Please select at least one device", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupRecyclerView() {
        adapter = DeviceCheckboxAdapter { device, isChecked ->
            if (isChecked) {
                selectedDeviceIds.add(device.id ?: return@DeviceCheckboxAdapter)
            } else {
                selectedDeviceIds.remove(device.id)
            }
            binding.btnConfirm.isEnabled = selectedDeviceIds.isNotEmpty()
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