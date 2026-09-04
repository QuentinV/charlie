import {
    haDomainToDeviceType,
    haEntitiesToDevices,
    haStateToDeviceState,
} from '../homeassistant';

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
                state: 'on',
                attributes: { brightness: 128 },
            }).level
        ).toBe(50);
        expect(
            haStateToDeviceState({
                state: 'on',
                attributes: { brightness_pct: 42 },
            }).level
        ).toBe(42);
    });

    test('haStateToDeviceState maps cover/fan/volume levels', () => {
        expect(
            haStateToDeviceState({
                state: 'open',
                attributes: { current_position: 70 },
            }).level
        ).toBe(70);
        expect(
            haStateToDeviceState({
                state: 'on',
                attributes: { percentage: 30 },
            }).level
        ).toBe(30);
        expect(
            haStateToDeviceState({
                state: 'playing',
                attributes: { volume_level: 0.5 },
            }).level
        ).toBe(50);
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
