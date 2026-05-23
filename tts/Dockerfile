# Stage 1: Build Stage
FROM python:3.11-slim AS builder

WORKDIR /install

# Install build essentials required for some Piper dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies into a specific directory
# We install piper-phonemize separately to help the resolver
RUN pip install --prefix=/install --no-cache-dir \
    piper-tts \
    fastapi \
    uvicorn[standard]

# Stage 2: Runtime Stage
FROM python:3.11-slim

WORKDIR /app

# Copy the pre-installed packages from the builder
COPY --from=builder /install /usr/local

# Install ONLY the runtime library needed for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]