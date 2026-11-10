# Base image is parameterizable so a single Dockerfile serves both CPU and GPU:
#   CPU (default): ghcr.io/ggml-org/llama.cpp:server
#   GPU (CUDA)   : ghcr.io/ggml-org/llama.cpp:server-cuda
ARG LLAMA_BASE=ghcr.io/ggml-org/llama.cpp:server
FROM ${LLAMA_BASE}

RUN apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV MODEL_DIR=/app/models
# Models served by the router: "<id>=<hf-repo>/<file.gguf>", space/comma
# separated. Each id gets its own folder, and an entry may name a companion
# multimodal projector with "+" — both files land in the same folder, which is
# what the router's directory scan expects (see llm/README.md). Served on demand
# and kept warm — see llm/README.md.
ENV MODELS="qwen3-4b=unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf qwen3-1.7b=unsloth/Qwen3-1.7B-GGUF/Qwen3-1.7B-UD-Q4_K_XL.gguf qwen3vl-4b=Qwen/Qwen3-VL-4B-Instruct-GGUF/Qwen3VL-4B-Instruct-Q4_K_M.gguf+Qwen/Qwen3-VL-4B-Instruct-GGUF/mmproj-Qwen3VL-4B-Instruct-F16.gguf"
# How many models may stay loaded at the same time (LRU eviction above that).
# 2 keeps chat + the small model warm and lets a vision request lose its slot as
# soon as another model needs one (see llm/README.md).
ENV MODELS_MAX=2
ENV LLAMA_ARG_KV_UNIFIED=on
ENV LLAMA_PORT=9308

COPY presets /app/presets
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
