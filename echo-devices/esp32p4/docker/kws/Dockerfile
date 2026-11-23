# "Hey Charlie" KWS training image — ESP32-P4 echo-cook
#
# Pinned toolchain so a rerun months later reproduces the same model:
#   CUDA 12.8 + cuDNN 9  -> required for RTX 5060 (Blackwell, sm_120)
#   PyTorch cu128 wheels -> only build with sm_120 kernels
#   TF 2.18 [and-cuda]   -> CUDA 12.x build, bundles cuDNN 9
#   microWakeWord        -> cloned at build time, baked into the image
#
# Build:  docker build -t kws:cu128 -f docker/kws/Dockerfile .
# Run:    see docs/wake-word-training.md section 2.3
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

# Container-side mount points: data/ and runs/ are bind-mounted from the host repo
WORKDIR /work

# Fail the build early if the GPU stack is broken at import time
RUN python -c "import torch; print('torch', torch.__version__)" \
 && python -c "import tensorflow as tf; print('tf', tf.__version__)"
