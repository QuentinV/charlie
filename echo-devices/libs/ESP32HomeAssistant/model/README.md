# Trained wake-word model headers (generated)

This directory holds the C headers produced by the wake-word pipeline
(`wakeword/training/export_headers.py`, stage 4). They are **generated
artifacts** and are not committed until the model has been trained on a GPU host.

| File                          | Contents                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| `charlie_model_config.h`      | `WW_*` constants from the model manifest (cutoff, window, …) |
| `model_charlie_data.h`        | `model_charlie_tflite[]` — streaming wake-word model         |
| `preprocessor_charlie_data.h` | `preprocessor_charlie_tflite[]` — audio → 40-ch log-mel      |

When these files are absent, `ESP32HomeAssistant` still compiles: the
`__has_include` guards in `ESP32HomeAssistant.cpp` disable the wake-word engine
and log a hint. To enable it:

```bash
cd wakeword
./pipeline.sh stage3-train
./pipeline.sh stage4-export
```

No further code changes are needed — rebuild and flash the firmware.
