# ---------------------------------------------------------------------------
# Charlie wake-word ML trainer image
#
# CUDA base is pinned to the toolkit TensorFlow 2.15 was actually built
# against (CUDA 12.2 + cuDNN 8.9). Using nvidia/cuda:12.8.0-devel (as the
# original draft of PLAN.md did) is NOT binary compatible with TF 2.15 and
# silently degrades to CPU inference.
#
# For hosts without an NVIDIA GPU (e.g. macOS, or a Windows box without the
# NVIDIA Container Toolkit) build the CPU fallback instead:
#     docker compose build --build-arg ML_BASE=cpu
# ---------------------------------------------------------------------------
ARG ML_BASE=cuda
FROM nvidia/cuda:12.2.2-cudnn8-devel-ubuntu22.04 AS cuda
FROM ubuntu:22.04 AS cpu
FROM ${ML_BASE} AS ml

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV TF_CPP_MIN_LOG_LEVEL=2

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-dev python3-venv \
        git curl ca-certificates xxd \
        ffmpeg libsndfile1 espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# ---------------------------------------------------------------------------
# microWakeWord source checkout (provides the `microwakeword` package).
# Pinned to a commit for reproducibility.
# ---------------------------------------------------------------------------
ARG MICROWAKEWORD_REPO=https://github.com/OHF-Voice/micro-wake-word.git
ARG MICROWAKEWORD_REF=main
RUN git clone --depth 1 --branch ${MICROWAKEWORD_REF} ${MICROWAKEWORD_REPO} /opt/micro-wake-word

# ---------------------------------------------------------------------------
# Python deps
# ---------------------------------------------------------------------------
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r requirements.txt \
    && python3 -m pip install --no-cache-dir -e /opt/micro-wake-word

ENV MICROWAKEWORD_HOME=/opt/micro-wake-word

CMD ["bash"]
