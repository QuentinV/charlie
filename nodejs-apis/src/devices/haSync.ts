import { v4 as uuidV4 } from 'uuid';
import 'dotenv/config';
import { cs } from '../core/db';
import { HA_HOSTNAME } from '../core/ha';
import {
    isHaConfigured,
    setHaReprovision,
    haSubscribeEvents,
} from '../core/ha';
import { haBootstrap } from '../core/haBootstrap';
import { Provider } from '../types';
import { settings } from '../manager/services/settings';
import { log } from '../manager/services/activities';
import { logDeviceState } from './history';
import {
    HA_DEVICE_DOMAINS,
    haDomainToDeviceType,
    haStateToDeviceState,
} from './providers/homeassistant';

// =====================================================================
// Home Assistant sync — SLIM, network auth only.
// ---------------------------------------------------------------
//  * Resolves the ephemeral HA session via trusted-networks auto-provision
//    (haBootstrap). No token is configured, stored or persisted anywhere.
//  * Seeds the single provider row (idempotent) so Discovery groups the
//    entities under it.
//  * Subscribes to state_changed and only updates EXISTING Charlie devices
//    (matched by externalId = HA entity_id). NO auto-creation of devices,
//    NO area/room sync.
// =====================================================================

const PROVIDER_CODESOURCE = 'homeassistant';

async function resolveHaToken(): Promise<boolean> {
    if (isHaConfigured()) return true;
    return haBootstrap();
}

async function getOrCreateProvider(): Promise<Provider | null> {
    if (!isHaConfigured()) return null;

    const existing = await cs.providers.findOne({
        codesource: PROVIDER_CODESOURCE,
    });
    if (existing) return existing;

    const id = uuidV4();
    await cs.providers.updateOne(
        { _id: id },
        {
            $set: {
                _id: id,
                name: 'Home Assistant',
                codesource: PROVIDER_CODESOURCE,
                host: HA_HOSTNAME,
                type: 'gateway',
            },
        },
        { upsert: true }
    );

    return cs.providers.findOne({ _id: id });
}

function isEnabled(): boolean {
    return (
        settings['devices.providers.homeassistant.enabled'] !== false &&
        isHaConfigured()
    );
}

// ===== State-events subscription =====

export function setupHaEventSync(provider: Provider): (() => void) | undefined {
    if (!provider || !isEnabled()) return undefined;

    return haSubscribeEvents('state_changed', async (event: any) => {
        const entity = event?.data?.new_state ?? event?.data?.newState;
        const entityId = entity?.entity_id;
        if (!entityId?.includes('.')) return;

        const domain = entityId.split('.')[0];
        if (!HA_DEVICE_DOMAINS.has(domain)) return;

        try {
            // Only update devices that already exist — never auto-create.
            const device = await cs.devices.findOne({
                externalId: entityId,
                provider: provider._id,
            });
            if (!device) return;

            const state = haStateToDeviceState(entity);
            await cs.devices.updateOne(
                { _id: device._id },
                { $set: { state } }
            );

            if (settings['devices.providers.homeassistant.history'] !== false) {
                await logDeviceState({ deviceId: device._id });
            }
        } catch (e) {
            log('homeassistant', 'Error processing state_changed', {
                data: JSON.stringify(e),
            });
        }
    });
}

// ===== Startup entry point =====

export async function setupHomeAssistant(): Promise<void> {
    if (settings['devices.providers.homeassistant.enabled'] === false) {
        console.log(
            '[Home Assistant] disabled via settings (devices.providers.homeassistant.enabled=false)'
        );
        return;
    }

    // Self-healing: on a 401 (REST or WebSocket), ha.ts re-provisions the
    // ephemeral session by re-running the trusted-networks bootstrap.
    setHaReprovision(() => haBootstrap());

    const configured = await resolveHaToken();
    if (!configured) {
        console.log(
            '[Home Assistant] no HA session available — check the trusted network (the brain must reach HA from a trusted_networks CIDR).'
        );
        return;
    }

    try {
        const provider = await getOrCreateProvider();
        await setupHaEventSync(provider);
        log('homeassistant', 'Home Assistant sync enabled');
    } catch (e) {
        log('homeassistant', 'Home Assistant setup failed', {
            data: JSON.stringify(e),
        });
    }
}
