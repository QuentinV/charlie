FROM node:22

WORKDIR /app

# Install ffplay dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libasound2 \
    libxv1 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

USER node