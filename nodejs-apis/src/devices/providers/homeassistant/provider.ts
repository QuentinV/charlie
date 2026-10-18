import {
    DeviceCapabilities,
    DeviceState,
    DeviceTypes,
    DiscoveredDevice,
    DiscoveryResult,
    PowerType,
    PropertyValue,
    ProviderApiMetaInfo,
    ProviderFunction,
    ProvidersApis,
} from '../../../types';
import {
    FunctionSource,
    ServiceCall,
    buildFunctionsFor,
    buildStateSchema,
    canPower,
    controlProfileFor,
    serviceCallFor,
} from './capabilities';
import {
    FUNCTION_DOMAINS,
    LEVEL_SOURCES,
    LEVEL_STATE_DOMAINS,
    MODE_DOMAINS,
    POWER_FALLBACK_DOMAINS,
    SUPPORTED_FEATURES,
    propertiesFor,
    siblingDomainsFor,
} from './domains';
import {
    HaRegistryEntry,
    ensureHaSession,
    haCallService,
    haGetEntities,
    haGetEntityRegistry,
    haGetRegistryEntry,
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

/** Domains whose `state` is a mode (`heat`, `cool`, `fan_only`…), not on/off. */
export const HA_CLIMATE_DOMAINS = MODE_DOMAINS;

/**
 * Canonical property carrying a device family's *mode*, when the gateway keeps
 * it in the entity STATE instead of in an attribute.
 *
 * HA's `climate` / `water_heater` do exactly that: the mode (`heat`, `cool`,
 * `fan_only`…) IS the entity state, and `state_attributes` never publishes an
 * `hvac_mode` / `operation_mode` attribute — so without this the mode would
 * simply not exist in `properties`, and every consumer (panel, NLU, agent)
 * would read no mode at all.
 *
 * Derived from the domain tables (`providers/homeassistant/domains.ts`) rather
 * than from a second table, so a domain only declares its mode property once.
 */
const modePropertyKey = (domain: string): string | undefined =>
    propertiesFor(domain).find(
        (property) =>
            property.type === 'enum' &&
            !property.readonly &&
            /^(hvac|operation)_mode$/.test(property.key)
    )?.key;

/**
 * Renderer profile advertised to the frontend. Every HA integration shares
 * `codesource: homeassistant`, so the naive `<type>/<codesource>` key can never
 * tell a `climate` entity from a `water_heater` — the capability profile
 * decides instead (see `providers/homeassistant/domains.ts`).
 */
export const haDomainToControlProfile = controlProfileFor;

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

/**
 * Scalar gateway attributes, excluding the given keys. These ARE the canonical
 * state properties: profiles use the gateway's own names (`temperature`,
 * `hvac_mode`, `fan_mode`…), so no aliasing step is needed.
 */
function scalarAttributes(
    attrs: Record<string, any> = {},
    exclude: string[] = []
): Record<string, PropertyValue> {
    const out: Record<string, PropertyValue> = {};
    Object.entries(attrs).forEach(([key, value]) => {
        if (exclude.includes(key)) return;
        if (isScalar(value)) out[key] = value;
    });
    return out;
}

/** Domains whose `state` is a measurement, not a power state. */
export const MEASUREMENT_DOMAINS = new Set(['sensor', 'binary_sensor']);

/** `'24.0'` → 24 (numbers stay numbers); anything else stays a string. */
const asReading = (value: any): PropertyValue =>
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
        ? Number(value)
        : value;

/**
 * `DeviceState.level` of an entity: Charlie's canonical numeric value, read from
 * the first attribute its domain declares (`LEVEL_SOURCES`) — a measurement
 * before a setpoint — or from the entity state for a `sensor`.
 *
 * A domain with no row has no level (its value is `power`), and `unavailable` /
 * `unknown` never produce one: a stale reading would show on a card and in the
 * history as if it were live.
 */
export function haLevel(entity: any): number | undefined {
    const s = entity?.state;
    const domain = entity?.entity_id?.split('.')?.[0] ?? '';
    if (s === 'unavailable' || s === 'unknown') return undefined;

    const attrs = entity?.attributes ?? {};
    const asNumber = (value: any): number | undefined => {
        const reading = asReading(value);
        return typeof reading === 'number' && Number.isFinite(reading)
            ? reading
            : undefined;
    };

    const sources = LEVEL_SOURCES[domain];
    if (sources) {
        for (const { attribute, scale } of sources) {
            const value = asNumber(attrs[attribute]);
            if (value !== undefined) {
                return scale ? Math.round(value * scale) : value;
            }
        }
        return undefined;
    }

    if (LEVEL_STATE_DOMAINS.has(domain)) {
        return asNumber(s);
    }

    return undefined;
}

/** Map a HA entity to a charlie device state. */
export function haStateToDeviceState(entity: any): DeviceState {
    const s = entity?.state;
    const attrs = entity?.attributes ?? {};
    const domain = entity?.entity_id?.split('.')?.[0] ?? '';

    let power: PowerType | undefined;
    if (HA_CLIMATE_DOMAINS.has(domain)) {
        // climate / water_heater report their mode as `state` ('heat', 'cool',
        // 'fan_only', 'heat_cool', …) — only 'off' means powered down.
        power =
            s === 'off' || s === 'unavailable' || s === 'unknown'
                ? 'off'
                : 'on';
    } else {
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
    }

    // Canonical numeric value (see `LEVEL_SOURCES`): brightness, position,
    // volume, percentage, humidity, ambient temperature, sensor reading. Not a
    // property — it lives outside the properties bag.
    const level = haLevel(entity);

    // The mode of a climate / water_heater lives in the entity state, not in an
    // attribute: publish it under its canonical key (`hvac_mode` /
    // `operation_mode`) so it can be read back. `unavailable` / `unknown` are
    // not modes, and 'off' stays a real mode (HA lists it in `hvac_modes`).
    const modeKey = modePropertyKey(domain);
    const mode =
        modeKey && s !== undefined && s !== 'unavailable' && s !== 'unknown'
            ? s
            : undefined;

    // A measurement domain keeps its reading in the entity state too, and its
    // name is HA's `device_class` (`temperature`, `humidity`, `battery`,
    // `motion`…). Publishing it under that very key lets the panel, the NLU and
    // the agent read the measurement with no translation table — the same rule
    // as the climate mode above.
    const deviceClass =
        MEASUREMENT_DOMAINS.has(domain) && typeof attrs.device_class === 'string'
            ? attrs.device_class
            : undefined;
    const reading =
        deviceClass && s !== undefined && s !== 'unavailable' && s !== 'unknown'
            ? domain === 'binary_sensor'
                ? s === 'on'
                : asReading(s)
            : undefined;

    const properties: Record<string, PropertyValue> = {
        ...(s !== undefined ? { state: s } : {}),
        ...(entity?.last_changed ? { last_changed: entity.last_changed } : {}),
        // Canonical keys == gateway attribute names (see `providers/homeassistant/domains.ts`).
        ...scalarAttributes(attrs, ['friendly_name']),
        ...(deviceClass && reading !== undefined
            ? { [deviceClass]: reading }
            : {}),
        ...(mode ? { [modeKey as string]: mode } : {}),
    };

    return {
        power,
        ...(level != null ? { level } : {}),
        properties,
    };
}
// ===== Sibling entities (one HA device = several entities) =====

/**
 * A sibling entity of the device's own entity: the same HA *device*, another
 * domain (a TV is a `media_player` + a `remote` + `button.*`).
 */
export interface HaSibling {
    entity: any;
    registry: HaRegistryEntry;
}

/** Attribute bag an entity exposes for value lists / limits. */
const entityAttrs = (
    entity: any,
    registry?: { capabilities?: Record<string, any> }
): Record<string, any> => ({
    ...(registry?.capabilities ?? {}),
    ...(entity?.attributes ?? {}),
});

/**
 * Function sources of a device: its own entity first, then the siblings that
 * may contribute services (any sibling in a function domain).
 */
export function haFunctionSources(
    entity: any,
    registry?: HaRegistryEntry,
    siblings: HaSibling[] = []
): FunctionSource[] {
    const sources: FunctionSource[] = [
        {
            domain: (entity?.entity_id ?? '').split('.')[0],
            supportedFeatures: registry?.supported_features,
            attrs: entityAttrs(entity, registry),
        },
    ];

    for (const sibling of siblings) {
        sources.push({
            domain: (sibling.entity?.entity_id ?? '').split('.')[0],
            supportedFeatures: sibling.registry?.supported_features,
            attrs: entityAttrs(sibling.entity, sibling.registry),
        });
    }

    return sources;
}

/**
 * Entity a function must be called on. Function names carry their domain
 * (`remote.send_command`), so a domain that isn't the device's own belongs to a
 * sibling entity. Unknown domains fall back to the device itself.
 */
export function haCallTarget(
    functionName: string,
    entityId: string,
    siblings: HaSibling[] = []
): string {
    const serviceDomain = functionName?.split('.')[0];
    const ownDomain = entityId?.split('.')[0];
    if (!serviceDomain || serviceDomain === ownDomain) return entityId;

    return (
        siblings.find(
            (sibling) =>
                (sibling.entity?.entity_id ?? '').split('.')[0] === serviceDomain
        )?.entity?.entity_id ?? entityId
    );
}

/**
 * Entity the power calls must go to: the device itself when it can power
 * itself, else the first sibling whose domain can (a `media_player` has no
 * TURN_ON; its `remote` sibling owns turn_on/turn_off).
 */
export function haPowerTarget(
    entityId: string,
    domain: string,
    supportedFeatures: number | undefined,
    siblings: HaSibling[] = [],
    services?: Record<string, any>
): string {
    if (canPower(domain, supportedFeatures, services)) return entityId;

    const candidates = POWER_FALLBACK_DOMAINS[domain] ?? [];
    for (const sibling of siblings) {
        const siblingDomain = (sibling.entity?.entity_id ?? '').split('.')[0];
        if (!candidates.includes(siblingDomain)) continue;
        if (
            canPower(
                siblingDomain,
                sibling.registry?.supported_features,
                services
            )
        ) {
            return sibling.entity.entity_id;
        }
    }

    // No usable sibling: keep the device's own entity (HA will report why).
    return entityId;
}

/**
 * Sibling entities of `entityId` restricted to the given domains — registry
 * only (memoized), plus one `/api/states` read when there is anything to merge.
 * Exported for tests.
 */
export async function haSiblings(
    entityId: string,
    registry: HaRegistryEntry | undefined,
    domains: string[]
): Promise<HaSibling[]> {
    const deviceId = registry?.device_id;
    if (!deviceId || !domains.length) return [];

    const entries = await haGetEntityRegistry().catch(() => []);
    const siblings = (entries ?? []).filter(
        (entry) =>
            entry?.device_id === deviceId &&
            entry?.entity_id !== entityId &&
            domains.includes((entry?.entity_id ?? '').split('.')[0])
    );
    if (!siblings.length) return [];

    const statesById = new Map<string, any>(
        ((await haGetStates().catch(() => [])) ?? []).map((s: any) => [
            s?.entity_id,
            s,
        ])
    );

    return siblings.map((entry) => ({
        registry: entry,
        entity: statesById.get(entry.entity_id) ?? {
            entity_id: entry.entity_id,
            attributes: {},
        },
    }));
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

        case 'cover': {
            if (power === 'pause') {
                // HA's cover has no `paused` state: STOP halts the motion where it
                // is. The state we return is the one read BEFORE the call, because
                // a cover reports `opening` / `closing` while moving and a lagging
                // read-back must not make the panel believe it moved.
                const before = await haGetState(entityId).catch(() => null);
                const registry = await haGetRegistryEntry(entityId).catch(
                    () => undefined
                );
                // Only an entity advertising STOP owns `stop_cover`; missing
                // metadata keeps the fail-open rule (never hide a capability we
                // cannot judge).
                const canStop =
                    registry?.supported_features == null ||
                    (registry.supported_features &
                        SUPPORTED_FEATURES['cover.CoverEntityFeature.STOP']) !==
                        0;

                if (canStop) {
                    await haCallService('cover', 'stop_cover', data);
                } else {
                    // No STOP service: re-assert the position (weak, but better
                    // than opening the cover). The gateway's vocabulary lives
                    // here, never in the panel.
                    const position = before ? haLevel(before) : undefined;
                    if (position == null) return false;
                    await haCallService('cover', 'set_cover_position', {
                        ...data,
                        position,
                    });
                }
                return before ? haStateToDeviceState(before) : true;
            }

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
        }

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
        case 'water_heater': {
            // `params.level` is deliberately not a write here: for these domains
            // `level` is the AMBIENT reading (`current_temperature`, see
            // `LEVEL_SOURCES`), and the setpoint travels as the canonical
            // `properties.temperature` below. Turning a stray level into
            // `set_temperature` would set the room temperature as the target.
            //
            // Read the entity once: HA service calls are observable (logbook,
            // automations), so skip the power call and the property writes that
            // are already satisfied.
            const entity = await haGetState(entityId).catch(() => null);
            // The canonical properties as HA reports them - mode included (it
            // lives in the entity state, see `haStateToDeviceState`).
            const current: DeviceState = entity
                ? haStateToDeviceState(entity)
                : {};
            const currentProperties = current.properties ?? {};
            const currentPower = current.power === 'off' ? 'off' : 'on';
            const modeKey = modePropertyKey(domain);

            if (power === 'off') {
                if (currentPower !== 'off') {
                    await haCallService(domain, 'turn_off', data);
                }
                // Write-through (see below): return the state the device is
                // heading for instead of making every caller re-read a gateway
                // that may still report the old one.
                return {
                    ...current,
                    power: 'off',
                    properties: {
                        ...currentProperties,
                        ...(modeKey ? { [modeKey]: 'off' } : {}),
                    },
                };
            }

            if (currentPower === 'off') {
                await haCallService(domain, 'turn_on', data);
            }
            // Canonical property writes (temperature / hvac_mode / fan_mode…)
            // contradict a turn_off → only while powering on. `current` skips
            // values the device already reports.
            const applied = await haApplyPropertyWrites(
                domain,
                params?.properties,
                data,
                currentProperties
            );

            // Re-read once (a turn_on restored a mode) and then overlay what we
            // actually sent: a gateway answers a write with a debounced refresh,
            // not with the new value, so a panel would otherwise keep showing the
            // previous one until the next poll. The gateway's own state event
            // reconciles whatever it decides in the end.
            const fresh = await haGetState(entityId).catch(() => entity);
            const freshState: DeviceState = fresh
                ? haStateToDeviceState(fresh)
                : current;
            const writeThrough: Record<string, PropertyValue> = {};
            for (const key of applied) {
                const value = params?.properties?.[key];
                if (value !== undefined) writeThrough[key] = value;
            }

            return {
                ...freshState,
                power: 'on',
                properties: { ...freshState.properties, ...writeThrough },
            };
        }

        case 'media_player': {
            if (params?.level != null) {
                // Volume control (0..100 level → HA 0..1 volume)
                await haCallService('media_player', 'volume_set', {
                    ...data,
                    volume_level: params.level / 100,
                });
                return true;
            }
            if (power === 'pause') {
                await haCallService('media_player', 'media_pause', data);
                return true;
            }

            // The power service may live on a sibling entity: a
            // `media_player` has no TURN_ON, its `remote` sibling powers it.
            const registry = await haGetRegistryEntry(entityId).catch(
                () => undefined
            );
            const siblings = canPower(
                'media_player',
                registry?.supported_features
            )
                ? []
                : await haSiblings(
                      entityId,
                      registry,
                      POWER_FALLBACK_DOMAINS.media_player ?? []
                  ).catch(() => []);
            const target = haPowerTarget(
                entityId,
                'media_player',
                registry?.supported_features,
                siblings
            );

            await haCallService(
                target.split('.')[0],
                power === 'off' ? 'turn_off' : 'turn_on',
                { entity_id: target }
            );
            return true;
        }

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

// Functions are derived from the entity's HA service catalogue — see
// `providers/homeassistant/capabilities.ts#buildFunctions` (feature-gated, params from fields).

// Level fields (brightness / position / volume) live in `providers/homeassistant/domains.ts`
// (`LEVEL_FIELDS`) and are appended by `buildStateSchema`.
// Per-entity climate capabilities (ranges, mode/fan/swing lists, telemetry)
// come from `STANDARD_PROPERTIES` — see `providers/homeassistant/domains.ts`.

// ===== Writes: canonical properties → HA services =====

/** A translated HA service call (see {@link serviceCallFor}). */
export type HaServiceCall = ServiceCall;

/**
 * Translate one canonical state property into the HA service call applying it.
 * Read-only / unknown keys (current_temperature, hvac_action, state,
 * last_changed, supported_features…) return `null`, so the panels'
 * `{ ...props, key: value }` merge never echoes device state back to HA.
 *
 * The mapping itself is data: `write` on each `PropertyProfile`
 * (`providers/homeassistant/domains.ts`).
 */
export function haPropertyToService(
    domain: string,
    key: string,
    value: PropertyValue
): HaServiceCall | null {
    return serviceCallFor(domain, key, value);
}

/**
 * Apply a `DeviceState.properties` bag as HA services:
 *  - a raw HA attribute is skipped when its canonical alias is in the same bag
 *    (panels echo the whole properties object back on every change);
 *  - `current` (canonical properties read from HA) skips values that already
 *    hold the requested value — HA service calls are observable (logbook,
 *    automations);
 *  - identical calls (aliases, duplicates) are collapsed;
 *  - read-only / unknown keys are ignored.
 * Returns the applied property keys. Exported for tests.
 */
export async function haApplyPropertyWrites(
    domain: string,
    properties: Record<string, PropertyValue> | undefined,
    base: Record<string, any> = {},
    current?: Record<string, PropertyValue>
): Promise<string[]> {
    if (!properties) return [];

    const applied: string[] = [];
    const seen = new Set<string>();

    for (const [key, value] of Object.entries(properties)) {
        // Already at the requested value → nothing to do.
        if (current && key in current && `${current[key]}` === `${value}`) {
            continue;
        }

        const call = haPropertyToService(domain, key, value);
        if (!call) continue;

        const signature = `${call.domain}.${call.service}:${JSON.stringify(
            call.data
        )}`;
        if (seen.has(signature)) continue;
        seen.add(signature);

        await haCallService(call.domain, call.service, {
            ...base,
            ...call.data,
        });
        applied.push(key);
    }

    return applied;
}

/**
 * Pure capabilities builder: given an entity's live state, its registry entry
 * and the HA services catalogue, produce the charlie capabilities.
 *
 * Deliberately I/O-free so the whole pipeline (schema, functions, control
 * profile) stays conformance-fixture driven — see
 * `devices/__tests__/conformance.test.ts`. Semantics come from the domain
 * tables in `providers/homeassistant/domains.ts`.
 */
export function haEntityCapabilities(
    entity: any,
    registry?: HaRegistryEntry,
    services?: Record<string, any>,
    siblings: HaSibling[] = []
): DeviceCapabilities {
    const domain = (entity?.entity_id ?? '').split('.')[0];

    const state = buildStateSchema({
        domain,
        // Live attributes are the authoritative source for per-entity value
        // lists (hvac_modes / fan_modes …) and limits (min_temp / max_temp /
        // step); the registry entry covers what the state doesn't expose.
        attrs: entityAttrs(entity, registry),
        services,
        supportedFeatures: registry?.supported_features,
    });
    // Siblings contribute their own domain's services (a `remote` sibling
    // provides the power service and the IRCC keypad).
    const functions = buildFunctionsFor(
        haFunctionSources(entity, registry, siblings),
        services
    );
    const control = haDomainToControlProfile(domain);

    return {
        state,
        ...(functions.length ? { functions } : {}),
        ...(control ? { control } : {}),
    };
}

/**
 * Fetch the siblings a device may need (functions and/or power), per the
 * domain rules of `siblingDomainsFor`: any function-domain sibling HA groups in
 * the same physical device, plus `POWER_FALLBACK_DOMAINS`.
 * Returns `[]` — with no I/O at all — for the vast majority of devices.
 * Exported for tests.
 */
export async function haDeviceSiblings(
    entityId: string,
    domain: string,
    registry?: HaRegistryEntry
): Promise<HaSibling[]> {
    const domains = siblingDomainsFor(domain);
    if (!domains.length) return [];
    return haSiblings(entityId, registry, domains).catch(() => []);
}

async function haGetCapabilities({
    device,
}: ProviderApiMetaInfo): Promise<DeviceCapabilities> {
    const entityId = device.externalId;
    if (!entityId?.includes('.')) return {};

    const domain = entityId.split('.')[0];

    const entity = await haGetState(entityId).catch(() => null);
    const registry = await haGetRegistryEntry(entityId).catch(() => undefined);
    const siblings = await haDeviceSiblings(entityId, domain, registry);
    // The services catalogue is only needed for domains that expose functions
    // (or whose siblings do) — skip the round-trip for plain sensors/lights.
    const needsCatalogue =
        FUNCTION_DOMAINS.has(domain) || siblings.length > 0;
    const services = needsCatalogue
        ? await haGetServices().catch((e: any) => {
              console.error('[HA] get_services failed', e?.message);
              return undefined;
          })
        : undefined;

    return haEntityCapabilities(
        entity ?? { entity_id: entityId, attributes: {} },
        registry,
        services,
        siblings
    );
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

    // A function whose domain isn't the device's own lives on a sibling entity
    // of the same HA device (e.g. `remote.send_command` when the TV's own
    // `media_player` entity does not expose it): resolve it
    // from the registry — no lookup at all for regular calls.
    const siblings =
        svcDomain === domain
            ? []
            : await haSiblings(
                  entityId,
                  await haGetRegistryEntry(entityId).catch(() => undefined),
                  [svcDomain]
              ).catch(() => []);
    const target = haCallTarget(fnt.name, entityId, siblings);

    const data = { entity_id: target, ...(fnt.params ?? {}) };
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
 * registry — enables grouping discovered devices by the HA integration that
 * owns them in the UI. Entities absent from the map get no category.
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
