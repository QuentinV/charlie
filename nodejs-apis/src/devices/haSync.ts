import { v4 as uuidV4 } from 'uuid';
import 'dotenv/config';
import { cs } from '../core/db';
import { HA_HOSTNAME } from '../core/ha';
import {
    getHaToken,
    getHaRefreshToken,
    isHaConfigured,
    setHaRefreshToken,
    setHaToken,
    setHaTokenPersistence,
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
} from './providers/home_assistant';

// =====================================================================
// Home Assistant sync — SLIM.
// ---------------------------------------------------------------
//  * Resolves the HA token (HA_TOKEN env -> stored Mongo tokens ->
//    trusted-networks bootstrap).
//  * Seeds the single provider row (idempotent) so Discovery groups the
//    entities under it.
//  * Subscribes to state_changed and only updates EXISTING Charlie devices
//    (matched by externalId = HA entity_id). NO auto-creation of devices,
//    NO area/room sync.
// =====================================================================

const PROVIDER_CODESOURCE = 'homeassistant';

// ===== Token persistence (Mongo settings.ha, redacted from API) =====

export async function persistHaTokens(
    access: string,
    refresh: string
): Promise<void> {
    await cs.settings.updateOne(
        { type: 'global' },
        {
            $set: {
                'settings.ha.access': access,
                'settings.ha.refresh': refresh,
            },
        },
        { upsert: true }
    );
}

async function loadStoredHaTokens(): Promise<boolean> {
    if (isHaConfigured()) return true;
    const global = await cs.settings.findOne({ type: 'global' });
    const stored = global?.settings?.ha;
    if (stored?.access) {
        setHaToken(stored.access);
        if (stored.refresh) setHaRefreshToken(stored.refresh);
        return true;
    }
    return false;
}

async function resolveHaToken(): Promise<boolean> {
    if (isHaConfigured()) return true; // HA_TOKEN env
    if (await loadStoredHaTokens()) return true; // persisted refresh token

    // Fresh install: trusted-networks bootstrap.
    const ok = await haBootstrap();
    if (ok) {
        await persistHaTokens(getHaToken(), getHaRefreshToken());
        return true;
    }
    return false;
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

export function setupHaEventSync(): (() => void) | undefined {
    if (!isEnabled()) return undefined;

    return haSubscribeEvents('state_changed', async (event: any) => {
        const entity = event?.data?.new_state ?? event?.data?.newState;
        const entityId = entity?.entity_id;
        if (!entityId?.includes('.')) return;

        const domain = entityId.split('.')[0];
        if (!HA_DEVICE_DOMAINS.has(domain)) return;

        try {
            const provider = await cs.providers.findOne({
                codesource: PROVIDER_CODESOURCE,
            });
            if (!provider) return;

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

    // Persist tokens into Mongo whenever ha.ts refreshes them.
    setHaTokenPersistence(persistHaTokens);

    const configured = await resolveHaToken();
    if (!configured) {
        console.log(
            '[Home Assistant] no token available. Set HA_TOKEN or let the trusted-networks bootstrap provision one.'
        );
        return;
    }

    try {
        await getOrCreateProvider();
        setupHaEventSync();
        log('homeassistant', 'Home Assistant sync enabled');
    } catch (e) {
        log('homeassistant', 'Home Assistant setup failed', {
            data: JSON.stringify(e),
        });
    }
}