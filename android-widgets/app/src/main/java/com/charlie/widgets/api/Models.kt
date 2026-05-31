package com.charlie.widgets.api

import com.google.gson.annotations.SerializedName

data class Device(
    @SerializedName("_id")
    val id: String? = null,
    val name: String = "",
    val externalId: String? = null,
    val provider: String? = null,
    val type: String = "unknown",
    val state: DeviceState? = null
)

data class DeviceState(
    val power: String? = null,
    val level: Double? = null,
    val additional: Map<String, Any>? = null
)

data class ToggleResponse(
    val state: DeviceState? = null,
    val res: Any? = null
)

data class DeviceStateResponse(
    val state: DeviceState? = null
)

/**
 * Device type constants matching the frontend DeviceType.
 * Also includes the additional types from the server DeviceTypes enum.
 */
object DeviceType {
    const val LIGHT = "light"
    const val SWITCH = "switch"
    const val BUTTON = "button"
    const val SHUTTER = "shutter"
    const val SENSOR = "sensor"
    const val SPRINKLER = "sprinkler"
    const val TV = "tv"
    const val THERMOSTAT = "thermostat"
    const val OTHER = "other"
    const val UNKNOWN = "unknown"

    /**
     * Returns true if this device type has a toggle-able power state
     * (shows a switch/button rather than just a sensor reading).
     */
    fun isToggleable(type: String): Boolean = when (type) {
        SENSOR, THERMOSTAT -> false
        else -> true
    }
}