# echo_wifi — Wi-Fi station on the hosted (P4 host + C6 slave) radio.
#
# esp_wifi is required on purpose: esp_wifi_remote prepends its *injected*
# include directory to that component, so `#include "esp_wifi.h"` resolves to the
# slave-capable header set and the plain esp_wifi_*() calls below are routed to
# esp_hosted. Requiring esp_wifi_remote itself is not enough (and would pull in
# the remote-namespace API we do not use).

idf_component_register(
    SRCS "echo_wifi.cpp"
    INCLUDE_DIRS "include"
    REQUIRES esp_wifi esp_netif esp_event esp_timer echo_core
    PRIV_REQUIRES esp_hw_support
)
