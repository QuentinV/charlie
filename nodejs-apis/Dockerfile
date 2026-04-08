FROM node:22

WORKDIR /app

# Install ffplay dependencies
RUN apt-get update && apt-get install -y \
    net-tools iputils-ping \
    ffmpeg \
    libasound2 \
    libxv1 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*


COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

USER node