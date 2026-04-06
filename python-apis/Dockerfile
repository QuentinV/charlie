FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    curl \
    build-essential \
    cmake \
    gnupg \
    ffmpeg git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && ln -sf /usr/bin/python3.11 /usr/bin/python
RUN python -m pip install --upgrade pip
#RUN pip install --no-cache-dir --upgrade pip

RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124

#RUN pip install --no-cache-dir \
#    torch \
#    torchaudio \
#    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir fastapi uvicorn[standard] authlib mcp griffe mistralai==1.12.4 piper-tts
RUN pip install --no-cache-dir qwen-asr
RUN pip install --no-cache-dir funasr modelscope numpy setuptools
RUN pip install --no-cache-dir huggingface_hub

RUN ln -s /usr/local/cuda/lib64/stubs/libcuda.so /usr/local/cuda/lib64/stubs/libcuda.so.1
ENV LIBRARY_PATH="/usr/local/cuda/lib64/stubs:${LIBRARY_PATH}"
ENV LD_LIBRARY_PATH="/usr/local/cuda/lib64/stubs:${LD_LIBRARY_PATH}"
ENV CMAKE_ARGS="-DGGML_CUDA=ON"

RUN pip install --no-cache-dir llama-cpp-python --verbose

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]