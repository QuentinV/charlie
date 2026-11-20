# vision-feed — the live camera cascade.
# CPU-first: the detector runs on CPU; the VLM tiers live in the llm container.
#
# Two stages: the builder exports YOLO26n to ONNX (torch — discarded), the
# runtime is lean (onnxruntime only, no torch).

# ---- Stage 1: ensure the model — exports ONLY if the context lacks it --------
FROM python:3.12-slim AS model
WORKDIR /build
# `models/` is tracked (models/.gitkeep) so this COPY always has a source; the
# .dockerignore keeps only the exported model in context, not scratch files.
COPY models/ /build/models/
COPY requirements-export.txt export.py ./
RUN if [ ! -f /build/models/yolo26n.onnx ]; then \
        pip install --no-cache-dir -r requirements-export.txt && \
        python export.py --out /build/models ; \
    fi

# ---- Stage 2: runtime (no torch) --------------------------------------------
FROM python:3.12-slim
WORKDIR /app

# Cap the thread pools: the real "pinning" is a container cpuset (compose), this
# stops the runtime from grabbing every core it can see.
ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2

# mediapipe (Tier 3) needs libGL/libglib, plus libEGL/libGLESv2 for its native
# bindings to dlopen (that is exactly what `ldd .../mediapipe/tasks/c/libmediapipe.so`
# reports as "not found" on a slim image), and libportaudio2 for `sounddevice`:
# `mediapipe.tasks.python` imports its audio module at import time, so a missing
# libportaudio fails the whole import.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libegl1 libgles2 libportaudio2 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# mediapipe depends on the NON-headless `opencv-contrib-python`, which ships the
# same `cv2/` directory as our headless build — whichever wheel pip lays down
# last wins. The headless build is therefore re-installed afterwards, in its own
# invocation, so `cv2` deterministically never needs libGL.
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir --force-reinstall --no-deps opencv-contrib-python-headless

# The exported model lives OUTSIDE /app: the compose mounts ./vision-feed:/app,
# which would hide anything baked at /app/models. config.resolve_yolo_model()
# finds it there.
COPY --from=model /build/models /opt/vision-models

# Tier 3 gestures: MediaPipe's 8 MB gesture model, fetched here so a camera whose
# modes ask for gestures works out of the box (config.resolve_gesture_model()
# still prefers a mounted models/gesture_recognizer.task). Deliberately
# non-fatal: a flaky download must not fail the build — the feed then names the
# path it looked for.
ARG GESTURE_MODEL_URL=https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task
RUN python -c "import os, urllib.request; urllib.request.urlretrieve(os.environ['GESTURE_MODEL_URL'], '/opt/vision-models/gesture_recognizer.task')" \
 && echo 'gesture model ready' \
 || echo 'WARNING: gesture model not downloaded - gestures stay unavailable'

COPY . .

# The container polls the brain for its feeds. The laptop harness runs
# `python main.py --source webcam` instead; a local USB camera in the container
# needs `--device /dev/video0` (or an rtsp/ha source, which needs nothing).
CMD ["python", "main.py", "--brain"]

EXPOSE 9311

