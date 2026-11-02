# Base image is parameterizable so a single Dockerfile serves both CPU and GPU:
#   CPU (default): ghcr.io/ggml-org/llama.cpp:server
#   GPU (CUDA)   : ghcr.io/ggml-org/llama.cpp:server-cuda
ARG LLAMA_BASE=ghcr.io/ggml-org/llama.cpp:server
FROM ${LLAMA_BASE}

RUN apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV MODEL_DIR=/app/models
# Models served by the router: "<id>=<hf-repo>/<file.gguf>", space/comma
# separated. Served on demand and kept warm — see llm/README.md.
ENV MODELS="qwen3-4b=unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf qwen3-1.7b=unsloth/Qwen3-1.7B-GGUF/Qwen3-1.7B-UD-Q4_K_XL.gguf"
# How many models may stay loaded at the same time (LRU eviction above that).
ENV MODELS_MAX=2
ENV LLAMA_ARG_KV_UNIFIED=on
ENV LLAMA_PORT=9308

COPY presets /app/presets
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
