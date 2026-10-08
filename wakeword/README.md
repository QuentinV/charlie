# Charlie Wake-Word Pipeline

End-to-end, offline pipeline that trains and deploys a custom French **"Charlie"**
wake word for the Charlie Echo ESP32-S3 devices.

See [`PLAN.md`](./PLAN.md) for the design rationale and the verification notes.

## Why this pipeline exists

The shipped firmware (`echo-devices`) currently runs an **Edge Impulse** model
(`charlie-2_inferencing`, 16 kHz / 1 s window / INT8, 3 labels). This pipeline
replaces it with a locally-trained [microWakeWord](https://github.com/OHF-Voice/micro-wake-word)
streaming model, keeping the device firmware, WebSocket protocol and the
`wakeUpWordAccuracy` knob intact.

## Layout

```
wakeword/
├── Dockerfile.ml             # CUDA (TF 2.15 compatible) / CPU trainer image
├── docker-compose.yml        # ml-trainer service
├── pipeline.sh               # stage orchestrator
├── requirements.txt
├── data/                     # positives / traps / negatives / user_audio
├── dataset_gen/              # synthetic data + augmentation
├── training/                 # microWakeWord config, training & export wrappers
└── output/                   # charlie.tflite + charlie.tflite.json
```

Models are exported straight into the firmware library:
`../echo-devices/libs/ESP32HomeAssistant/model/`.

## Requirements

- Docker + Docker Compose v2
- Windows/Linux/WSL2: NVIDIA Container Toolkit for GPU training (CUDA 12.2 capable driver)
- macOS / GPU-less hosts: `ML_BASE=cpu`

## Running

```bash
chmod +x pipeline.sh
docker compose build                 # or: ML_BASE=cpu docker compose build
./pipeline.sh stage1-data            # Piper synthetic positives + user samples
./pipeline.sh stage2-traps           # phonetic hard negatives + ambient negatives + augmentation
./pipeline.sh stage3-train           # microWakeWord streaming training (INT8 by design)
./pipeline.sh stage4-export          # xxd the .tflite into C headers for the firmware
./pipeline.sh stage5-verify          # host-side parity / model sanity checks

./pipeline.sh all                    # end-to-end
```

## Firmware integration

The trained model is consumed by `ESP32HomeAssistant` through the
`WakeWordEngine` helper (TFLite Micro via `tanakamasayuki/TensorFlowLite_ESP32`).
The engine runs the shared microWakeWord **preprocessor** (raw PCM → 40-channel
log-mel) and the **streaming** wake-word model with sliding-window smoothing,
exactly like ESPHome's `micro_wake_word` component.

## Notes / limitations

- Training quality depends on real user recordings placed in `data/user_audio/`
  (also auto-ingested from `nodejs-apis/recordings` and the
  `echo-devices/test/record.cpp` capture output). Synthetic-only data yields
  higher false-accept rates.
- The 24-hour / < 1 false-accept target from PLAN.md §5 can only be *estimated*
  on synthetic data; validate on real audio before shipping.
