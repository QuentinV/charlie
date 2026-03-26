FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    python3-dev \
    build-essential \
    gcc \
    cmake \
    ffmpeg git \
    libvulkan-dev libvulkan1 mesa-vulkan-drivers vulkan-tools mesa-va-drivers mesa-vdpau-drivers \ 
    glslc \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

RUN pip install --no-cache-dir \
    torch \
    torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir fastapi uvicorn[standard] authlib mcp griffe mistralai==1.12.4 piper-tts
RUN pip install --no-cache-dir qwen-asr
RUN pip install --no-cache-dir funasr modelscope numpy setuptools
RUN pip install --no-cache-dir huggingface_hub

RUN CMAKE_ARGS="-DGGML_VULKAN=on -DVULKAN_SDK_PATH=/usr" \
    FORCE_CMAKE=1 \
    pip install llama-cpp-python --no-cache-dir --no-binary llama-cpp-python -v

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]