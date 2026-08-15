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
# (resolve the binary path — Debian installs it under /usr/sbin/)
RUN ARP_SCAN_BIN="$(command -v arp-scan 2>/dev/null || echo /usr/sbin/arp-scan)" && \
    test -x "$ARP_SCAN_BIN" && \
    setcap cap_net_raw,cap_net_admin+ep "$ARP_SCAN_BIN" && \
    echo "Capabilities set on $ARP_SCAN_BIN"

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

USER node