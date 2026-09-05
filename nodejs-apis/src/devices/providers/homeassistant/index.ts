import { ProvidersApis } from '../../../types';
import { onBoot } from './sync';
import managerRestApi from './manager';
import providerApis from './provider';

// =====================================================================
// Home Assistant provider — everything HA lives in this folder:
//   client.ts    – REST + WebSocket client (session, states, config flows)
//   bootstrap.ts – trusted-network zero-touch auth (no creds, in-memory token)
//   provider.ts  – ProviderApi bridge (discover / state / services / caps)
//   sync.ts      – onBoot(): seed provider row + state_changed listener
//   manager.ts   – integration wizard REST routes (mounted under /api/ha)
//
// The folder is the provider: startup hook + REST routes + MQTT-free
// listener all defined here (init.ts / manager/index.ts know nothing about
// Home Assistant).
// =====================================================================

const homeassistant: ProvidersApis = {
    api: providerApis.api,
    restApi: managerRestApi,
    restApiBasePath: 'ha',
    onBoot,
};

export default homeassistant;

// Re-export internals so shared logic / tests stay importable.
export * from './client';
export * from './bootstrap';
export * from './provider';
export * from './sync';