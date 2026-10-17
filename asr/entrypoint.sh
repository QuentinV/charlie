#!/bin/bash
set -e

# Default to 0.6B, but can be overridden with -e MODEL_SIZE=1.7B in Docker
MODEL_SIZE="${MODEL_SIZE:-0.6B}"

if [ "$MODEL_SIZE" = "1.7B" ]; then
    MODEL_NAME="sherpa-onnx-qwen3-asr-1.7B-int8"
    HF_REPO="solavr/sherpa-onnx-qwen3-asr-1.7B-int8"
else
    MODEL_SIZE="0.6B"
    MODEL_NAME="sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25"
    DOWNLOAD_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"
fi

MODEL_DIR="/app/models/$MODEL_NAME"

if [ ! -d "$MODEL_DIR" ]; then
    echo "Downloading Qwen3-ASR $MODEL_SIZE INT8 ONNX model..."
    mkdir -p /app/models
    cd /app/models
    
    if [ "$MODEL_SIZE" = "1.7B" ]; then
        pip install -q huggingface_hub
        python3 -c "import huggingface_hub; huggingface_hub.snapshot_download(repo_id='$HF_REPO', local_dir='$MODEL_DIR')"
    else
        curl -SL -O "$DOWNLOAD_URL"
        tar xvf "${MODEL_NAME}.tar.bz2"
        rm "${MODEL_NAME}.tar.bz2"
    fi
    echo "Model download complete."
fi

exec python3 /app/server.py --model-dir "$MODEL_DIR" --num-threads "${NUM_THREADS:-4}"