package com.charlie.widgets.widget.single

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.CheckedTextView
import androidx.recyclerview.widget.RecyclerView
import com.charlie.widgets.api.Device

/**
 * Adapter that displays devices as a single-choice list using radio-style selection.
 */
class DeviceSelectionAdapter(
    private val onDeviceSelected: (Device) -> Unit
) : RecyclerView.Adapter<DeviceSelectionAdapter.ViewHolder>() {

    private var devices: List<Device> = emptyList()
    private var selectedPosition: Int = -1

    fun submitList(list: List<Device>) {
        devices = list
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(android.R.layout.simple_list_item_single_choice, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val device = devices[position]
        holder.textView.text = device.name
        holder.textView.isChecked = position == selectedPosition
        holder.itemView.setOnClickListener {
            selectedPosition = position
            onDeviceSelected(device)
            notifyDataSetChanged()
        }
    }

    override fun getItemCount(): Int = devices.size

    class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val textView: CheckedTextView = itemView.findViewById(android.R.id.text1)
    }
}