package com.charlie.widgets.api

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * OkHttp-based API client for communicating with the Charlie backend.
 * All calls are synchronous (meant to be called from coroutines or WorkManager threads).
 */
object CharlieApi {

    private val JSON = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    /**
     * Builds the API base URL from the configured host.
     */
    private fun apiUrl(host: String, path: String): String = "http://$host:9300/api/$path"

    /**
     * Builds the frontend base URL from the configured host.
     */
    fun frontendUrl(host: String): String = "http://$host:9305/"

    /**
     * Fetch all devices.
     */
    fun getDevices(host: String): List<Device> {
        val request = Request.Builder()
            .url(apiUrl(host, "devices"))
            .get()
            .addHeader("Content-Type", "application/json")
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: "[]"
        val type = object : TypeToken<List<Device>>() {}.type
        return gson.fromJson(body, type)
    }

    /**
     * Fetch a single device by ID.
     */
    fun getDevice(host: String, deviceId: String): Device? {
        val request = Request.Builder()
            .url(apiUrl(host, "devices/$deviceId"))
            .get()
            .addHeader("Content-Type", "application/json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) return null
        val body = response.body?.string() ?: return null
        return gson.fromJson(body, Device::class.java)
    }

    /**
     * Fetch the current state of a device.
     */
    fun getDeviceState(host: String, deviceId: String): DeviceState? {
        val request = Request.Builder()
            .url(apiUrl(host, "devices/$deviceId/state"))
            .get()
            .addHeader("Content-Type", "application/json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) return null
        val body = response.body?.string() ?: return null
        val stateResponse = gson.fromJson(body, DeviceStateResponse::class.java)
        return stateResponse.state
    }

    /**
     * Toggle the state of a device.
     */
    fun toggleDeviceState(host: String, deviceId: String): DeviceState? {
        val request = Request.Builder()
            .url(apiUrl(host, "devices/$deviceId/state/toggle"))
            .put("{}".toRequestBody(JSON))
            .addHeader("Content-Type", "application/json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) return null
        val body = response.body?.string() ?: return null
        val toggleResponse = gson.fromJson(body, ToggleResponse::class.java)
        return toggleResponse.state
    }
}