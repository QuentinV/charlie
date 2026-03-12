FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    build-essential \
    portaudio19-dev \
    python3-dev \
    gcc \
    ffmpeg git \
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

RUN pip install --no-cache-dir fastapi
RUN pip install --no-cache-dir uvicorn
RUN pip install --no-cache-dir authlib 
RUN pip install --no-cache-dir mcp
RUN pip install --no-cache-dir griffe
RUN pip install --no-cache-dir mistralai==1.12.4
RUN pip install --no-cache-dir piper-tts
RUN pip install --no-cache-dir vosk
RUN pip install --no-cache-dir pyaudio
RUN pip install --no-cache-dir webrtc-noise-gain
RUN pip install --no-cache-dir qwen-asr
RUN pip install --no-cache-dir funasr
RUN pip install --no-cache-dir modelscope
RUN pip install --no-cache-dir numpy
RUN pip install --no-cache-dir setuptools

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]