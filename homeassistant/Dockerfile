FROM ghcr.io/home-assistant/home-assistant:stable

ENV TZ=Europe/Paris

# Charlie's headless Home Assistant — background device/provider layer.
# Ships:
#   - config/          (configuration.yaml with api:, trusted_networks auth)
#   - configure-auth.py + entrypoint.sh
#                     (rewrite auth_providers from HA_TRUSTED_NETWORKS before boot)
#
# The HA UI is intentionally NOT exposed: HA is only reachable from the Docker
# internal network + host loopback. Device integrations are configured from the
# Charlie frontend (Providers page) through HA's config-flow REST API.

COPY config/ /config/
COPY configure-auth.py entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]