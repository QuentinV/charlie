/**
 * `changeDeviceState` is the one place that knows a device was just changed, so
 * it is the one that must feed the state bus (automations, the house graph's
 * observed effects, the history). These tests pin that contract: announce on a
 * real change, never on a refusal, a provider failure, or a "write" that
 * reported nothing.
 *
 * Everything heavy is mocked: no Mongo, no MQTT/bonjour/COAP provider registry.
 */
jest.mock('../../core/db', () => {
    const state: { devices: any[]; providers: any[] } = {
        devices: [],
        providers: [],
    };
    return {
        __state: state,
        cs: {
            devices: {
                findOne: async (query: any) =>
                    state.devices.find((d) => d._id === query._id) ?? null,
                updateOne: jest.fn(async (query: any, patch: any) => {
                    const doc = state.devices.find((d) => d._id === query._id);
                    if (doc && patch?.$set) Object.assign(doc, patch.$set);
                    return { modifiedCount: doc ? 1 : 0 };
                }),
            },
            providers: {
                findOne: async (query: any) =>
                    state.providers.find((p) => p._id === query._id) ?? null,
            },
            plugins: { find: () => ({ toArray: async () => [] }) },
        },
    };
});

jest.mock('../../manager/services/activities', () => ({ log: jest.fn() }));

// The bus hook itself is not under test here: assert that it is (or is not)
// reached, with real history/`states` writes mocked away.
jest.mock('../history', () => ({ logDeviceState: jest.fn() }));

jest.mock('../providers/plugin', () => ({ createPlugin: jest.fn() }));

jest.mock('../providers', () => {
    const api = {
        changeDeviceState: jest.fn(),
        getDeviceState: jest.fn(),
    };
    return { __esModule: true, default: { fake: { api } } };
});

import { changeDeviceState } from '../index';
import { cs } from '../../core/db';
import { logDeviceState } from '../history';
import providers from '../providers';

const api = (providers as any).fake.api;
const store = (jest.requireMock('../../core/db') as any).__state;
const updateOne = cs.devices.updateOne as unknown as jest.Mock;
const emit = logDeviceState as unknown as jest.Mock;

describe('changeDeviceState → state bus', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store.devices.length = 0;
        store.providers.length = 0;
        store.devices.push({
            _id: 'd1',
            name: 'Prise',
            type: 'light',
            provider: 'p1',
            externalId: 'switch.prise',
            state: { power: 'off' },
        });
        store.providers.push({ _id: 'p1', codesource: 'fake' });
    });

    it('announces the transition after the state is stored (provider → true)', async () => {
        api.changeDeviceState.mockResolvedValue(true);
        api.getDeviceState.mockResolvedValue({ power: 'on', level: 80 });

        const res = await changeDeviceState('d1', { power: 'on' });

        expect(res).toEqual({ power: 'on', level: 80 });
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith({ deviceId: 'd1' });
        // The emit MUST come after the write, or the bus would broadcast the
        // state the device had before the action.
        expect(emit.mock.invocationCallOrder[0]).toBeGreaterThan(
            updateOne.mock.invocationCallOrder[0]
        );
    });

    it('announces when the provider returned the write-through state', async () => {
        api.changeDeviceState.mockResolvedValue({ power: 'on' });

        const res = await changeDeviceState('d1', { power: 'on' });

        expect(res).toEqual({ power: 'on' });
        expect(updateOne).toHaveBeenCalledWith(
            { _id: 'd1' },
            { $set: { state: { power: 'on' } } }
        );
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.invocationCallOrder[0]).toBeGreaterThan(
            updateOne.mock.invocationCallOrder[0]
        );
    });

    it('inverts the stored state when toggling, and still announces it', async () => {
        api.getDeviceState.mockResolvedValue({ power: 'on' });
        api.changeDeviceState.mockResolvedValue(true);

        await changeDeviceState('d1');

        expect(api.changeDeviceState).toHaveBeenCalledWith(
            expect.objectContaining({ device: expect.anything() }),
            { power: 'off' }
        );
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('never announces a refusal', async () => {
        api.changeDeviceState.mockResolvedValue(false);

        await expect(changeDeviceState('d1', { power: 'on' })).resolves.toBe(
            false
        );
        expect(emit).not.toHaveBeenCalled();
        expect(updateOne).not.toHaveBeenCalled();
    });

    it('never announces a provider failure', async () => {
        api.changeDeviceState.mockRejectedValue(new Error('boom'));

        await expect(changeDeviceState('d1', { power: 'on' })).resolves.toBe(
            false
        );
        expect(emit).not.toHaveBeenCalled();
    });

    it('never announces a provider that reported no state at all', async () => {
        api.changeDeviceState.mockResolvedValue(undefined);

        await expect(
            changeDeviceState('d1', { power: 'on' })
        ).resolves.toBeUndefined();
        expect(emit).not.toHaveBeenCalled();
    });
});
