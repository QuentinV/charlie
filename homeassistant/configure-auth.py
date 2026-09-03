#!/usr/bin/env python3
"""Rewrite Home Assistant auth_providers from the HA_TRUSTED_NETWORKS env var.

Called by entrypoint.sh before HA starts. When HA_TRUSTED_NETWORKS is set
(comma-separated CIDRs) the trusted_networks auth provider is re-generated so
users never edit YAML by hand. When unset, the shipped configuration.yaml is
left untouched (so host bind-mounted user edits are not clobbered).
"""

import os
import sys

import yaml

CONFIG_PATH = "/config/configuration.yaml"
ENV_NAME = "HA_TRUSTED_NETWORKS"


def main() -> int:
    raw = os.environ.get(ENV_NAME, "").strip()
    if not raw:
        return 0

    cidrs = [cidr.strip() for cidr in raw.split(",") if cidr.strip()]
    if not cidrs:
        print(f"[charlie-ha] {ENV_NAME} is empty, keeping shipped auth_providers")
        return 0

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}

    # Keep the 'homeassistant' provider, drop any previous trusted_networks.
    auth_providers = [
        provider
        for provider in config.get("auth_providers", [])
        if provider.get("type") != "trusted_networks"
    ]
    auth_providers.append(
        {
            "type": "trusted_networks",
            "trusted_networks": cidrs,
            "allow_bypass_login": True,
        }
    )
    config["auth_providers"] = auth_providers

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(
            config,
            f,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )

    print(f"[charlie-ha] configured trusted_networks: {', '.join(cidrs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())