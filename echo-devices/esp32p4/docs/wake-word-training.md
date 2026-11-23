# Training "Hey Charlie" — custom wake word for ESP32-P4 (echo-cook)

Target hardware: ESP32-P4-WIFI6 kit (16 MB flash, 32 MB PSRAM, RISC-V dual-core 360 MHz)
Target firmware: `echo-cook` on ESP-IDF 5.5.5 (PlatformIO pioarduino 55.03.311)
Training host: Linux (Ubuntu 24.04) + Docker + NVIDIA RTX 5060 (Blackwell, compute capability sm_120)
Firmware host: the same Linux machine — ESP-IDF native on the host, or the official `espressif/idf` image

> **Decision taken:** the wake phrase is **"Hey Charlie"** (three syllables). A bare "Charlie"
> false-accepts heavily in a kitchen with TV/radio speech, so the extra syllable is required for
> acceptable accuracy. Alternate accepted utterances: "Hey, Charlie" and "OK Charlie".

---

## 0. TL;DR — what is and is not possible

| Path | Trainable locally? | Keeps AEC / barge-in? | Verdict |
|---|---|---|---|
| ESP-SR **WakeNet** custom phrase | No — model format and training code are closed | Yes | Request from Espressif FAE only |
| **ESP-SR AFE front-end + your own TFLite KWS** | **Yes** | **Yes** | **This tutorial** |
| Edge Impulse export to P4 | Partly | Only if you keep the AFE in front | Fallback |
| Cloud wake word | n/a | No | Rejected — offline requirement |

Why row 2 works: `esp_afe_sr_iface_t` can be created with `wakenet_init = false`. You then call
`afe->feed()` / `afe->fetch()` yourself and receive AEC'd, denoised, beamformed 16 kHz mono PCM.
WakeNet is bypassed, AEC is not. That PCM is fed to your own keyword spotter.

The rest of this document produces that keyword spotter as an int8 TFLite model.

---

## 1. Reality check before you start

* **"Hey Charlie" must be requested as one phrase.** The model is trained per phrase, not per word.
* **Kitchen audio is hostile.** Extractor hoods are broadband noise; TV/radio produce competing
  speech. Budget as much time on negatives as on positives.
* **Your own TTS says "Charlie".** With AEC enabled this is mostly suppressed, but also gate
  detection while TTS is streaming in the first firmware revision.
* **Do not train on synthetic speech only.** Synthetic-only models routinely lose 20-40 points of
  recall when moved to a real microphone in a real room. The single largest quality lever is
  200-500 real recordings made on the actual device, in the actual kitchen.

---

## 2. Training environment (Linux + Docker)

### 2.1 Host prerequisites

Training runs inside a GPU-enabled Docker container. The host installs only three things: the
NVIDIA driver, Docker, and the NVIDIA Container Toolkit. Nothing else — no host Python, no host
CUDA toolkit, no conda. The RTX 5060 (sm_120) needs driver 570+ / CUDA 12.8+, so check the
driver before anything else.

```bash
# 1. NVIDIA driver. Blackwell (sm_120) needs 570+; the open kernel modules are the default now.
sudo ubuntu-drivers autoinstall        # or: sudo apt install nvidia-driver-570-open
nvidia-smi                             # must list RTX 5060 and "CUDA Version: 12.8" or newer

# 2. Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"        # log out and back in for the group to apply

# 3. NVIDIA Container Toolkit — this is what makes --gpus work
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Prove the GPU reaches a container before writing a single line of training code:

```bash
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
```

If that prints the RTX 5060, everything below works as written. If it prints "could not select
device driver", step 3 was skipped or Docker was not restarted.

### 2.2 Training image

Build the image once and reuse it for every experiment. Keep the Dockerfile in the repo so the
toolchain is pinned and reproducible — `docker/kws/Dockerfile`:

```dockerfile
FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-venv python3-pip \
        build-essential git curl ffmpeg libsndfile1 sox \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# PyTorch for Blackwell: sm_120 kernels only exist in the cu128 wheels
RUN python3.12 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN pip install --upgrade pip \
 && pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128

# TensorFlow 2.18+ ships CUDA 12.x builds; the and-cuda extra bundles cuDNN 9
RUN pip install "tensorflow[and-cuda]==2.18.*"

# microWakeWord: streaming KWS pipeline used by ESPHome voice satellites.
# Targets ESP32-S3 TFLite Micro int8; the model format is portable to ESP32-P4.
RUN git clone https://github.com/kahrendt/microWakeWord.git /opt/microWakeWord \
 && pip install -r /opt/microWakeWord/requirements.txt

WORKDIR /work

# Fail the build early if the GPU stack is broken at import time
RUN python -c "import torch; print('torch', torch.__version__)" \
 && python -c "import tensorflow as tf; print('tf', tf.__version__)"
```

The real file is committed at `docker/kws/Dockerfile` in this repo — use it, do not retype it.

```bash
docker build -t kws:cu128 -f docker/kws/Dockerfile .
```

Baking the training repo into the image means the container needs no network at training time and
a rerun months later uses the same microWakeWord commit. `data/` and `runs/` are gitignored: the
container writes to them through the bind mount, so multi-GB audio and model blobs never enter git.

### 2.3 Run the container

Datasets and trained models live on the host and are bind-mounted in. The container is
disposable; the artefacts are not.

```bash
mkdir -p data runs

docker run --rm -it --gpus all --shm-size=4g \
  -p 127.0.0.1:8888:8888 \
  -v "$PWD/data:/work/data" \
  -v "$PWD/runs:/work/runs" \
  -v "$PWD/docs:/work/docs:ro" \
  kws:cu128 bash
```

Three flags are not optional:

* `--gpus all` — without it the toolkit is invisible and TensorFlow falls back to CPU silently.
* `--shm-size=4g` — PyTorch `DataLoader` workers crash against Docker's 64 MB default `/dev/shm`
  once you have more than a couple of workers. The failure looks like a random SIGBUS, not like a
  configuration error.
* `-p 127.0.0.1:8888:8888` — publishes Jupyter on loopback only. Drop it if you drive training from
  Python scripts instead of the notebooks. Never publish to `0.0.0.0`: the token-less default is
  reachable by anything on the LAN.

### 2.4 Verify the GPU inside the container

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
python -c "import tensorflow as tf; print(tf.config.list_physical_devices('GPU'))"
```

Both must report the RTX 5060. If TensorFlow sees no GPU, cuDNN 9 is not on the loader path — the
`[and-cuda]` extra normally handles this, but confirm with:

```bash
export LD_LIBRARY_PATH=/opt/venv/lib/python3.12/site-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
```

### 2.5 Save the run command as an alias

Retyping that `docker run` every session invites typos (especially `--shm-size`). Put it in
`~/.bashrc`:

```bash
alias kws='docker run --rm -it --gpus all --shm-size=4g -p 127.0.0.1:8888:8888 \
  -v "$PWD/data:/work/data" -v "$PWD/runs:/work/runs" -v "$PWD/docs:/work/docs:ro" kws:cu128'
```

Then, from the repo root: `kws bash`, or `kws python /opt/microWakeWord/train.py ...`.

### 2.6 Firmware build and flashing on the same host

Firmware work does **not** use the GPU container. Build with PlatformIO natively on the Linux host —
this repo is a pioarduino/ESP-IDF 5.5.5 project, so the usual `pio run` workflow applies unchanged:

```bash
# one-time: serial port permissions, then log out and back in
sudo usermod -aG dialout "$USER"

# one-time: PlatformIO Core (skip if already installed)
python3 -m venv ~/.venvs/pio && source ~/.venvs/pio/bin/activate
pip install platformio

cd ~/esp32p4
pio run                       # build
ls /dev/ttyUSB* /dev/ttyACM*  # find the P4's port (USB-JTAG is usually ttyACM0)
pio run -t upload --upload-port /dev/ttyACM0
pio device monitor -p /dev/ttyACM0 -b 115200
```

Flash the model partition separately with esptool (see 7.3):

```bash
esptool.py --chip esp32p4 -p /dev/ttyACM0 -b 921600 \
    write_flash <MODEL_PARTITION_OFFSET> runs/hey_charlie.tflite
```

To flash from inside a container instead, add `--device=/dev/ttyACM0` and mount the model
directory; in practice flashing from the host is simpler. The trained `.tflite` appears under
`runs/` on the host via the bind mount, so no copying between container and host is needed.

---

## 3. Dataset

### 3.1 Positives (target phrase)

Mix two sources, roughly 60/40:

1. **Synthetic TTS.** Piper TTS with 8-15 voices, varied speed/pitch, ~4,000 clips:
   "Hey Charlie", "Hey, Charlie", "OK Charlie", "Hey Charlie!".
2. **Real device recordings — required.** 200-500 utterances from 10-20 speakers, captured on the
   P4 with the ES7210 array at 16 kHz mono, in the target kitchen, at 0.5-3 m, normal and whispered.

To record: run a temporary firmware build that streams raw 16 kHz mono PCM over the existing WS
audio path (`start` → binary PCM → `end`) and save the server-side WAVs. No new tooling needed.

### 3.2 Negatives (everything else)

10-40 hours of speech and noise that must NOT trigger:

* ACAV100M sample, LibriSpeech subset, FMA music subset.
* Kitchen sounds: extractor hood, running tap, pans, oven fan, cutlery, conversation, radio.
* TV audio in the product's target language.

Record 1-2 hours of *your own kitchen* as a custom background set. This matters more than adding
more generic data.

### 3.3 Augmentation

Room impulse responses (MIT RIRs), gain -20..+10 dB, 7-band EQ, speed 0.85-1.15x, additive noise at
SNR -5..15 dB, and at least one pass of a "phone speaker → device mic" simulation.

---

## 4. Training

Run everything below **inside the `kws` container** (`cd` to the repo root, then `kws bash`).
The notebooks ship in the image at `/opt/microWakeWord/notebooks/`, and `/work/data` on the
container is the host's `data/` directory. Launch Jupyter with:

```bash
jupyter notebook --ip 0.0.0.0 --port 8888 --no-browser --allow-root
```

then open `http://127.0.0.1:8888/?token=...` from the host browser (the token is printed on start;
the port is published on loopback by 2.3).

Use `basic_training_notebook.ipynb` (single phrase) or
`advanced_training_notebook.ipynb` (custom negatives — recommended here).

Config cell:

```json
{
  "wake_word": "hey charlie",
  "model_name": "hey_charlie",
  "target_phrase": ["hey charlie", "hey, charlie", "ok charlie"],
  "feature_type": "melspectrogram",
  "training_input_shape": [40, 40, 1],
  "batch_size": 128,
  "epochs": 60
}
```

Notes:

* `[40, 40, 1]` = 40 mel bins × 40 feature frames per inference. This is the streaming shape the
  on-device feature generator must reproduce **exactly**. Confirm it against the exported model's
  input tensor before writing firmware.
* The standard microWakeWord framing is a 40 ms analysis window with a 10 ms hop. Whatever the
  notebook produces, mirror it on the device — a mismatch silently kills accuracy.
* `batch_size 128` fits easily in 8 GB VRAM; drop to 64 only if you hit OOM.
* TTS clip generation dominates wall-clock time, not the GPU step. Run the pipeline end-to-end once
  before tuning anything.
* Blackwell-specific: torch must be the cu128 build (`no kernel image available for sm_120`
  otherwise), and TensorFlow must see the GPU *before* you generate data or you will train on CPU.

---

## 5. Evaluation gates — do not skip

Evaluate on **held-out real recordings only**, never on the training split.

| Metric | Meaning | Gate |
|---|---|---|
| Recall @ threshold | % of real positives detected | ≥ 92 % |
| FAPH | false accepts per hour of negative audio | ≤ 0.5 |

Protocol:

1. 1 hour of held-out kitchen/background audio → count false accepts.
2. 200 held-out real "Hey Charlie" clips at 0.5-3 m, normal and whispered, TV on in background.
3. Re-run after every threshold change. Ship only when both gates pass.

The chosen threshold becomes the firmware default; the server's `setWakeUpWordAccuracy` command
scales it at runtime.

---

## 6. Quantize and export

```python
converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_dataset   # ~500 clips
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type  = tf.int8
converter.inference_output_type = tf.int8
tflite_model = converter.convert()
open("hey_charlie.tflite", "wb").write(tflite_model)
```

Sanity check the tensor shapes:

```bash
python -c "import tensorflow as tf; i=tf.lite.Interpreter('hey_charlie.tflite'); \
i.allocate_tensors(); print(i.get_input_details()); print(i.get_output_details())"
```

Expected size 40-90 KB. Above ~150 KB is a design smell for a 16 MB dual-OTA device.

---

## 7. Deploy on ESP32-P4

### 7.1 Component layout (scaffolded in this repo)

```
components/echo_wakeword/
  CMakeLists.txt           # builds echo_wakeword.cpp, exposes Kconfig options
  Kconfig                  # ECHO_WAKEWORD_ENGINE_ENABLED, default threshold, partition name
  include/echo_wakeword.h  # C API used by src/main.cpp
  echo_wakeword.cpp        # audio buffering, threshold, cooldown, event dispatch
  engines/                 # not yet present: add tflite_engine.cpp here when the model exists
  models/                  # optional: drop hey_charlie.tflite here for embedding
```

The component builds today with the engine absent. Enabling
`CONFIG_ECHO_WAKEWORD_ENGINE_ENABLED` without `engines/tflite_engine.cpp` is a hard build error on
purpose — the policy layer never silently pretends a model is loaded.

### 7.2 Dependencies

```yaml
# src/idf_component.yml — add when the model is ready
dependencies:
  espressif/esp-sr: "^2.6.0"
  espressif/esp-tflite-micro: "^1.3.0"
```

If `esp-tflite-micro` does not advertise P4 support, build with reference kernels (no ESP-NN):
TFLite Micro is plain C++ and compiles for RISC-V. Expect roughly 2x the per-inference cost of an
S3 with esp-nn. Measure first; a 40 ms-window spotter has headroom.

### 7.3 Model delivery: flash partition vs embedded blob

Two supported options in the scaffold:

* **Partition (default, recommended):** flash `hey_charlie.tflite` into the `model` partition and
  load it at runtime via `esp_partition_mmap`. The wake word can then be updated by OTA without
  rebuilding the app.
* **Embedded:** add
  `board_build.embed_files = components/echo_wakeword/models/hey_charlie.tflite` to `platformio.ini`
  and define `ECHO_WAKEWORD_EMBEDDED_MODEL`. Costs flash inside the app image and requires a full
  app OTA per model change.

Flash command for the partition route:

```bash
esptool.py --chip esp32p4 -p /dev/ttyACM0 -b 921600 \
    write_flash <MODEL_PARTITION_OFFSET> runs/hey_charlie.tflite
```

### 7.4 Wiring into the ESP-SR AFE

```cpp
afe_config_t cfg = {};
cfg.aec_init     = true;      /* reference channel = ES8311 playback  */
cfg.vad_init     = true;
cfg.wakenet_init = false;     /* we run our own KWS                   */
cfg.pcm_config.total_ch_num = 3;   /* 2 mics + 1 playback reference  */
cfg.pcm_config.mic_num      = 2;
cfg.pcm_config.ref_num      = 1;
cfg.pcm_config.sample_rate  = 16000;

esp_afe_sr_iface_t *afe = esp_afe_handle_from_config(&cfg);
afe->create_from_config(&cfg);

while (true) {
    afe_fetch_result_t *r = afe->fetch(afe);        /* AEC'd mono + VAD flag */
    if (r && r->data_size > 0) {
        echo_wakeword_feed((const int16_t *)r->data, r->data_size / sizeof(int16_t));
    }
}
```

`echo_wakeword_feed()` runs on the AFE task and only buffers/analyzes; detection posts an event to
the app state machine, which starts the WS capture exactly like the S3 `_listenAndSendTask`.

### 7.5 Budget on P4

| Item | Estimate |
|---|---|
| Model in flash | 40-90 KB |
| Tensor arena (int8, 40×40×1) | 120-200 KB PSRAM |
| Inference per 10 ms hop | 4-12 ms without esp-nn on P4 @360 MHz |
| AFE (AEC + 2-mic + NS) | 15-25 % of one core |

If inference exceeds ~10 ms per hop, reduce mel bins to 32 or the window to 30 ms **and retrain** —
do not change only the firmware side.

---

## 8. Integration contract with the rest of the firmware

1. `echo_wakeword_init(threshold)` at boot, after NVS, before the AFE task starts.
2. WS command `setWakeUpWordAccuracy` → `echo_wakeword_set_threshold()` (clamped 0.0-1.0).
3. Detection → app state `LISTENING` → same WS sequence as S3: `"start"`, PCM up, `"end"`.
4. While `playAudio` PCM streams, keep the AFE running (AEC handles it) and suppress detection for
   ~300 ms after playback ends — the same idea as the S3 `ttsMuteTailMs` workaround.
5. `feedback` command renders a toast on the 10.1" panel instead of the S3's SSD1306.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no kernel image available for sm_120` | torch built for an older CUDA | reinstall cu128 wheels |
| TensorFlow sees no GPU | cuDNN 9 not on the loader path in the container | `tensorflow[and-cuda]`; set `LD_LIBRARY_PATH` as in 2.4 |
| `could not select device driver "" with capabilities: [[gpu]]` | nvidia-container-toolkit missing or Docker not restarted after configuring it | install the toolkit, `sudo nvidia-ctk runtime configure --runtime=docker`, `sudo systemctl restart docker` |
| `permission denied` talking to the Docker daemon | user not in the `docker` group | `sudo usermod -aG docker $USER`, then log out and back in |
| `DataLoader` workers die with SIGBUS / "killed" | Docker's 64 MB default `/dev/shm` | add `--shm-size=4g` to `docker run` |
| Jupyter page unreachable from the host browser | port 8888 not published | add `-p 127.0.0.1:8888:8888` |
| `Permission denied` on `/dev/ttyACM0` when flashing | user not in `dialout` | `sudo usermod -aG dialout $USER`, then log out and back in |
| High recall in training, low on device | synthetic-only data | add real device recordings |
| Many false accepts in the kitchen | hood/TV not in negatives | add those recordings as negatives |
| Triggers on the device's own TTS | self-audio leaking | verify `aec_init=true` and the reference channel |
| `Invoke()` fails on P4 | unsupported op in the flatbuffer | `MicroMutableOpResolver` with exactly the model's ops |
| Detection feels sluggish (~600 ms) | too much smoothing | reduce consecutive-positive-frame requirement |
| Works in the notebook, not on device | feature framing mismatch | compare 40 ms/10 ms window-hop and mel count |

---

## 10. Licensing

Piper voices and negative corpora carry their own licenses (CC-BY, CC-BY-NC, MIT, etc.). For a
commercial product use commercially-clean TTS voices and licensed noise datasets, and keep an
attribution file under `docs/`. The trained model belongs to you; microWakeWord is Apache-2.0 and
ESPHome's portable feature generator is Apache-2.0 as well.
