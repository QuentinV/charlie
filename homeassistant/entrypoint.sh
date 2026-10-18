#!/usr/bin/env sh
set -e

# Templated trusted-network auth (only rewrites the file when the env is set).
if [ -n "${HA_TRUSTED_NETWORKS:-}" ]; then
    python3 /usr/local/bin/configure-auth.py
fi

exec python3 -m homeassistant --config /config