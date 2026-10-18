import {
    haCallService,
    haGetEntityRegistry,
    haGetRegistryEntry,
    haGetState,
    haGetStates,
} from '../client';
import apis from '../provider';
import {
    haApplyPropertyWrites,
    haCallTarget,
    haDomainToControlProfile,
    haDomainToDeviceType,
    haEntitiesToDevices,
    haEntityCapabilities,
    haFunctionSources,
    haPowerTarget,
    haPropertyToService,
    haSiblings,
    haStateToDeviceState,
} from '../provider';
// Capability semantics live in the engine + profiles (data), so the unit tests
// exercise both layers directly.
import {
    buildFunctions,
    buildStateSchema,
    canPower,
    serviceCallFor,
} from '../capabilities';
import { siblingDomainsFor } from '../domains';

// The provider only needs the HA transport for the write path: stub it so
// haApplyPropertyWrites can be asserted without a running Home Assistant.
jest.mock('../client', () => ({
    ensureHaSession: jest.fn(async () => true),
    haCallService: jest.fn(async () => undefined),
    haGetEntities: jest.fn(async () => []),
    haGetEntityRegistry: jest.fn(async () => []),
    haGetRegistryEntry: jest.fn(async () => undefined),
    haGetState: jest.fn(async () => null),
    haGetStates: jest.fn(async () => []),
    haGetServices: jest.fn(async () => ({})),
    isHaConfigured: jest.fn(() => true),
}));

const callService = haCallService as unknown as jest.Mock;
const getRegistryEntry = haGetRegistryEntry as unknown as jest.Mock;
const getEntityRegistry = haGetEntityRegistry as unknown as jest.Mock;
const getStates = haGetStates as unknown as jest.Mock;
const getState = haGetState as unknown as jest.Mock;

/**
 * MelCloud-shaped climate entity — values taken from a real HA install
 * (entity registry: hvac_modes, min_temp 10, max_temp 31, step 0.5,
 * fan_modes 1..4, supported_features 937). What it does NOT have: HA keeps the
 * current mode in the entity STATE and exposes no `hvac_mode` / `hvac_action`
 * attribute at all.
 */
const melcloudClimate = {
    entity_id: 'climate.bureau',
    state: 'heat',
    attributes: {
        friendly_name: 'Bureau',
        current_temperature: 21.4,
        temperature: 22,
        hvac_modes: ['off', 'heat', 'dry', 'cool', 'fan_only', 'heat_cool'],
        fan_mode: '2',
        fan_modes: ['auto', '1', '2', '3', '4'],
        swing_mode: 'auto',
        swing_modes: ['auto', '1_up', '2', '3', '4', '5_down', 'swing'],
        swing_horizontal_mode: 'auto',
        swing_horizontal_modes: [
            'auto',
            '1_left',
            '2',
            '3',
            '4',
            '5_right',
            'split',
            'swing',
        ],
        min_temp: 10,
        max_temp: 31,
        target_temp_step: 0.5,
        supported_features: 937,
    },
    last_changed: '2026-01-01T00:00:00Z',
};

/**
 * Slice of HA's `get_services` catalogue for the climate domain — the shape the
 * engine derives schemas, function lists and writes from. Mirrors
 * `homeassistant/components/climate/services.yaml`.
 */
const melcloudServices = {
    climate: {
        turn_on: {
            target: {
                entity: {
                    supported_features: ['climate.ClimateEntityFeature.TURN_ON'],
                },
            },
        },
        turn_off: {
            target: {
                entity: {
                    supported_features: ['climate.ClimateEntityFeature.TURN_OFF'],
                },
            },
        },
        set_hvac_mode: {
            fields: {
                hvac_mode: {
                    selector: {
                        state: { hide_states: ['unavailable', 'unknown'] },
                    },
                },
            },
        },
        set_temperature: {
            fields: {
                temperature: {
                    selector: { number: { min: 0, max: 250, step: 0.1 } },
                },
                target_temp_high: {
                    filter: {
                        supported_features: [
                            'climate.ClimateEntityFeature.TARGET_TEMPERATURE_RANGE',
                        ],
                    },
                    selector: { number: { min: 0, max: 250, step: 0.1 } },
                },
            },
        },
        set_fan_mode: {
            target: {
                entity: {
                    supported_features: ['climate.ClimateEntityFeature.FAN_MODE'],
                },
            },
            fields: { fan_mode: { selector: {} } },
        },
        set_swing_mode: {
            target: {
                entity: {
                    supported_features: [
                        'climate.ClimateEntityFeature.SWING_MODE',
                    ],
                },
            },
            fields: { swing_mode: { selector: {} } },
        },
        set_swing_horizontal_mode: {
            target: {
                entity: {
                    supported_features: [
                        'climate.ClimateEntityFeature.SWING_HORIZONTAL_MODE',
                    ],
                },
            },
            fields: { swing_horizontal_mode: { selector: {} } },
        },
        toggle: {},
    },
};

describe('homeassistant provider', () => {
    test('haDomainToDeviceType maps HA domains to charlie types', () => {
        expect(haDomainToDeviceType('light')).toBe('light');
        expect(haDomainToDeviceType('switch')).toBe('switch');
        expect(haDomainToDeviceType('input_boolean')).toBe('switch');
        expect(haDomainToDeviceType('fan')).toBe('switch');
        expect(haDomainToDeviceType('cover')).toBe('shutter');
        expect(haDomainToDeviceType('climate')).toBe('thermostat');
        expect(haDomainToDeviceType('water_heater')).toBe('thermostat');
        expect(haDomainToDeviceType('media_player')).toBe('tv');
        expect(haDomainToDeviceType('sensor')).toBe('sensor');
        expect(haDomainToDeviceType('binary_sensor')).toBe('sensor');
        expect(haDomainToDeviceType('button')).toBe('button');
        expect(haDomainToDeviceType('script')).toBe('button');
        expect(haDomainToDeviceType('scene')).toBe('button');
        expect(haDomainToDeviceType('vacuum')).toBe('unknown');
        expect(haDomainToDeviceType('lock')).toBe('unknown');
        expect(haDomainToDeviceType('weird_domain')).toBe('unknown');
    });

    test('haStateToDeviceState maps on/off entities', () => {
        expect(
            haStateToDeviceState({ state: 'on', attributes: {} }).power
        ).toBe('on');
        expect(
            haStateToDeviceState({ state: 'off', attributes: {} }).power
        ).toBe('off');
        expect(
            haStateToDeviceState({ state: 'open', attributes: {} }).power
        ).toBe('on');
        expect(
            haStateToDeviceState({ state: 'closed', attributes: {} }).power
        ).toBe('off');
        expect(
            haStateToDeviceState({ state: 'paused', attributes: {} }).power
        ).toBe('pause');
    });

    test('haStateToDeviceState maps brightness to level percent', () => {
        expect(
            haStateToDeviceState({
                entity_id: 'light.cuisine',
                state: 'on',
                attributes: { brightness: 128 },
            }).level
        ).toBe(50);
        expect(
            haStateToDeviceState({
                entity_id: 'light.cuisine',
                state: 'on',
                attributes: { brightness_pct: 42 },
            }).level
        ).toBe(42);
    });

    test('haStateToDeviceState maps cover/fan/volume levels', () => {
        expect(
            haStateToDeviceState({
                entity_id: 'cover.salon',
                state: 'open',
                attributes: { current_position: 70 },
            }).level
        ).toBe(70);
        expect(
            haStateToDeviceState({
                entity_id: 'fan.chambre',
                state: 'on',
                attributes: { percentage: 30 },
            }).level
        ).toBe(30);
        expect(
            haStateToDeviceState({
                entity_id: 'media_player.bravia',
                state: 'playing',
                attributes: { volume_level: 0.5 },
            }).level
        ).toBe(50);
    });

    test('haStateToDeviceState maps the ambient temperature to level (climate)', () => {
        // A thermostat has no level control, but its ambient temperature is the
        // number a card, a chart and a state answer show.
        expect(haStateToDeviceState(melcloudClimate).level).toBe(21.4);
        // A measured value comes before the setpoint …
        expect(
            haStateToDeviceState({
                entity_id: 'water_heater.ballon',
                state: 'eco',
                attributes: { current_temperature: 50, temperature: 55 },
            }).level
        ).toBe(50);
        // … and the setpoint is still a level when nothing else is reported.
        expect(
            haStateToDeviceState({
                entity_id: 'climate.bureau',
                state: 'heat',
                attributes: { temperature: 19.5 },
            }).level
        ).toBe(19.5);
    });

    test('haStateToDeviceState maps humidity to level (humidifier)', () => {
        expect(
            haStateToDeviceState({
                entity_id: 'humidifier.chambre',
                state: 'on',
                attributes: { current_humidity: 52, humidity: 45 },
            }).level
        ).toBe(52);
        expect(
            haStateToDeviceState({
                entity_id: 'humidifier.chambre',
                state: 'on',
                attributes: { humidity: 45 },
            }).level
        ).toBe(45);
    });

    test('haStateToDeviceState maps a numeric reading to level (sensor)', () => {
        expect(
            haStateToDeviceState({
                entity_id: 'sensor.salon_room_temperature',
                state: '24.5',
                attributes: {
                    device_class: 'temperature',
                    unit_of_measurement: '°C',
                },
            }).level
        ).toBe(24.5);
    });

    test('haStateToDeviceState maps battery to level where it is the only number', () => {
        expect(
            haStateToDeviceState({
                entity_id: 'vacuum.aspirateur',
                state: 'docked',
                attributes: { battery_level: 87 },
            }).level
        ).toBe(87);
        expect(
            haStateToDeviceState({
                entity_id: 'lock.porte',
                state: 'locked',
                attributes: { battery_level: 64 },
            }).level
        ).toBe(64);
    });

    test('boolean / stateless domains publish no level', () => {
        // Their value IS the power state: a 0/1 level would replace 'on'/'off'
        // on every card.
        expect(
            haStateToDeviceState({
                entity_id: 'switch.prise',
                state: 'on',
                attributes: { brightness: 128 },
            }).level
        ).toBeUndefined();
        expect(
            haStateToDeviceState({
                entity_id: 'binary_sensor.mouvement',
                state: 'on',
                attributes: { device_class: 'motion' },
            }).level
        ).toBeUndefined();
        expect(
            haStateToDeviceState({
                entity_id: 'button.scene',
                state: '2026-01-01T00:00:00Z',
                attributes: {},
            }).level
        ).toBeUndefined();
    });

    test('an unavailable entity publishes no level', () => {
        expect(
            haStateToDeviceState({
                entity_id: 'climate.bureau',
                state: 'unavailable',
                attributes: { current_temperature: 21.4 },
            }).level
        ).toBeUndefined();
    });

    test('haStateToDeviceState keeps scalar properties and drops extras', () => {
        const state = haStateToDeviceState({
            state: 'on',
            attributes: {
                color_temp: 300,
                friendly_name: 'Salon',
                rgb_color: [1, 2, 3],
            },
            last_changed: '2026-01-01T00:00:00Z',
        });
        expect(state.properties).toMatchObject({
            state: 'on',
            color_temp: 300,
            last_changed: '2026-01-01T00:00:00Z',
        });
        expect(state.properties.friendly_name).toBeUndefined();
        expect(state.properties.rgb_color).toBeUndefined();
    });

    test('haEntitiesToDevices surfaces all same-host entities without a host field', () => {
        // This is the exact failure mode seen in production: many HA entities
        // share one gateway host. If they carried `host`, discover.ts's
        // host-dedup would collapse all of them to the first entity.
        const entities = [
            { entity_id: 'sensor.backup_backup_manager_state', state: 'idle', attributes: { friendly_name: 'Backup' } },
            { entity_id: 'light.ampoule_2', state: 'off', attributes: { friendly_name: 'Ampoule 2' } },
            { entity_id: 'light.tradfri_bulb_3', state: 'off', attributes: { friendly_name: 'Bulb 3' } },
            { entity_id: 'sensor.tradfri_remote_control_battery', state: '100', attributes: {} },
            { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} }, // excluded domain
            { entity_id: 'persistent_notification.config_entry_discovery', state: 'notifying', attributes: {} }, // excluded
        ];

        const devices = haEntitiesToDevices(entities);

        expect(devices).toHaveLength(4);
        // every HA entity must be present — none collapsed by host
        expect(devices.map((d) => d.externalId)).toEqual([
            'sensor.backup_backup_manager_state',
            'light.ampoule_2',
            'light.tradfri_bulb_3',
            'sensor.tradfri_remote_control_battery',
        ]);
        // no `host` field at all (otherwise dedup drops all but the first)
        for (const d of devices) {
            expect(d.host).toBeUndefined();
        }
        // types mapped correctly
        expect(devices[1].type).toBe('light');
        expect(devices[3].type).toBe('sensor');
    });

    test('haEntitiesToDevices skips entities without a valid entity_id', () => {
        const devices = haEntitiesToDevices([
            { entity_id: 'light.salon', attributes: {} },
            { entity_id: 'no-domain', attributes: {} },
            {},
            null,
        ]);
        expect(devices).toHaveLength(1);
        expect(devices[0].externalId).toBe('light.salon');
    });

    test('haEntitiesToDevices adds category from the entity registry map', () => {
        const entities = [
            { entity_id: 'light.ampoule_2', state: 'off', attributes: {} },
            { entity_id: 'light.tradfri_bulb_3', state: 'off', attributes: {} },
            { entity_id: 'sensor.backup_state', state: 'idle', attributes: {} },
        ];
        const categories = new Map<string, string>([
            ['light.ampoule_2', 'tradfri'],
            ['light.tradfri_bulb_3', 'tradfri'],
            ['sensor.backup_state', 'backup'],
        ]);

        const devices = haEntitiesToDevices(entities, categories);

        expect(devices.map((d) => d.category)).toEqual([
            'tradfri',
            'tradfri',
            'backup',
        ]);
    });

    test('haEntitiesToDevices leaves category undefined when map absent/unknown', () => {
        const entities = [
            { entity_id: 'light.ampoule_2', state: 'off', attributes: {} },
        ];

        // no map at all
        const noMap = haEntitiesToDevices(entities);
        expect(noMap[0].category).toBeUndefined();

        // map without this entity
        const unknown = haEntitiesToDevices(entities, new Map([['other', 'x']]));
        expect(unknown[0].category).toBeUndefined();
    });
});

describe('homeassistant climate mapping (MelCloud)', () => {
    test('climate power follows hvac_mode, not the raw state value', () => {
        const powerOf = (state: string) =>
            haStateToDeviceState({
                entity_id: 'climate.bureau',
                state,
                attributes: {},
            }).power;

        expect(powerOf('heat')).toBe('on');
        expect(powerOf('cool')).toBe('on');
        expect(powerOf('fan_only')).toBe('on');
        expect(powerOf('heat_cool')).toBe('on');
        expect(powerOf('off')).toBe('off');
        expect(powerOf('unavailable')).toBe('off');
        expect(powerOf('unknown')).toBe('off');
    });

    test('hvac_mode is derived from the entity state, never an attribute', () => {
        // The real MelCloud payload has no hvac_mode attribute at all.
        const { properties } = haStateToDeviceState({
            entity_id: 'climate.salon',
            state: 'fan_only',
            attributes: {
                temperature: 21.5,
                fan_mode: 'auto',
                fan_modes: ['auto', '1', '2', '3', '4'],
                hvac_modes: ['off', 'heat', 'cool', 'fan_only', 'heat_cool'],
            },
        });

        expect(properties.hvac_mode).toBe('fan_only');
        expect(properties.state).toBe('fan_only');

        // 'off' is a real mode; unavailable/unknown are not modes at all
        expect(
            haStateToDeviceState({ entity_id: 'climate.salon', state: 'off' })
                .properties.hvac_mode
        ).toBe('off');
        expect(
            haStateToDeviceState({
                entity_id: 'climate.salon',
                state: 'unavailable',
            }).properties.hvac_mode
        ).toBeUndefined();

        // a switch keeps its own semantics: no mode is invented for it
        expect(
            haStateToDeviceState({
                entity_id: 'switch.prise',
                state: 'on',
                attributes: {},
            }).properties.hvac_mode
        ).toBeUndefined();
    });

    test('climate mode values are HA-native (no translation layer)', () => {
        // the panel receives exactly what HA reports…
        const { properties } = haStateToDeviceState({
            entity_id: 'climate.bureau',
            state: 'fan_only',
            attributes: { hvac_mode: 'fan_only', fan_mode: 'auto' },
        });
        expect(properties.hvac_mode).toBe('fan_only');
        expect(properties.fan_mode).toBe('auto');

        // …and sends it back untouched
        expect(
            serviceCallFor('climate', 'hvac_mode', 'fan_only')
        ).toMatchObject({
            service: 'set_hvac_mode',
            data: { hvac_mode: 'fan_only' },
        });
        expect(
            serviceCallFor('climate', 'hvac_mode', 'heat_cool')
        ).toMatchObject({
            service: 'set_hvac_mode',
            data: { hvac_mode: 'heat_cool' },
        });
        expect(serviceCallFor('climate', 'hvac_mode', 'dry')).toMatchObject({
            service: 'set_hvac_mode',
            data: { hvac_mode: 'dry' },
        });
    });

    test('haDomainToControlProfile advertises the clim panel for climate', () => {
        expect(haDomainToControlProfile('climate')).toBe('clim');
        expect(haDomainToControlProfile('water_heater')).toBeUndefined();
        expect(haDomainToControlProfile('light')).toBeUndefined();
    });

    test('buildStateSchema reflects the entity capabilities', () => {
        const schema = buildStateSchema({
            domain: 'climate',
            attrs: melcloudClimate.attributes,
            services: melcloudServices,
            supportedFeatures: 937,
        });
        const byKey = Object.fromEntries(schema.map((f) => [f.key, f]));

        expect(schema.map((f) => f.key)).toEqual([
            'temperature',
            'hvac_mode',
            'fan_mode',
            'swing_mode',
            'swing_horizontal_mode',
            'current_temperature',
        ]);
        expect(byKey.temperature).toMatchObject({
            type: 'range',
            unit: '°C',
            min: 10,
            max: 31,
            step: 0.5,
        });
        // 'off' is the power state, never a mode chip
        expect(byKey.hvac_mode.options?.map((o) => o.value)).toEqual([
            'heat',
            'dry',
            'cool',
            'fan_only',
            'heat_cool',
        ]);
        expect(byKey.hvac_mode.options?.map((o) => o.label)).toEqual([
            'Chaud',
            'Déshumi.',
            'Froid',
            'Ventil.',
            'Auto',
        ]);
        expect(byKey.fan_mode.options?.map((o) => o.value)).toEqual([
            'auto',
            '1',
            '2',
            '3',
            '4',
        ]);
        expect(byKey.swing_mode.options).toHaveLength(7);
        expect(byKey.current_temperature).toMatchObject({
            type: 'number',
            readonly: true,
        });
        // the integration reports no action -> no readout is advertised
        expect(byKey.hvac_action).toBeUndefined();
    });

    test('buildStateSchema hides properties the catalogue gates out', () => {
        const schema = buildStateSchema({
            domain: 'climate',
            attrs: melcloudClimate.attributes,
            services: melcloudServices,
            supportedFeatures: 937,
        });
        const byKey = Object.fromEntries(schema.map((f) => [f.key, f]));

        // target_temp_high/low are gated by TARGET_TEMPERATURE_RANGE (bit 2),
        // which a MelCloud unit (937) doesn't advertise.
        expect(byKey.target_temp_high).toBeUndefined();
        expect(byKey.target_temp_low).toBeUndefined();
        expect(
            serviceCallFor('climate', 'target_temp_high', 24)
        ).toMatchObject({
            service: 'set_temperature',
            data: { target_temp_high: 24 },
        });

        // a plain heater (no fan/swing bits) loses those selectors
        const heater = buildStateSchema({
            domain: 'climate',
            attrs: melcloudClimate.attributes,
            services: melcloudServices,
            supportedFeatures: 1 | 128 | 256,
        });
        expect(heater.map((f) => f.key)).toEqual([
            'temperature',
            // hvac_mode isn't feature-gated in HA's catalogue → still offered
            'hvac_mode',
            'current_temperature',
        ]);
    });

    test('buildStateSchema keeps per-unit limits and defaults', () => {
        // climate.chambre_invite in the real install goes down to 10 °C and
        // exposes no fan modes at all.
        const schema = buildStateSchema({
            domain: 'climate',
            attrs: { min_temp: 10, max_temp: 31, hvac_modes: ['off', 'heat', 'cool'] },
        });
        const byKey = Object.fromEntries(schema.map((f) => [f.key, f]));

        expect(byKey.temperature).toMatchObject({ min: 10, max: 31 });
        expect(byKey.hvac_mode.options?.map((o) => o.value)).toEqual([
            'heat',
            'cool',
        ]);
        // no fan_modes reported → no fan selector invented
        expect(byKey.fan_mode).toBeUndefined();

        // no attributes at all → safe defaults for the primary control
        expect(buildStateSchema({ domain: 'climate', attrs: {} })[0]).toMatchObject(
            {
                key: 'temperature',
                min: 16,
                max: 30,
                step: 0.5,
            }
        );
    });

    test('buildFunctions derives from the catalogue and feature gates', () => {
        const functions = (features?: number) =>
            buildFunctions('climate', melcloudServices, features).map(
                (f) => f.name
            );

        // MelCloud (937) supports everything the catalogue declares…
        expect(functions(937)).toEqual([
            'climate.turn_on',
            'climate.turn_off',
            'climate.set_hvac_mode',
            'climate.set_temperature',
            'climate.set_fan_mode',
            'climate.set_swing_mode',
            'climate.set_swing_horizontal_mode',
        ]);
        // …but `climate.toggle` is blocklisted (duplicate of turn_on/off)
        expect(functions(937)).not.toContain('climate.toggle');

        // a plain heater (no fan/swing bits) only gets power + temperature
        expect(functions(1 | 128 | 256)).toEqual([
            'climate.turn_on',
            'climate.turn_off',
            'climate.set_hvac_mode',
            'climate.set_temperature',
        ]);

        // parameters are described from the service fields
        expect(
            buildFunctions('climate', melcloudServices, 937).find(
                (f) => f.name === 'climate.set_temperature'
            )?.params
        ).toMatchObject({ temperature: 'number 0..250' });
        expect(
            buildFunctions('climate', melcloudServices, 937).find(
                (f) => f.name === 'climate.set_fan_mode'
            )?.inputSchema
        ).toEqual([{ key: 'fan_mode', label: 'Fan Mode', type: 'string' }]);

        // …and option lists resolve from the entity attributes
        const selectSource = buildFunctions(
            'media_player',
            {
                media_player: {
                    select_source: { fields: { source: { selector: {} } } },
                },
            },
            2048,
            { source_list: ['HDMI 1', 'Netflix'] }
        )[0];
        expect(selectSource?.inputSchema).toEqual([
            {
                key: 'source',
                label: 'Source',
                type: 'string',
                options: [
                    { value: 'HDMI 1', label: 'HDMI 1' },
                    { value: 'Netflix', label: 'Netflix' },
                ],
            },
        ]);

        // no catalogue → nothing advertised; non-opted domains → nothing
        expect(buildFunctions('climate', undefined, 937)).toEqual([]);
        expect(
            buildFunctions('light', { light: { turn_on: {} } }, 1)
        ).toEqual([]);
        // missing `supported_features` → fail open (hide nothing)
        expect(functions(undefined)).toHaveLength(7);
    });
});

describe('homeassistant climate writes (write-through)', () => {
    /**
     * What MelCloud really reports: the mode is the entity state, and the cloud
     * round-trip means a re-read right after a write can still carry the OLD
     * value (HA debounces its refresh, then polls every 15 minutes).
     */
    const acEntity = {
        entity_id: 'climate.salon',
        state: 'fan_only',
        attributes: {
            temperature: 21.5,
            current_temperature: 20.9,
            fan_mode: 'auto',
            fan_modes: ['auto', '1', '2', '3', '4'],
            hvac_modes: ['off', 'heat', 'fan_only'],
            supported_features: 937,
        },
        last_changed: '2026-01-01T00:00:00Z',
    };

    test('the returned state carries what we sent, not the lagging read', async () => {
        // Both reads (before the write and right after it) report the old fan.
        getState.mockResolvedValueOnce(acEntity).mockResolvedValueOnce(acEntity);
        callService.mockClear();

        const res = (await apis.api.changeDeviceState!(
            { device: { externalId: 'climate.salon' } } as any,
            {
                power: 'on',
                // A panel echoes the whole properties bag back.
                properties: {
                    state: 'fan_only',
                    hvac_mode: 'fan_only',
                    fan_mode: '3',
                    temperature: 21.5,
                    current_temperature: 20.9,
                },
            }
        )) as any;

        expect(callService).toHaveBeenCalledWith('climate', 'set_fan_mode', {
            entity_id: 'climate.salon',
            fan_mode: '3',
        });
        // Equal values are not re-sent - including the mode, which only exists
        // because the provider derives it from the entity state.
        expect(callService).toHaveBeenCalledTimes(1);
        expect(res.properties.fan_mode).toBe('3');
        expect(res.properties.hvac_mode).toBe('fan_only');
        expect(res.power).toBe('on');
    });

    test('powering off returns the state the device is heading for', async () => {
        getState.mockResolvedValueOnce(acEntity);
        callService.mockClear();

        const res = (await apis.api.changeDeviceState!(
            { device: { externalId: 'climate.salon' } } as any,
            { power: 'off' }
        )) as any;

        expect(callService).toHaveBeenCalledWith('climate', 'turn_off', {
            entity_id: 'climate.salon',
        });
        expect(res.power).toBe('off');
        expect(res.properties.hvac_mode).toBe('off');
    });
});

describe('homeassistant property writes', () => {
    beforeEach(() => callService.mockClear());

    test('haPropertyToService maps canonical properties to HA services', () => {
        expect(haPropertyToService('climate', 'temperature', 22)).toEqual({
            domain: 'climate',
            service: 'set_temperature',
            data: { temperature: 22 },
        });
        expect(haPropertyToService('climate', 'hvac_mode', 'fan_only')).toEqual({
            domain: 'climate',
            service: 'set_hvac_mode',
            data: { hvac_mode: 'fan_only' },
        });
        expect(haPropertyToService('climate', 'hvac_mode', 'heat_cool')).toEqual({
            domain: 'climate',
            service: 'set_hvac_mode',
            data: { hvac_mode: 'heat_cool' },
        });
        expect(haPropertyToService('climate', 'fan_mode', '3')).toEqual({
            domain: 'climate',
            service: 'set_fan_mode',
            data: { fan_mode: '3' },
        });
        expect(haPropertyToService('climate', 'swing_mode', 'swing')).toEqual({
            domain: 'climate',
            service: 'set_swing_mode',
            data: { swing_mode: 'swing' },
        });
        expect(
            haPropertyToService('climate', 'swing_horizontal_mode', 'split')
        ).toEqual({
            domain: 'climate',
            service: 'set_swing_horizontal_mode',
            data: { swing_horizontal_mode: 'split' },
        });
        expect(haPropertyToService('climate', 'target_temp_high', 24)).toEqual({
            domain: 'climate',
            service: 'set_temperature',
            data: { target_temp_high: 24 },
        });
        // water heaters speak set_operation_mode and have no fan
        expect(
            haPropertyToService('water_heater', 'operation_mode', 'eco')
        ).toEqual({
            domain: 'water_heater',
            service: 'set_operation_mode',
            data: { operation_mode: 'eco' },
        });
        expect(
            haPropertyToService('water_heater', 'fan_mode', 'auto')
        ).toBeNull();
    });

    test('read-only and unknown keys never reach HA', () => {
        expect(
            haPropertyToService('climate', 'current_temperature', 21.4)
        ).toBeNull();
        expect(
            haPropertyToService('climate', 'hvac_action', 'heating')
        ).toBeNull();
        expect(haPropertyToService('climate', 'state', 'heat')).toBeNull();
        expect(haPropertyToService('climate', 'last_changed', 'now')).toBeNull();
        expect(
            haPropertyToService('climate', 'supported_features', 937)
        ).toBeNull();
        expect(haPropertyToService('light', 'level', 50)).toBeNull();
    });

    test('a panel echoing the whole props bag only writes what changed', async () => {
        const applied = await haApplyPropertyWrites(
            'climate',
            {
                // telemetry echoed back untouched…
                state: 'cool',
                last_changed: '2026-01-01T00:00:00Z',
                current_temperature: 21.4,
                hvac_action: 'cooling',
                supported_features: 937,
                // …next to the values the panel actually edits (canonical keys
                // ARE the HA attributes, so a panel sends one entry per field).
                temperature: 24,
                hvac_mode: 'cool',
                fan_mode: '2',
                swing_mode: 'auto',
            },
            { entity_id: 'climate.bureau' }
        );

        expect(applied).toEqual([
            'temperature',
            'hvac_mode',
            'fan_mode',
            'swing_mode',
        ]);
        expect(callService).toHaveBeenCalledTimes(4);
        expect(callService).toHaveBeenNthCalledWith(
            1,
            'climate',
            'set_temperature',
            { entity_id: 'climate.bureau', temperature: 24 }
        );
        expect(callService).toHaveBeenNthCalledWith(
            2,
            'climate',
            'set_hvac_mode',
            { entity_id: 'climate.bureau', hvac_mode: 'cool' }
        );
        expect(callService).toHaveBeenNthCalledWith(3, 'climate', 'set_fan_mode', {
            entity_id: 'climate.bureau',
            fan_mode: '2',
        });
        expect(
            callService
        ).toHaveBeenNthCalledWith(4, 'climate', 'set_swing_mode', {
            entity_id: 'climate.bureau',
            swing_mode: 'auto',
        });
    });

    test('a single writable field writes just that field', async () => {
        expect(
            await haApplyPropertyWrites('climate', { temperature: 23 })
        ).toEqual(['temperature']);
        expect(callService).toHaveBeenCalledWith('climate', 'set_temperature', {
            temperature: 23,
        });
    });

    test('no properties → no service call', async () => {
        expect(await haApplyPropertyWrites('climate', undefined)).toEqual([]);
        expect(callService).not.toHaveBeenCalled();
    });

    test('values already applied are skipped (no redundant HA calls)', async () => {
        const applied = await haApplyPropertyWrites(
            'climate',
            { temperature: 22, fan_mode: '2', hvac_mode: 'heat' },
            { entity_id: 'climate.bureau' },
            // what HA currently reports, in canonical form
            { temperature: 22, fan_mode: 'auto', hvac_mode: 'heat' }
        );

        expect(applied).toEqual(['fan_mode']);
        expect(callService).toHaveBeenCalledTimes(1);
        expect(callService).toHaveBeenCalledWith('climate', 'set_fan_mode', {
            entity_id: 'climate.bureau',
            fan_mode: '2',
        });
    });
});

describe('homeassistant sibling entities (one HA device, several entities)', () => {
    // A real Bravia: the `media_player` reports no TURN_ON, the `remote` sibling
    // of the same HA device owns the power services and the IRCC keypad.
    const bravia = {
        entity_id: 'media_player.bravia',
        state: 'playing',
        attributes: { friendly_name: 'Bravia', volume_level: 0.5 },
    };
    const braviaRegistry = {
        entity_id: 'media_player.bravia',
        platform: 'braviatv',
        device_id: 'dev-1',
        supported_features: 22845,
        capabilities: {},
    };
    const remoteSibling = {
        entity: { entity_id: 'remote.bravia', state: 'on', attributes: {} },
        registry: {
            entity_id: 'remote.bravia',
            platform: 'braviatv',
            device_id: 'dev-1',
            supported_features: 0,
        },
    };

    test('the sibling rule names domains only, never an integration', () => {
        // Any TV merges its `remote` sibling, whoever makes it: the decision is
        // the domain, not the integration that exposes it.
        expect(siblingDomainsFor('media_player')).toContain('remote');
        // Nothing to merge for a plain sensor/light → no registry round-trip.
        expect(siblingDomainsFor('sensor')).toEqual([]);
        expect(siblingDomainsFor('light')).toEqual([]);
    });

    test('function sources list the device first, then its siblings', () => {
        expect(
            haFunctionSources(bravia, braviaRegistry, [remoteSibling]).map(
                (source) => source.domain
            )
        ).toEqual(['media_player', 'remote']);
    });

    test('a function is routed to the entity that owns its domain', () => {
        expect(
            haCallTarget('remote.send_command', 'media_player.bravia', [
                remoteSibling,
            ])
        ).toBe('remote.bravia');
        expect(
            haCallTarget('media_player.volume_set', 'media_player.bravia', [
                remoteSibling,
            ])
        ).toBe('media_player.bravia');
        // unknown sibling domain → the device itself (HA reports the failure)
        expect(haCallTarget('button.press', 'media_player.bravia', [])).toBe(
            'media_player.bravia'
        );
    });

    test('power falls back to the sibling that can power the device', () => {
        // 22845 = TURN_OFF | SELECT_SOURCE | PLAY | PAUSE | … — no TURN_ON
        expect(canPower('media_player', 22845)).toBe(false);
        expect(canPower('media_player', 22845 + 128)).toBe(true);

        expect(
            haPowerTarget('media_player.bravia', 'media_player', 22845, [
                remoteSibling,
            ])
        ).toBe('remote.bravia');
        // able to power itself → its own entity, sibling around or not
        expect(
            haPowerTarget('media_player.bravia', 'media_player', 22845 + 128, [
                remoteSibling,
            ])
        ).toBe('media_player.bravia');
        // nothing to fall back on → its own entity
        expect(
            haPowerTarget('media_player.bravia', 'media_player', 22845, [])
        ).toBe('media_player.bravia');
        // domains HA doesn't gate always power themselves
        expect(haPowerTarget('light.hall', 'light', 0, [])).toBe('light.hall');
    });

    test('the catalogue gate wins over the raw bit test', () => {
        const services = {
            media_player: {
                turn_on: {
                    target: {
                        entity: {
                            supported_features: [
                                'media_player.MediaPlayerEntityFeature.TURN_ON',
                            ],
                        },
                    },
                },
            },
        };

        expect(canPower('media_player', 0, services)).toBe(false);
        expect(canPower('media_player', 128, services)).toBe(true);
    });

    test('haSiblings keeps only same-device entities of wanted domains', async () => {
        getEntityRegistry.mockResolvedValueOnce([
            braviaRegistry,
            remoteSibling.registry,
            { entity_id: 'button.bravia_restart', device_id: 'dev-1' },
            { entity_id: 'remote.other_tv', device_id: 'dev-2' },
        ]);
        getStates.mockResolvedValueOnce([
            { entity_id: 'remote.bravia', state: 'on', attributes: { x: 1 } },
        ]);

        const siblings = await haSiblings(
            'media_player.bravia',
            braviaRegistry,
            ['remote']
        );

        expect(siblings.map((sibling) => sibling.entity.entity_id)).toEqual([
            'remote.bravia',
        ]);
        expect(siblings[0].entity.attributes).toEqual({ x: 1 });

        // no domain to merge → no registry/state round-trip at all
        getEntityRegistry.mockClear();
        expect(
            await haSiblings('media_player.bravia', braviaRegistry, [])
        ).toEqual([]);
        expect(getEntityRegistry).not.toHaveBeenCalled();
    });

    test('sibling capabilities merge into the device', () => {
        const capabilities = haEntityCapabilities(
            bravia,
            braviaRegistry,
            {
                media_player: {
                    volume_set: {},
                    turn_on: {
                        target: {
                            entity: {
                                supported_features: [
                                    'media_player.MediaPlayerEntityFeature.TURN_ON',
                                ],
                            },
                        },
                    },
                },
                remote: {
                    send_command: {
                        fields: { command: { selector: { text: {} } } },
                    },
                },
            },
            [remoteSibling]
        );

        // media_player.turn_on is gated away (no TURN_ON bit): the sibling's
        // services join the list under their own domain instead.
        expect(capabilities.functions?.map((fn) => fn.name)).toEqual([
            'media_player.volume_set',
            'remote.send_command',
        ]);
        expect(
            capabilities.functions
                ?.find((fn) => fn.name === 'remote.send_command')
                ?.inputSchema?.find((field) => field.key === 'command')?.options
        ).toBeUndefined();
    });

    test('a sibling in a non-function domain contributes nothing', () => {
        const capabilities = haEntityCapabilities(
            bravia,
            braviaRegistry,
            { sensor: {} },
            [
                {
                    entity: { entity_id: 'sensor.bravia_temp', attributes: {} },
                    registry: { entity_id: 'sensor.bravia_temp' } as any,
                },
            ]
        );

        expect(capabilities.functions).toBeUndefined();
    });

    test('callFunction sends a sibling function to the sibling entity', async () => {
        getRegistryEntry.mockResolvedValueOnce(braviaRegistry);
        getEntityRegistry.mockResolvedValueOnce([
            braviaRegistry,
            remoteSibling.registry,
        ]);
        getStates.mockResolvedValueOnce([remoteSibling.entity]);
        callService.mockClear();

        await apis.api.callFunction!(
            { device: { externalId: 'media_player.bravia' } } as any,
            { name: 'remote.send_command', params: { command: 'Up' } }
        );

        expect(callService).toHaveBeenCalledWith('remote', 'send_command', {
            entity_id: 'remote.bravia',
            command: 'Up',
        });
    });

    test('changeDeviceState powers the TV through its remote sibling', async () => {
        getRegistryEntry.mockResolvedValueOnce(braviaRegistry);
        getEntityRegistry.mockResolvedValueOnce([
            braviaRegistry,
            remoteSibling.registry,
        ]);
        getStates.mockResolvedValueOnce([remoteSibling.entity]);
        callService.mockClear();

        await apis.api.changeDeviceState!(
            { device: { externalId: 'media_player.bravia' } } as any,
            { power: 'on' }
        );

        expect(callService).toHaveBeenCalledWith('remote', 'turn_on', {
            entity_id: 'remote.bravia',
        });
    });

    test('changeDeviceState keeps volume on the media_player itself', async () => {
        callService.mockClear();

        await apis.api.changeDeviceState!(
            { device: { externalId: 'media_player.bravia' } } as any,
            { power: 'on', level: 40 }
        );

        expect(callService).toHaveBeenCalledWith('media_player', 'volume_set', {
            entity_id: 'media_player.bravia',
            volume_level: 0.4,
        });
    });

    test('changeDeviceState never turns a climate level into a setpoint', async () => {
        // For climate / water_heater `level` is the AMBIENT reading
        // (`current_temperature`): writing it must not set the room temperature
        // as the target. The setpoint is `properties.temperature`.
        callService.mockClear();
        getState.mockResolvedValue(melcloudClimate);

        const state = await apis.api.changeDeviceState!(
            { device: { externalId: 'climate.bureau' } } as any,
            { power: 'on', level: 21.4 }
        );

        const services = callService.mock.calls.map(
            ([domain, service]: any[]) => `${domain}.${service}`
        );
        expect(services).not.toContain('climate.set_temperature');
        expect(services).not.toContain('climate.turn_on');
        // the ambient reading is still published on the returned state
        expect((state as any)?.level).toBe(21.4);

        getState.mockResolvedValue(null);
    });
});

describe('homeassistant water_heater', () => {
    test('operation_mode is canonical, derived from the entity state', () => {
        const state = haStateToDeviceState({
            entity_id: 'water_heater.ballon',
            state: 'eco',
            attributes: {
                temperature: 55,
                current_temperature: 50,
                min_temp: 40,
                max_temp: 60,
                target_temp_step: 1,
                // HA publishes the LIST as `operation_list`; the current mode is
                // the entity state, never an attribute.
                operation_list: ['eco', 'performance', 'off'],
            },
        });

        // the domain's own vocabulary is the canonical one
        expect(state.power).toBe('on');
        expect(state.properties).toMatchObject({
            operation_mode: 'eco',
            temperature: 55,
        });
        expect(state.properties?.hvac_mode).toBeUndefined();

        // its schema swaps the mode property (and has no fan/swing)
        const schema = buildStateSchema({
            domain: 'water_heater',
            attrs: {
                temperature: 55,
                operation_mode: 'eco',
                operation_list: ['eco', 'performance', 'off'],
            },
        });
        expect(schema.map((f) => f.key)).toEqual([
            'temperature',
            'operation_mode',
            'current_temperature',
        ]);
        expect(
            schema
                .find((f) => f.key === 'operation_mode')
                ?.options?.map((o) => o.value)
        ).toEqual(['eco', 'performance']);

        // a readout the gateway does not report is not advertised at all
        expect(schema.some((f) => f.key === 'hvac_action')).toBe(false);

        // writes go to set_operation_mode (no fan on water heaters)
        expect(
            haPropertyToService('water_heater', 'operation_mode', 'eco')
        ).toEqual({
            domain: 'water_heater',
            service: 'set_operation_mode',
            data: { operation_mode: 'eco' },
        });
    });
});

describe('homeassistant level gating (gateway evidence only)', () => {
    test('a dimmable light advertises level, an on/off-only bulb does not', () => {
        const dimmable = buildStateSchema({
            domain: 'light',
            attrs: {
                supported_color_modes: ['brightness'],
                supported_features: 32,
            },
        });
        expect(dimmable.map((f) => f.key)).toEqual(['level']);

        // HA documents `onoff` as the colour mode of a bulb that can only
        // switch: it reports no brightness, so no slider is invented.
        const onOff = buildStateSchema({
            domain: 'light',
            attrs: { supported_color_modes: ['onoff'], supported_features: 0 },
        });
        expect(onOff).toEqual([]);
    });

    test('a cover advertises level only with SET_POSITION or a position', () => {
        const withPosition = buildStateSchema({
            domain: 'cover',
            attrs: { current_position: 40 },
            supportedFeatures: 1 | 2, // OPEN | CLOSE
        });
        expect(withPosition.map((f) => f.key)).toEqual(['level']);

        const gated = buildStateSchema({
            domain: 'cover',
            attrs: { device_class: 'shutter' },
            supportedFeatures: 1 | 2,
        });
        expect(gated).toEqual([]);
    });

    test('a media player without VOLUME_SET keeps the step services only', () => {
        const services = {
            media_player: {
                volume_up: {},
                volume_down: {},
            },
        };
        const capabilities = haEntityCapabilities(
            {
                entity_id: 'media_player.salon',
                state: 'on',
                attributes: { friendly_name: 'Salon' },
            },
            {
                entity_id: 'media_player.salon',
                platform: 'homeassistant',
                device_id: 'device-1',
                // VOLUME_STEP only: the gateway has no absolute volume.
                supported_features: 1024,
                capabilities: {},
            } as any,
            services
        );

        expect(capabilities.state?.map((f) => f.key)).toEqual([]);
        expect((capabilities.functions ?? []).map((f) => f.name)).toEqual([
            'media_player.volume_up',
            'media_player.volume_down',
        ]);
    });

    test('missing metadata fails open (never hides a capability)', () => {
        expect(buildStateSchema({ domain: 'light' }).map((f) => f.key)).toEqual([
            'level',
        ]);
        expect(
            buildStateSchema({ domain: 'media_player', attrs: {} }).map(
                (f) => f.key
            )
        ).toEqual(['level']);
    });
});

describe('homeassistant measurement semantics (sensor / binary_sensor)', () => {
    test('a sensor publishes its reading under the device_class', () => {
        const state = haStateToDeviceState({
            entity_id: 'sensor.salon_room_temperature',
            state: '24.5',
            attributes: {
                device_class: 'temperature',
                unit_of_measurement: '°C',
                state_class: 'measurement',
            },
        });
        const properties = state.properties ?? {};

        expect(properties).toMatchObject({
            temperature: 24.5,
            state: '24.5',
            unit_of_measurement: '°C',
            device_class: 'temperature',
        });
        // numbers stay numbers: a panel prints `24.5 °C`, not a string
        expect(typeof properties.temperature).toBe('number');
    });

    test('a binary sensor publishes a boolean under its class', () => {
        const state = haStateToDeviceState({
            entity_id: 'binary_sensor.entree',
            state: 'on',
            attributes: { device_class: 'motion' },
        });

        expect(state.properties?.motion).toBe(true);
        expect(state.properties?.state).toBe('on');
    });

    test('an unavailable sensor reports no fake reading', () => {
        const state = haStateToDeviceState({
            entity_id: 'sensor.tradfri_remote_control_battery',
            state: 'unavailable',
            attributes: { device_class: 'battery', unit_of_measurement: '%' },
        });

        expect(state.properties?.battery).toBeUndefined();
        expect(state.properties?.state).toBe('unavailable');
    });

    test('a non-measurement domain keeps its attribute names', () => {
        const state = haStateToDeviceState({
            entity_id: 'switch.shelly',
            state: 'on',
            attributes: { device_class: 'outlet' },
        });

        expect(state.properties?.device_class).toBe('outlet');
        expect(state.properties?.outlet).toBeUndefined();
    });
});

describe('homeassistant swing values (gateway vocabulary)', () => {
    test('documented values are labelled, private ones pass through', () => {
        const schema = buildStateSchema({
            domain: 'climate',
            attrs: { swing_modes: ['auto', '1_up', '5_down'] },
            supportedFeatures: 32, // SWING_MODE
        });
        const swing = schema.find((f) => f.key === 'swing_mode');

        expect(swing?.options).toEqual([
            { value: 'auto', label: 'Auto' },
            { value: '1_up', label: '1_up' },
            { value: '5_down', label: '5_down' },
        ]);
    });
});

