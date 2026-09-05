import {
    DeviceCapabilities,
    DeviceState,
    DeviceTypes,
    DiscoveredDevice,
    DiscoveryResult,
    PowerType,
    ProviderApiMetaInfo,
    ProviderFunction,
    ProviderFunctionDef,
    ProvidersApis,
} from '../../../types';
import {
    ensureHaSession,
    haCallService,
    haGetEntities,
    haGetState,
    haGetStates,
    haGetServices,
    isHaConfigured,
} from './client';

// =====================================================================
// Home Assistant provider — the bridge between Charlie and HA.
//
// Devices are NOT auto-created: discovered entities are added explicitly by the
// user through the Discovery page. haSync only updates state/history for
// devices that already exist.
// =====================================================================

/** Domains that represent controllable / observable devices (allowlist). */
export const HA_DEVICE_DOMAINS = new Set([
    'light',
    'switch',
    'input_boolean',
    'automation',
    'fan',
    'humidifier',
    'cover',
    'climate',
    'water_heater',
    'media_player',
    'sensor',
    'binary_sensor',
    'button',
    'script',
    'scene',
    'vacuum',
    'lock',
    'camera',
]);

export function haDomainToDeviceType(domain: string): DeviceTypes {
    switch (domain) {
        case 'light':
            return DeviceTypes.light;
        case 'switch':
        case 'input_boolean':
        case 'automation':
        case 'fan':
        case 'humidifier':
            return DeviceTypes.switch;
        case 'cover':
            return DeviceTypes.shutter;
        case 'climate':
        case 'water_heater':
            return DeviceTypes.thermostat;
        case 'media_player':
            return DeviceTypes.tv;
        case 'sensor':
        case 'binary_sensor':
            return DeviceTypes.sensor;
        case 'button':
        case 'script':
        case 'scene':
            return DeviceTypes.button;
        default:
            return DeviceTypes.unknown;
    }
}

function isScalar(value: unknown): value is string | number | boolean {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

/** Map a HA entity to a charlie device state. */
export function haStateToDeviceState(entity: any): DeviceState {
    const s = entity?.state;
    const attrs = entity?.attributes ?? {};

    let power: PowerType | undefined;
    switch (s) {
        case 'on':
        case 'open':
        case 'playing':
        case 'home':
        case 'unlocked':
        case 'cleaning':
        case 'streaming':
            power = 'on';
            break;
        case 'paused':
        case 'idle':
        case 'buffering':
            power = 'pause';
            break;
        case 'off':
        case 'closed':
        case 'unavailable':
        case 'unknown':
        default:
            power = 'off';
    }

    let level: number | undefined;
    if (attrs.brightness_pct != null) level = attrs.brightness_pct;
    else if (attrs.brightness != null)
        level = Math.round((attrs.brightness * 100) / 255);
    else if (attrs.current_position != null) level = attrs.current_position;
    else if (attrs.position != null) level = attrs.position;
    else if (attrs.percentage != null) level = attrs.percentage;
    else if (attrs.volume_level != null)
        level = Math.round(attrs.volume_level * 100);

    const properties: Record<string, string | number | boolean> = {
        state: s,
    };
    if (entity?.last_changed) properties.last_changed = entity.last_changed;
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'friendly_name') return;
        if (isScalar(value)) properties[key] = value;
    });

    return {
        power,
        ...(level != null ? { level } : {}),
        properties,
    };
}
// ===== State control =====

async function haChangeDeviceState(
    { device }: ProviderApiMetaInfo,
    params?: DeviceState
): Promise<DeviceState | boolean> {
    const entityId = device.externalId;
    if (!entityId?.includes('.')) return false;

    const domain = entityId.split('.')[0];
    const data: any = { entity_id: entityId };
    const power = params?.power ?? 'on';

    switch (domain) {
        case 'light':
            if (params?.level != null) data.brightness_pct = params.level;
            await haCallService(
                'light',
                power === 'off' ? 'turn_off' : 'turn_on',
                data
            );
            return true;

        case 'switch':
        case 'input_boolean':
        case 'automation':
            await haCallService(
                domain,
                power === 'off' ? 'turn_off' : 'turn_on',
                data
            );
            return true;

        case 'cover':
            if (params?.level != null) {
                await haCallService('cover', 'set_cover_position', {
                    ...data,
                    position: params.level,
                });
            } else {
                await haCallService(
                    'cover',
                    power === 'off' ? 'close_cover' : 'open_cover',
                    data
                );
            }
            return true;

        case 'fan':
            if (params?.level != null) {
                await haCallService('fan', 'set_percentage', {
                    ...data,
                    percentage: params.level,
                });
            } else {
                await haCallService(
                    'fan',
                    power === 'off' ? 'turn_off' : 'turn_on',
                    data
                );
            }
            return true;

        case 'humidifier':
            if (params?.level != null) {
                await haCallService('humidifier', 'set_humidity', {
                    ...data,
                    humidity: params.level,
                });
            } else {
                await haCallService(
                    'humidifier',
                    power === 'off' ? 'turn_off' : 'turn_on',
                    data
                );
            }
            return true;

        case 'climate':
        case 'water_heater':
            await haCallService(
                domain,
                power === 'off' ? 'turn_off' : 'turn_on',
                data
            );
            return true;

        case 'media_player':
            if (power === 'pause') {
                await haCallService('media_player', 'media_pause', data);
            } else {
                await haCallService(
                    'media_player',
                    power === 'off' ? 'turn_off' : 'turn_on',
                    data
                );
            }
            return true;

        case 'lock':
            await haCallService(
                'lock',
                power === 'off' ? 'lock' : 'unlock',
                data
            );
            return true;

        case 'vacuum':
            if (power === 'pause') {
                await haCallService('vacuum', 'pause', data);
            } else if (power === 'off') {
                await haCallService('vacuum', 'return_to_base', data);
            } else {
                await haCallService('vacuum', 'start', data);
            }
            return true;

        case 'script':
        case 'scene':
        case 'button':
            await haCallService(domain, 'turn_on', data);
            return true;

        case 'camera':
            await haCallService(
                'camera',
                power === 'off' ? 'turn_off' : 'turn_on',
                data
            );
            return true;

        default:
            await haCallService(domain, 'turn_on', data);
            return true;
    }
}

async function haGetDeviceState({
    device,
}: ProviderApiMetaInfo): Promise<DeviceState> {
    if (!device.externalId?.includes('.')) return device.state ?? {};
    const entity = await haGetState(device.externalId);
    console.log('getting state of ', device.externalId);
    if (!entity) return device.state ?? {};
    return haStateToDeviceState(entity);
}

// ===== Capabilities & functions (LLM tools) =====

const DOMAIN_FUNCTIONS: { [domain: string]: ProviderFunctionDef[] } = {
    media_player: [
        { name: 'media_player.media_play' },
        { name: 'media_player.media_pause' },
        { name: 'media_player.media_stop' },
        { name: 'media_player.media_next_track' },
        { name: 'media_player.media_previous_track' },
        {
            name: 'media_player.volume_set',
            params: { volume_level: 'number 0..1' },
        },
        { name: 'media_player.select_source', params: { source: 'string' } },
    ],
    cover: [
        { name: 'cover.open_cover' },
        { name: 'cover.close_cover' },
        { name: 'cover.stop_cover' },
        {
            name: 'cover.set_cover_position',
            params: { position: 'number 0..100' },
        },
    ],
    climate: [
        { name: 'climate.turn_on' },
        { name: 'climate.turn_off' },
        { name: 'climate.set_hvac_mode', params: { hvac_mode: 'string' } },
        {
            name: 'climate.set_temperature',
            params: { temperature: 'number' },
        },
    ],
    fan: [
        { name: 'fan.turn_on' },
        { name: 'fan.turn_off' },
        { name: 'fan.set_percentage', params: { percentage: 'number 0..100' } },
    ],
    humidifier: [
        { name: 'humidifier.turn_on' },
        { name: 'humidifier.turn_off' },
        {
            name: 'humidifier.set_humidity',
            params: { humidity: 'number 0..100' },
        },
    ],
    vacuum: [
        { name: 'vacuum.start' },
        { name: 'vacuum.pause' },
        { name: 'vacuum.stop' },
        { name: 'vacuum.return_to_base' },
    ],
    lock: [
        { name: 'lock.lock' },
        { name: 'lock.unlock' },
        { name: 'lock.open' },
    ],
};

function levelField(domain: string): any {
    switch (domain) {
        case 'light':
            return {
                key: 'level',
                label: 'Luminosité',
                type: 'range',
                unit: '%',
                min: 0,
                max: 100,
                step: 1,
            };
        case 'cover':
            return {
                key: 'level',
                label: 'Position',
                type: 'range',
                unit: '%',
                min: 0,
                max: 100,
                step: 1,
            };
        case 'media_player':
            return {
                key: 'level',
                label: 'Volume',
                type: 'range',
                unit: '%',
                min: 0,
                max: 100,
                step: 1,
            };
        default:
            return null;
    }
}

async function haGetCapabilities({
    device,
}: ProviderApiMetaInfo): Promise<DeviceCapabilities> {
    const entityId = device.externalId;
    if (!entityId?.includes('.')) return {};

    const domain = entityId.split('.')[0];
    const stateSchema = [levelField(domain)].filter(Boolean);
    const defs = DOMAIN_FUNCTIONS[domain];

    if (defs) {
        try {
            const services = await haGetServices();
            const available = new Set(Object.keys(services?.[domain] ?? {}));
            if (available.size) {
                return {
                    stateSchema,
                    functions: defs.filter((d) =>
                        available.has(d.name.split('.')[1])
                    ),
                };
            }
        } catch (e: any) {
            console.error('[HA] get_services failed', e?.message);
        }
    }
    return { stateSchema, functions: defs ?? [] };
}

async function haCallFunction(
    { device }: ProviderApiMetaInfo,
    fnt: ProviderFunction
): Promise<any> {
    const entityId = device.externalId;
    if (!entityId?.includes('.')) return false;

    const domain = entityId.split('.')[0];
    const [svcDomain, service] = fnt.name.includes('.')
        ? fnt.name.split('.')
        : [domain, fnt.name];

    const data = { entity_id: entityId, ...(fnt.params ?? {}) };
    const res = await haCallService(svcDomain, service, data);
    return res ?? true;
}

// ===== Discovery =====

/**
 * Map a HA `/api/states` payload to Charlie `DiscoveredDevice[]`.
 * Pure (no network) so it can be unit-tested. Devices deliberately carry NO
 * `host` — the gateway host lives on the provider row (haSync). Setting it
 * per-entity would trigger discover.ts's host-dedup (one device per host) and
 * collapse every HA entity to the first one. IKEA does the same (no host).
 *
 * `categoryByEntity` (optional) maps `entity_id -> platform` from HA's entity
 * registry — enables grouping discovered devices by HA integration (tradfri,
 * shelly, ...) in the UI. Entities absent from the map get no category.
 */
export function haEntitiesToDevices(
    entities: any[],
    categoryByEntity?: Map<string, string>
): DiscoveredDevice[] {
    const devices: DiscoveredDevice[] = [];

    for (const entity of entities) {
        const entityId = entity?.entity_id;
        if (!entityId?.includes('.')) continue;

        const domain = entityId.split('.')[0];
        if (!HA_DEVICE_DOMAINS.has(domain)) continue;

        devices.push({
            name: entity?.attributes?.friendly_name ?? entityId,
            type: haDomainToDeviceType(domain),
            externalId: entityId,
            ...(categoryByEntity?.get(entityId)
                ? { category: categoryByEntity.get(entityId) }
                : {}),
        });
    }

    return devices;
}

async function haDiscover(): Promise<DiscoveryResult> {
    const entities = (await haGetStates()) ?? [];

    // Optional enrichment: entity registry → integration platform per entity.
    // Best-effort — never fail discovery because categorizing failed.
    let categoryByEntity: Map<string, string> | undefined;
    try {
        const registry = (await haGetEntities()) ?? [];
        categoryByEntity = new Map(
            registry
                .filter((e: any) => e?.entity_id && e?.platform)
                .map((e: any) => [e.entity_id, e.platform])
        );
    } catch (e) {
        console.error(
            '[HA] entity registry fetch failed — discovery without categories',
            (e as any)?.message
        );
    }

    return { devices: haEntitiesToDevices(entities, categoryByEntity) };
}

// ===== Provider =====

const isInit = async () => {
    if (isHaConfigured()) return true;
    await ensureHaSession();
    return isHaConfigured();
};

const apis: ProvidersApis = {
    api: {
        init: isInit,
        isInitialized: isInit,
        discover: haDiscover,
        getDeviceState: haGetDeviceState,
        changeDeviceState: haChangeDeviceState,
        getCapabilities: haGetCapabilities,
        callFunction: haCallFunction,
    },
};

export default apis;
