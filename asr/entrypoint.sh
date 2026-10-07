#!/bin/bash
set -e

MODEL_DIR="/app/models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25"

if [ ! -d "$MODEL_DIR" ]; then
    echo "Downloading Qwen3-ASR 0.6B INT8 ONNX model..."
    mkdir -p /app/models
    cd /app/models
    curl -SL -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2
    tar xvf sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2
    rm sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2
    echo "Model download complete."
fi

exec python3 /app/server.py --model-dir "$MODEL_DIR" --num-threads "${NUM_THREADS:-4}"