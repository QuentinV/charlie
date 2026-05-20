FROM ghcr.io/ggml-org/llama.cpp:server

RUN apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV MODEL_DIR=/app/models
ENV MODEL_FILE=Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf
ENV HF_REPO=unsloth/Qwen3-4B-Instruct-2507-GGUF
ENV LLAMA_ARG_THREADS=6
ENV LLAMA_ARG_CTX_SIZE=2048
ENV LLAMA_ARG_BATCH=512
ENV LLAMA_ARG_KV_UNIFIED=on
ENV LLAMA_PORT=9308

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]