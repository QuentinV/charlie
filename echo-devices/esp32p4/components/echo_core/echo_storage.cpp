/*
 * Echo-Cook storage backend.
 *
 * Paths are normalised into ECHO_STORAGE_BASE_PATH so callers can use either
 * "recipes/pizza.txt" or "/storage/recipes/pizza.txt". ".." segments are rejected
 * to keep the VFS from escaping the mount point.
 */
#include "echo_storage.h"

#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/unistd.h>

#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_spiffs.h"
#include "nvs_flash.h"

static const char *TAG = "echo_storage";

/* Short scratch-file basename for the atomic write in echo_storage_write_file().
 * Kept tiny so the sibling stays within SPIFFS_OBJ_NAME_LEN; the picker only
 * lists "*.txt", so an interrupted write can never surface as a recipe. */
#define ECHO_STORAGE_TMP_NAME ".etmp"

static bool s_mounted = false;

const char *echo_storage_base_path(void)
{
    return ECHO_STORAGE_BASE_PATH;
}

esp_err_t echo_nvs_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS needs a reset (%s), erasing", esp_err_to_name(err));
        ESP_RETURN_ON_ERROR(nvs_flash_erase(), TAG, "nvs_flash_erase");
        err = nvs_flash_init();
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "nvs_flash_init: %s", esp_err_to_name(err));
        return err;
    }
    ESP_LOGI(TAG, "NVS ready");
    return ESP_OK;
}

esp_err_t echo_storage_mount(void)
{
    if (s_mounted) {
        return ESP_OK;
    }

    const esp_vfs_spiffs_conf_t conf = {
        .base_path              = ECHO_STORAGE_BASE_PATH,
        .partition_label        = ECHO_STORAGE_PARTITION,
        .max_files              = ECHO_STORAGE_MAX_FILES,
        .format_if_mount_failed = true,
    };

    esp_err_t err = esp_vfs_spiffs_register(&conf);
    if (err != ESP_OK) {
        /* The most common cause is a stale partition table on the device. */
        ESP_LOGE(TAG, "mount '%s' failed: %s - reflash with partitions.csv",
                 ECHO_STORAGE_PARTITION, esp_err_to_name(err));
        return err;
    }

    size_t total = 0, used = 0;
    err = esp_spiffs_info(ECHO_STORAGE_PARTITION, &total, &used);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "esp_spiffs_info: %s", esp_err_to_name(err));
    } else {
        ESP_LOGI(TAG, "'%s' mounted at %s: %u/%u bytes used",
                 ECHO_STORAGE_PARTITION, ECHO_STORAGE_BASE_PATH,
                 (unsigned)used, (unsigned)total);
    }

    s_mounted = true;
    return ESP_OK;
}

esp_err_t echo_storage_init(void)
{
    esp_err_t err = echo_nvs_init();
    if (err != ESP_OK) {
        return err;
    }
    return echo_storage_mount();
}

bool echo_storage_ready(void)
{
    return s_mounted;
}

esp_err_t echo_storage_info(size_t *total, size_t *used)
{
    if (!s_mounted) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_spiffs_info(ECHO_STORAGE_PARTITION, total, used);
}

/* Normalise "recipes/x.txt" or "/storage/recipes/x.txt" into a full VFS path.
 * Rejects empty paths and any ".." component. */
static esp_err_t normalise_path(const char *path, char *out, size_t out_size)
{
    if (path == NULL || out == NULL || out_size < 2) {
        return ESP_ERR_INVALID_ARG;
    }
    while (*path == '/') {
        path++;
    }
    const char *base = ECHO_STORAGE_BASE_PATH;
    size_t base_len = strlen(base);
    size_t rest_len = strlen(path);
    if (rest_len == 0 || base_len + 1 + rest_len >= out_size) {
        return ESP_ERR_INVALID_ARG;
    }
    if (strstr(path, "..") != NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memcpy(out, base, base_len);
    out[base_len] = '/';
    memcpy(out + base_len + 1, path, rest_len + 1);
    return ESP_OK;
}

/* Note: SPIFFS exposes no mkdir over the ESP-IDF VFS (vfs_spiffs_mkdir() always
 * returns ENOTSUP), so parents are never created explicitly. SPIFFS is flat: the
 * full path is stored as the object name and the VFS materialises path
 * components implicitly on open(). opendir()/readdir() then match entries by
 * path prefix, so "recipes/*.txt" enumerates correctly. */

bool echo_storage_exists(const char *path)
{
    char full[128];
    if (normalise_path(path, full, sizeof(full)) != ESP_OK) {
        return false;
    }
    struct stat st;
    return stat(full, &st) == 0;
}

esp_err_t echo_storage_write_file(const char *path, const void *data, size_t len)
{
    char full[128];
    ESP_RETURN_ON_ERROR(normalise_path(path, full, sizeof(full)), TAG, "bad path");

    /* Build a short scratch path next to the target: "<dir>/.etmp". Using
     * "<full>.tmp" overruns SPIFFS_OBJ_NAME_LEN for long names (e.g.
     * "/recipes/gratin_dauphinois.txt.tmp" is 34 > 31 and fopen() fails with
     * SPIFFS_ERR_NAME_TOO_LONG), so the scratch file keeps a fixed short name in
     * the same directory. The rename() stays inside this directory and is the
     * atomic swap. */
    char tmp[128];
    const char *slash = strrchr(full, '/');
    const size_t dir_len = (slash != NULL) ? (size_t)(slash - full) : 0;
    if (dir_len == 0 || dir_len + 1 + sizeof(ECHO_STORAGE_TMP_NAME) > sizeof(tmp)) {
        ESP_LOGE(TAG, "no room for a scratch file next to %s", full);
        return ESP_ERR_INVALID_ARG;
    }
    memcpy(tmp, full, dir_len);
    tmp[dir_len] = '/';
    strcpy(tmp + dir_len + 1, ECHO_STORAGE_TMP_NAME);

    FILE *f = fopen(tmp, "wb");
    if (f == NULL) {
        ESP_LOGE(TAG, "fopen(%s) failed", tmp);
        return ESP_FAIL;
    }
    size_t written = fwrite(data, 1, len, f);
    int close_err = fclose(f);
    if (written != len || close_err != 0) {
        ESP_LOGE(TAG, "write %s failed (%u/%u bytes)", tmp,
                 (unsigned)written, (unsigned)len);
        remove(tmp);
        return ESP_FAIL;
    }
    /* rename() is atomic within one SPIFFS partition. */
    if (rename(tmp, full) != 0) {
        ESP_LOGE(TAG, "rename(%s -> %s) failed", tmp, full);
        remove(tmp);
        return ESP_FAIL;
    }
    return ESP_OK;
}

esp_err_t echo_storage_read_file(const char *path, char *buf, size_t buf_size, size_t *out_len)
{
    if (buf == NULL || buf_size == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    buf[0] = '\0';

    char full[128];
    ESP_RETURN_ON_ERROR(normalise_path(path, full, sizeof(full)), TAG, "bad path");

    FILE *f = fopen(full, "rb");
    if (f == NULL) {
        return ESP_ERR_NOT_FOUND;
    }
    size_t read = fread(buf, 1, buf_size - 1, f);
    bool short_read = !feof(f);
    fclose(f);
    if (short_read) {
        /* Truncating a UTF-8 recipe mid-sequence would render as garbage. */
        ESP_LOGW(TAG, "%s is larger than %u bytes, truncating",
                 full, (unsigned)(buf_size - 1));
    }
    buf[read] = '\0';
    if (out_len != NULL) {
        *out_len = read;
    }
    return ESP_OK;
}

char *echo_storage_read_text(const char *path)
{
    char full[128];
    if (normalise_path(path, full, sizeof(full)) != ESP_OK) {
        return NULL;
    }

    FILE *f = fopen(full, "rb");
    if (f == NULL) {
        return NULL;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return NULL;
    }
    long size = ftell(f);
    if (size < 0 || fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return NULL;
    }

    /* PSRAM first: recipe text plus LVGL label copies add up quickly. */
    char *buf = (char *)heap_caps_malloc((size_t)size + 1,
                                         MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (buf == NULL) {
        buf = (char *)malloc((size_t)size + 1);
    }
    if (buf == NULL) {
        fclose(f);
        return NULL;
    }

    size_t read = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[read] = '\0';
    return buf;
}

esp_err_t echo_storage_delete(const char *path)
{
    char full[128];
    ESP_RETURN_ON_ERROR(normalise_path(path, full, sizeof(full)), TAG, "bad path");
    if (remove(full) != 0) {
        return ESP_ERR_NOT_FOUND;
    }
    return ESP_OK;
}
