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

    test('a non-shutter (toggle-only gate) keeps the plain full move', async () => {
        await tools.closeDevice.exec({
            freeText: 'un peu le portail',
            slots: { nuance: 'slightly', deviceId: 'g1' },
        });
        expect(change).toHaveBeenCalledWith('g1', { power: 'off' });
    });

    test('without a nuance, even a shutter moves fully (regression)', async () => {
        await tools.closeDevice.exec({
            freeText: 'le volet',
            slots: { deviceId: 's1' },
        });
        expect(change).toHaveBeenCalledWith('s1', { power: 'off' });
    });
});
