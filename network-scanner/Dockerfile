FROM node:22

WORKDIR /app

RUN apt-get update && apt-get install -y \
    arp-scan \
    iproute2 \
    iputils-ping \
    net-tools \
    libcap2-bin \
    && rm -rf /var/lib/apt/lists/*

# Allow arp-scan to open raw sockets without running as root
RUN setcap cap_net_raw,cap_net_admin+ep /usr/bin/arp-scan

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

USER node