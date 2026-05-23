#!/bin/sh
set -e

MODEL_PATH="${MODEL_DIR}/${MODEL_FILE}"
HF_URL="https://huggingface.co/${HF_REPO}/resolve/main/${MODEL_FILE}"

# Download model if not present
if [ ! -f "${MODEL_PATH}" ]; then
    echo "[entrypoint] Model not found at ${MODEL_PATH}"
    echo "[entrypoint] Downloading ${MODEL_FILE} from ${HF_REPO}..."
    mkdir -p "${MODEL_DIR}"

    curl -L \
        --progress-bar \
        --retry 5 \
        --retry-delay 5 \
        --retry-connrefused \
        -o "${MODEL_PATH}.tmp" \
        "${HF_URL}"

    mv "${MODEL_PATH}.tmp" "${MODEL_PATH}"
    echo "[entrypoint] Download complete: ${MODEL_PATH}"
else
    echo "[entrypoint] Model found: ${MODEL_PATH}, skipping download"
fi

echo "[entrypoint] Starting llama-server..."
exec /app/llama-server \
    -m "${MODEL_PATH}" \
    --host 0.0.0.0 \
    --port "${LLAMA_PORT}" \
    --jinja \
    --cache-type-k q8_0 \
    --cache-type-v q8_0 \
    --prio 1 \
    --reasoning off