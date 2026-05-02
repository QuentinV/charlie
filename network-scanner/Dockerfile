FROM node:22

WORKDIR /app

RUN apt-get update && apt-get install -y \
    net-tools iputils-ping \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

USER node