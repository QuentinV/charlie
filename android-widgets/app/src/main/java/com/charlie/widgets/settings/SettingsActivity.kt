package com.charlie.widgets.settings

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.charlie.widgets.R
import com.charlie.widgets.databinding.ActivitySettingsBinding
import com.charlie.widgets.util.PreferencesManager

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Load existing host
        val existingHost = PreferencesManager.getHost(this)
        if (existingHost != null) {
            binding.etHost.setText(existingHost)
        }

        binding.btnSave.setOnClickListener {
            val host = binding.etHost.text?.toString()?.trim()
            if (host.isNullOrBlank()) {
                binding.etHost.error = "Please enter a valid host"
                return@setOnClickListener
            }

            PreferencesManager.setHost(this, host)
            Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
        }
    }
}