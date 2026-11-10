/**
 * Action-level tests for the NLU "nuance" partial move: "ferme un peu le volet"
 * must move the shutter BY a signed level change instead of closing it fully,
 * while a device with no writable level keeps the plain full move.
 *
 * Everything heavy is mocked: no Mongo, no provider registry.
 */
jest.mock('../../../core/db', () => {
    const devices: any[] = [];
    const rooms: any[] = [];
    const match = (row: any, query: any): boolean =>
        Object.entries(query ?? {}).every(([key, value]: [string, any]) => {
            if (value && typeof value === 'object' && '$in' in value) {
                return value.$in.includes(row[key]);
            }
            return row[key] === value;
        });
    const cursor = (rows: any[]) => ({ toArray: async () => rows });
    return {
        __state: { devices, rooms },
        cs: {
            devices: {
                find: (query: any) =>
                    cursor(devices.filter((d) => match(d, query))),
                findOne: async (query: any) =>
                    devices.find((d) => d._id === query._id) ?? null,
            },
            rooms: { find: () => cursor(rooms) },
        },
    };
});

jest.mock('../../../manager/services/activities', () => ({ log: jest.fn() }));
jest.mock('../../../ai/memory', () => ({ setActiveDevice: jest.fn() }));
jest.mock('../../../devices', () => ({
    changeDeviceState: jest.fn(),
    getDeviceCapabilities: jest.fn(),
    getDeviceState: jest.fn(),
}));

import tools from './devices';
import {
    changeDeviceState,
    getDeviceCapabilities,
    getDeviceState,
} from '../../../devices';

const store = (jest.requireMock('../../../core/db') as any).__state;
const change = changeDeviceState as unknown as jest.Mock;
const capabilities = getDeviceCapabilities as unknown as jest.Mock;
const state = getDeviceState as unknown as jest.Mock;

const SHUTTER = {
    _id: 's1',
    name: 'Le volet',
    type: 'shutter',
    provider: 'p1',
    externalId: 'cover.volet',
    state: { power: 'on', level: 60 },
};
const GATE = {
    _id: 'g1',
    name: 'Portail',
    type: 'button',
    provider: 'p2',
    externalId: 'gate.1',
    state: { power: 'off' },
};

describe('device actions — nuance partial move', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store.devices.length = 0;
        store.rooms.length = 0;
        store.devices.push({ ...SHUTTER }, { ...GATE });
        capabilities.mockResolvedValue({ state: [{ key: 'level' }] });
        state.mockResolvedValue({ power: 'on', level: 60 });
        change.mockResolvedValue(true);
    });

    test('closes a shutter "un peu": signed -10 on the current level', async () => {
        await tools.closeDevice.exec({
            freeText: 'un peu le volet',
            slots: { nuance: 'slightly', deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'off', level: 50 });
    });

    test('opens a shutter "un peu": signed +10 on the current level', async () => {
        await tools.openDevice.exec({
            freeText: 'un peu le volet',
            slots: { nuance: 'slightly', deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'on', level: 70 });
    });

    test('"beaucoup" moves by the bigger step', async () => {
        await tools.closeDevice.exec({
            freeText: 'beaucoup le volet',
            slots: { nuance: 'strongly', deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'off', level: 20 });
    });

    test('the resulting level is clamped to 0..100', async () => {
        state.mockResolvedValue({ power: 'on', level: 95 });
        await tools.openDevice.exec({
            freeText: 'beaucoup le volet',
            slots: { nuance: 'strongly', deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'on', level: 100 });
    });

    test('a device without a writable level keeps the plain full move', async () => {
        capabilities.mockResolvedValue({ state: [] });
        await tools.closeDevice.exec({
            freeText: 'un peu le volet',
            slots: { nuance: 'slightly', deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'off' });
    });

    test('an unknown current level keeps the plain full move', async () => {
        state.mockResolvedValue({ power: 'on' });
        await tools.closeDevice.exec({
            freeText: 'un peu le volet',
            slots: { nuance: 'slightly', deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'off' });
    });

    test('any device with a writable level moves partially (not only shutters)', async () => {
        // The gate advertises a writable `level` (see beforeEach), so a nuance
        // applies to it too — the partial move is capability-driven, never
        // restricted to a device type.
        await tools.closeDevice.exec({
            freeText: 'un peu le portail',
            slots: { nuance: 'slightly', deviceId: 'g1' },
        });
        expect(change).toHaveBeenCalledWith('g1', { power: 'off', level: 50 });
    });

    test('without a nuance, even a shutter moves fully (regression)', async () => {
        await tools.closeDevice.exec({
            freeText: 'le volet',
            slots: { deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'off' });
    });
});

/**
 * The numeric control is DISCOVERED from the device's capabilities, never
 * hardcoded: `level` for a slider domain, the canonical setpoint (`temperature`)
 * for a climate device. These tests pin that the action writes whichever key the
 * schema advertises, clamps to its range, and falls back to `level` when the
 * schema carries no writable field (a telemetry-only custom device).
 */
describe('device actions — capability-driven numeric control', () => {
    const THERMOSTAT = {
        _id: 't1',
        name: 'La clim',
        type: 'thermostat',
        provider: 'p3',
        externalId: 'climate.salon',
        state: { power: 'on', level: 20.9, properties: { temperature: 21.5 } },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        store.devices.length = 0;
        store.rooms.length = 0;
        store.devices.push({ ...THERMOSTAT });
        change.mockResolvedValue(true);
    });

    test('temperature drives the first writable field (the setpoint)', async () => {
        capabilities.mockResolvedValue({
            state: [
                {
                    key: 'temperature',
                    type: 'range',
                    min: 10,
                    max: 31,
                    step: 0.5,
                    unit: '°C',
                },
                { key: 'current_temperature', type: 'number', readonly: true },
            ],
        });
        state.mockResolvedValue({
            power: 'on',
            level: 20.9,
            properties: { temperature: 21.5 },
        });

        await tools.setTemperature.exec({
            freeText: 'mets la clim à 22',
            slots: { deviceId: 't1', number: '22' },
        });

        expect(change).toHaveBeenCalledWith('t1', {
            properties: { temperature: 22 },
        });
    });

    test('clamps to the advertised range (and rounds to its step)', async () => {
        capabilities.mockResolvedValue({
            state: [
                {
                    key: 'temperature',
                    type: 'range',
                    min: 10,
                    max: 31,
                    step: 0.5,
                    unit: '°C',
                },
            ],
        });
        state.mockResolvedValue({
            power: 'on',
            properties: { temperature: 21.5 },
        });

        await tools.setTemperature.exec({
            freeText: 'mets la clim à 40',
            slots: { deviceId: 't1', number: '40' },
        });

        expect(change).toHaveBeenCalledWith('t1', {
            properties: { temperature: 31 },
        });
    });

    test('temperatureUp reads the setpoint, not the ambient level', async () => {
        capabilities.mockResolvedValue({
            state: [
                {
                    key: 'temperature',
                    type: 'range',
                    min: 10,
                    max: 31,
                    step: 0.5,
                    unit: '°C',
                },
            ],
        });
        state.mockResolvedValue({
            power: 'on',
            level: 20.9,
            properties: { temperature: 21.5 },
        });

        await tools.temperatureUp.exec({
            freeText: 'monte la clim',
            slots: { deviceId: 't1' },
        });

        expect(change).toHaveBeenCalledWith('t1', {
            properties: { temperature: 22.5 },
        });
    });

    test('a slider domain keeps writing level', async () => {
        store.devices.push({
            _id: 'l1',
            name: 'La lampe',
            type: 'light',
            provider: 'p4',
            externalId: 'light.lampe',
        });
        capabilities.mockResolvedValue({
            state: [
                {
                    key: 'level',
                    type: 'range',
                    min: 0,
                    max: 100,
                    step: 1,
                    unit: '%',
                },
            ],
        });
        state.mockResolvedValue({ power: 'on', level: 30 });

        await tools.setBrightness.exec({
            freeText: 'mets la lampe à 50',
            slots: { deviceId: 'l1', number: '50' },
        });

        expect(change).toHaveBeenCalledWith('l1', { level: 50 });
    });

    test('no writable field falls back to the level convention', async () => {
        store.devices.push({
            _id: 'c1',
            name: 'Capteur',
            type: 'sensor',
            provider: 'p5',
            externalId: 'sensor.x',
        });
        capabilities.mockResolvedValue({
            state: [{ key: 'level', type: 'number', readonly: true }],
        });
        state.mockResolvedValue({ power: 'on', level: 42 });

        await tools.setBrightness.exec({
            freeText: 'mets à 50',
            slots: { deviceId: 'c1', number: '50' },
        });

        expect(change).toHaveBeenCalledWith('c1', { level: 50 });
    });
});
