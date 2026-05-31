package com.charlie.widgets.widget.multi

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.CheckedTextView
import androidx.recyclerview.widget.RecyclerView
import com.charlie.widgets.api.Device

class DeviceCheckboxAdapter(
    private val onCheckChanged: (Device, Boolean) -> Unit
) : RecyclerView.Adapter<DeviceCheckboxAdapter.ViewHolder>() {

    private var devices: List<Device> = emptyList()
    private val checkedStates = mutableSetOf<Int>()

    fun submitList(list: List<Device>) {
        devices = list
        checkedStates.clear()
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(android.R.layout.simple_list_item_multiple_choice, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val device = devices[position]
        val isChecked = checkedStates.contains(position)
        holder.textView.text = device.name
        holder.textView.isChecked = isChecked
        holder.itemView.setOnClickListener {
            val newState = !checkedStates.contains(position)
            if (newState) {
                checkedStates.add(position)
            } else {
                checkedStates.remove(position)
            }
            holder.textView.isChecked = newState
            onCheckChanged(device, newState)
        }
    }

    override fun getItemCount(): Int = devices.size

    class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val textView: CheckedTextView = itemView.findViewById(android.R.id.text1)
    }
}
