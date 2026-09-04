import { haDomainToDeviceType, haStateToDeviceState } from '../home_assistant';

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
});