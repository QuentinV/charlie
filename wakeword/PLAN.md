# PLAN.md: Custom French "Charlie" Wake-Word Engine for ESP32-S3

This document specifies the end-to-end pipeline for generating, training, quantizing, and deploying a high-accuracy, offline French wake-word model (**"Charlie"**) targeting the ESP32-S3 microcontroller.

The pipeline leverages local GPU acceleration (NVIDIA RTX 5060), synthetic speech generation (Piper TTS), acoustic augmentation, `micro-wake-word`, and Espressif SIMD vector acceleration (`esp-nn`). Cross-platform execution (Linux, Windows/WSL2, macOS) is guaranteed through a modular Docker container architecture managed by a master script (`pipeline.sh`).

---

## 1. Pipeline Architecture & Orchestration

To avoid image bloat and dependency conflicts between ML Python environments and C++ embedded toolchains, the architecture separates the workload into two lightweight containers orchestrated by `docker-compose` and `pipeline.sh`.

```text
                  ┌─────────────────────────────────────────┐
                  │          pipeline.sh <stage>            │
                  └────────────────────┬────────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
          GPU Machine Learning                Embedded Cross-Compile
        ┌───────────────────────┐            ┌───────────────────────┐
        │   `ml-trainer` Image  │            │  `espressif/idf` Image│
        │ (CUDA + PyTorch/TF)   │            │   (Xtensa C++ / GCC)  │
        └───────────────────────┘            └───────────────────────┘
```

### 1.1 Project Structure

```text
.
├── Dockerfile.ml
├── docker-compose.yml
├── pipeline.sh
├── requirements.txt
├── data/
│   ├── user_audio/         # Real recorded user samples
│   ├── positives/          # Piper TTS synthetic "Charlie" audio
│   ├── traps/              # Phonetic negative words ("Chalet", "Chérie", etc.)
│   └── negatives/          # ESC-50, French speech, music noise
├── dataset_gen/
│   ├── generate_positives.py
│   ├── generate_phonetic_traps.py
│   ├── ingest_user_samples.py
│   └── augment.py
├── training/
│   ├── config_charlie.yaml
│   └── quantize.py
├── output/
│   ├── model_charlie.h5
│   └── model_charlie_int8.tflite
└── firmware/
    ├── CMakeLists.txt
    └── main/
        ├── CMakeLists.txt
        ├── main.cpp
        └── model/
            └── model_charlie_data.h
```

---

## 2. Infrastructure Configuration Files

### `requirements.txt`

```text
torch>=2.1.0
torchaudio>=2.1.0
tensorflow>=2.15.0,<2.16.0
audiomentations>=0.33.0
librosa>=0.10.1
soundfile>=0.12.1
pydub>=0.25.1
piper-tts>=1.2.0
pyyaml>=6.0
tqdm>=4.66.0
```

### `Dockerfile.ml`

```dockerfile
FROM nvidia/cuda:12.8.0-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip python3-dev ffmpeg libsndfile1 git xxd curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

CMD ["bash"]
```

### `docker-compose.yml`

```yaml
version: '3.8'

services:
    ml-trainer:
        build:
            context: .
            dockerfile: Dockerfile.ml
        volumes:
            - .:/workspace
        deploy:
            resources:
                reservations:
                    devices:
                        - driver: nvidia
                          count: all
                          capabilities: [gpu]
        environment:
            - CUDA_VISIBLE_DEVICES=0

    esp-builder:
        image: espressif/idf:v5.1
        volumes:
            - ./firmware:/workspace/firmware
            - .:/workspace
        working_dir: /workspace/firmware
```

### `pipeline.sh`

```bash
#!/usr/bin/env bash
set -e

STAGE=${1:-"help"}

case "$STAGE" in
  stage1-data)
    echo "=== [Phase 1/4] Generating Positive Dataset & Ingesting Samples ==="
    docker compose run --rm ml-trainer python3 dataset_gen/generate_positives.py
    docker compose run --rm ml-trainer python3 dataset_gen/ingest_user_samples.py
    ;;

  stage2-traps)
    echo "=== [Phase 2/4] Generating Phonetic Traps & Acoustic Augmentations ==="
    docker compose run --rm ml-trainer python3 dataset_gen/generate_phonetic_traps.py
    docker compose run --rm ml-trainer python3 dataset_gen/augment.py
    ;;

  stage3-train)
    echo "=== [Phase 3/4] Training Model on GPU & Quantizing to INT8 ==="
    docker compose run --rm ml-trainer python3 -m micro_wake_word.train --config training/config_charlie.yaml
    docker compose run --rm ml-trainer python3 training/quantize.py
    ;;

  stage4-build)
    echo "=== [Phase 4/4] Generating C Header & Compiling ESP32-S3 Firmware ==="
    mkdir -p firmware/main/model
    docker compose run --rm ml-trainer xxd -i output/model_charlie_int8.tflite > firmware/main/model/model_charlie_data.h
    docker compose run --rm esp-builder idf.py -C /workspace/firmware set-target esp32s3
    docker compose run --rm esp-builder idf.py -C /workspace/firmware build
    ;;

  all)
    echo "=== Running Full Pipeline End-to-End ==="
    $0 stage1-data
    $0 stage2-traps
    $0 stage3-train
    $0 stage4-build
    ;;

  *)
    echo "Usage: ./pipeline.sh {stage1-data|stage2-traps|stage3-train|stage4-build|all}"
    exit 1
    ;;
esac
```

---

## 3. Implementation Steps

### Phase 1: Synthetic French Dataset Generation

- **Target Phrase:** `"Charlie"` (`/ʃaʁ.li/`).
- **Piper TTS Models:** `fr_FR-upmc-medium` and `fr_FR-siwis-medium`.
- **Parametric Variations:** Sweep speed/length scale (`0.75` to `1.30` at `0.05` steps) and noise variance parameters.
- **Output:** ~3,000 to 5,000 mono WAV clips at 16 kHz, 16-bit PCM.
- **User Audio Ingestion:** Trim silence, resample to 16 kHz mono, and balance gain for real microphone recordings.

### Phase 2: False Trigger Rejection Engine

- **Phonetic Hard Negatives:** Generate synthetic French words that mimic components of `"Charlie"` (e.g., `"Chalet"`, `"Chérie"`, `"Charlie's"`, `"Charger"`, `"Chapeau"`, `"Charles"`, `"Cherbourg"`).
- **Ambient Noise Ingestion:** Process ESC-50 soundscapes, 10+ hours of French podcasts/Common Voice speech, and background music.
- **Room Impulse Response (RIR):** Convolve audio in PyTorch/CUDA (`torchaudio`) to simulate reverberation, 1m–4m microphone distance, and wall reflections.

### Phase 3: GPU Model Training & INT8 Quantization

- **Architecture:** Streaming 2D Convolutional Neural Network (Depthwise Separable) via `micro-wake-word`.
- **Spectrogram Config:** 40-channel Log Mel Spectrogram (16 kHz sampling, 30 ms window, 10 ms hop size).
- **Loss Strategy:** Binary Cross-Entropy with a false-positive penalty multiplier $\ge 5.0$.
- **Quantization:** Full integer INT8 quantization (`tf.lite.OpsSet.TFLITE_BUILTINS_INT8`) via representative dataset calibration.
- **Output Target:** `model_charlie_int8.tflite` under 50 KB.

### Phase 4: ESP32-S3 Firmware Deployment

- **Conversion:** Convert `.tflite` to `model_charlie_data.h` via `xxd`.
- **SIMD Acceleration:** Linking `espressif/esp-nn` to replace default TFLite Micro kernels with Xtensa LX7 vector assembly instructions.
- **I2S Audio Stream:** Process continuous 16 kHz PCM frames from INMP441 / MSM261S4030 microphones in DMA buffers into Tensor Arena RAM ($\sim 40\text{ KB}$).

---

## 4. Execution Workflow

```bash
# 1. Make orchestrator script executable
chmod +x pipeline.sh

# 2. Build Docker images
docker compose build

# 3. Execute individual pipeline stages
./pipeline.sh stage1-data
./pipeline.sh stage2-traps
./pipeline.sh stage3-train
./pipeline.sh stage4-build

# OR run the end-to-end pipeline in one command:
./pipeline.sh all
```

---

## 5. Verification & Performance Targets

| Metric                       | Target                      | Validation Method                                             |
| ---------------------------- | --------------------------- | ------------------------------------------------------------- |
| **Pipeline Reproducibility** | 100% cross-platform         | Executes identically on Linux, WSL2, and macOS                |
| **Model Size**               | $< 50 \text{ KB}$           | Verify size of `output/model_charlie_int8.tflite`             |
| **Tensor RAM Usage**         | $< 45 \text{ KB}$ SRAM      | Monitor `esp_get_free_heap_size()` on target board            |
| **Inference Latency**        | $< 12 \text{ ms}$ per frame | Measure frame processing time using `esp_timer_get_time()`    |
| **Clean Trigger Accuracy**   | $> 92\%$                    | 100 test utterances from 1m to 3m distance                    |
| **False Activation Rate**    | $< 1$ per 24 hours          | 24-hour continuous playback test with French radio/TV streams |

---

## 6. Verification & Corrections (implementation notes)

This plan was verified against the real codebase and upstream projects before
implementation. The following corrections were applied — the pipeline as
originally drafted would **not** have run.

| # | Original plan | Corrected implementation |
| - | ------------- | ------------------------ |
| 1 | `python -m micro_wake_word.train --config ...` | There is **no `micro_wake_word` PyPI package** and no such CLI. Training is driven by the `OHF-Voice/micro-wake-word` notebook (`notebooks/basic_training_notebook.ipynb`) against the `microwakeword` package. `training/train.py` clones it in the image and runs the notebook headlessly via **papermill**. |
| 2 | `training/config_charlie.yaml` | microWakeWord uses its own `training_parameters.yaml` schema with `sampling_weight` / `penalty_weight` / `truth` per feature set. `training/train.py` translates our config into it. |
| 3 | Negatives implied present | microWakeWord needs large **pre-generated negative spectrogram datasets**. Added `dataset_gen/download_negative_datasets.py`. |
| 4 | `nvidia/cuda:12.8.0-devel` + TF 2.15 | TF 2.15 targets **CUDA 12.2 + cuDNN 8.9**. `Dockerfile.ml` uses `nvidia/cuda:12.2.2-cudnn8-devel` and offers a `ML_BASE=cpu` fallback (macOS / GPU-less hosts — CUDA cannot work on macOS). |
| 5 | `training/quantize.py` (INT8 representative dataset) | Unnecessary and **harmful**: the streaming model carries state tensors, and microWakeWord already emits an INT8 streaming `.tflite`. Removed. |
| 6 | Standalone ESP-IDF firmware in `wakeword/firmware` built by `espressif/idf` | The shipping firmware is **PlatformIO/Arduino** (`echo-devices`). Wake-word inference now lives in `echo-devices/libs/ESP32HomeAssistant/WakeWordEngine.{h,cpp}` using TFLite Micro (`tanakamasayuki/TensorFlowLite_ESP32`) and **replaces Edge Impulse** inside `ESP32HomeAssistant`. |
| 7 | `xxd -i output/model_charlie_int8.tflite` | `training/export_headers.py` emits `model/model_charlie_data.h`, `model/preprocessor_charlie_data.h` and `model/charlie_model_config.h` **directly into the firmware library**, guarded by `__has_include` so the firmware builds before the first training run. |
| 8 | Only a single model file | microWakeWord ships **two** models — a shared preprocessor (PCM → 40-ch log-mel) and the streaming wake-word model. Both are exported and loaded. |
| 9 | Streaming semantics unspecified | `WakeWordEngine` introspects the interpreter, feeds features every 10 ms, feeds the recurrent **state tensors** back by name (as ESPHome does), and applies `sliding_window_size` smoothing with `probability_cutoff`. |

### Preserved contracts

`HAConfig.WAKE_UP_WORD_ACCURACY`, the persisted `wordAccuracy` preference, the
`setWakeUpWordAccuracy` WebSocket command, conversation mode, LED states and the
`start` / PCM / `end` WebSocket audio protocol are all unchanged — the
`nodejs-apis/src/echo/*` endpoints and the frontend slider keep working.

