/*
 * Echo-Cook persistence: NVS for settings and the "storage" SPIFFS partition for
 * UI bundles, cached images and fonts. Stored bytes are returned exactly as
 * written; no transcoding happens here, so a JSON bundle or an image survives a
 * round trip unchanged.
 *
 * The partition table (project root partitions.csv) defines a data partition
 * labelled "storage"; it is mounted read/write at ECHO_STORAGE_BASE_PATH.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ECHO_STORAGE_PARTITION  "storage"
#define ECHO_STORAGE_BASE_PATH  "/storage"
#define ECHO_STORAGE_MAX_FILES   8

/** @brief Initialise NVS. Recovers automatically from a full/foreign NVS. */
esp_err_t echo_nvs_init(void);

/** @brief Mount the "storage" SPIFFS partition at /storage. Idempotent. */
esp_err_t echo_storage_mount(void);

/** @brief echo_nvs_init() + echo_storage_mount(); returns the first failure. */
esp_err_t echo_storage_init(void);

/** @brief True once SPIFFS is mounted. */
bool echo_storage_ready(void);

/** @brief Fill *total / *used with the SPIFFS partition size in bytes. */
esp_err_t echo_storage_info(size_t *total, size_t *used);

/**
 * @brief Existence check. @p path may be relative to /storage or absolute.
 */
bool echo_storage_exists(const char *path);

/**
 * @brief Write a whole file, creating intermediate paths as needed.
 *
 * SPIFFS is flat: the full path becomes the object name and path components are
 * materialised implicitly on open, so no mkdir is required (the SPIFFS VFS does
 * not implement it anyway).
 *
 * Atomicity: the data is written to a short scratch file in the same directory
 * (".etmp") and renamed, so a power cut leaves either the old or the new file,
 * never a half-written recipe. The scratch name is deliberately short because
 * SPIFFS caps object names at SPIFFS_OBJ_NAME_LEN.
 */
esp_err_t echo_storage_write_file(const char *path, const void *data, size_t len);

/**
 * @brief Read up to @p buf_size - 1 bytes and NUL-terminate.
 *
 * @param out_len Optional; receives the number of bytes actually read (without
 *                the terminator). Pass NULL when not needed.
 */
esp_err_t echo_storage_read_file(const char *path, char *buf, size_t buf_size, size_t *out_len);

/**
 * @brief Read a whole UTF-8 text file into a NUL-terminated heap buffer.
 *
 * @return Buffer to free() with heap_caps_free()/free(), or NULL on error.
 */
char *echo_storage_read_text(const char *path);

/** @brief Delete a file. Returns ESP_ERR_NOT_FOUND when it does not exist. */
esp_err_t echo_storage_delete(const char *path);

/** @brief Normalised mount point. */
const char *echo_storage_base_path(void);

#ifdef __cplusplus
}
#endif
