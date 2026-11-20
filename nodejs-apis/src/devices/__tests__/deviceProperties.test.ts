/**
 * The durable device property bag (`Device.properties`): the generic storage
 * path plus the per-device-type catalogue.
 *
 * What is pinned here — the rules a device property must obey:
 * - the write is a **dotted** `$set` per key (the bag is shared, so a sibling
 *   property must survive) and only flat scalars are stored;
 * - the **device type** canonicalizes the patch before it is stored (a camera
 *   re-serializes its vision modes: an unknown id can never be persisted);
 * - the type's rows are merged into the capabilities **whatever the provider
 *   declared** — including a provider that declares nothing at all, which is
 *   what makes an HA camera (a shared provider row) behave like a camera-provider
 *   one;
 * - a provider that keeps its properties elsewhere overrides the storage;
 * - a provider row whose codesource has no module no longer fails the route: the
 *   type panel keeps working (this used to be a TypeError outside the try in
 *   `call()`, i.e. a 500 on the whole device page).
 *
 * The provider registry is replaced, so the hooks can be asserted without a real
 * provider; Mongo is an in-memory stub that honours dotted paths.
 */
jest.mock('../../core/db', () => {
    const state: { devices: any[]; providers: any[] } = {
        devices: [],
        providers: [],
    };
    /** Mongo's `$set` nests a dotted path (`properties.visionModes`). */
    const setPath = (doc: any, path: string, value: any) => {
        const parts = path.split('.');
        const last = parts.pop() as string;
        const node = parts.reduce((acc: any, part) => {
            acc[part] = acc[part] ?? {};
            return acc[part];
        }, doc);
        node[last] = value;
    };
    return {
        __state: state,
        cs: {
            devices: {
                findOne: async (query: any) =>
                    state.devices.find((d) => d._id === query._id) ?? null,
                updateOne: jest.fn(async (query: any, patch: any) => {
                    const doc = state.devices.find((d) => d._id === query._id);
                    if (doc && patch?.$set) {
                        for (const [path, value] of Object.entries(
                            patch.$set
                        )) {
                            setPath(doc, path, value);
                        }
                    }
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
jest.mock('../providers/plugin', () => ({ createPlugin: jest.fn() }));

// Three provider shapes: `plain` declares capabilities, `bare` declares nothing
// at all (the HA-camera case), `fake` keeps its property bag elsewhere (the
// override point of `getDeviceProperties`/`changeDeviceProperties`).
jest.mock('../providers', () => {
    const bag: Record<string, any> = {};
    return {
        __esModule: true,
        default: {
            plain: {
                api: {
                    getCapabilities: jest.fn(async () => ({
                        state: [
                            { key: 'level', label: 'Niveau', type: 'number' },
                        ],
                        functions: [],
                    })),
                },
            },
            bare: { api: {} },
            fake: {
                api: {
                    getDeviceProperties: jest.fn(async () => ({ ...bag })),
                    changeDeviceProperties: jest.fn(
                        async (_meta: any, patch: any) => {
                            Object.assign(bag, patch);
                            return { ...bag };
                        }
                    ),
                },
            },
        },
    };
});

import {
    changeDeviceProperties,
    getDeviceCapabilities,
    getDeviceProperties,
} from '../index';
import { cs } from '../../core/db';
import providers from '../providers';

const store = (jest.requireMock('../../core/db') as any).__state;
const updateOne = cs.devices.updateOne as unknown as jest.Mock;
const fake = (providers as any).fake.api;

/** One device under one provider row. */
const seed = (
    over: any = {},
    provider: any = { _id: 'p1', codesource: 'plain' }
) => {
    store.devices.push({
        _id: 'd1',
        name: 'Caméra',
        type: 'camera',
        provider: provider._id,
        externalId: 'cam-1',
        ...over,
    });
    store.providers.push(provider);
};

beforeEach(() => {
    jest.clearAllMocks();
    store.devices.length = 0;
    store.providers.length = 0;
});


describe('changeDeviceProperties (the generic bag)', () => {
    it('writes one dotted $set per key and keeps a sibling property', async () => {
        seed({ properties: { visionModes: 'presence', sensitivity: 0.6 } });

        const bag = await changeDeviceProperties('d1', { visionModes: 'pet' });

        // Dotted: a whole-bag `$set` would silently drop `sensitivity`.
        expect(updateOne).toHaveBeenCalledWith(
            { _id: 'd1' },
            { $set: { 'properties.visionModes': 'pet' } }
        );
        expect(bag).toEqual({ visionModes: 'pet', sensitivity: 0.6 });
        expect(store.devices[0].properties).toEqual({
            visionModes: 'pet',
            sensitivity: 0.6,
        });
    });

    it('canonicalizes the type own key (unknown id dropped, table order)', async () => {
        seed({ properties: { visionModes: 'presence' } });

        const bag = await changeDeviceProperties('d1', {
            visionModes: 'nope,grocery,off,presence',
        });

        expect(bag.visionModes).toBe('presence,grocery');
    });

    it('stores an emptied selection (that is the off state)', async () => {
        seed({ properties: { visionModes: 'presence' } });

        const bag = await changeDeviceProperties('d1', { visionModes: '' });

        expect(bag.visionModes).toBe('');
        expect(updateOne).toHaveBeenCalledWith(
            { _id: 'd1' },
            { $set: { 'properties.visionModes': '' } }
        );
    });

    it('drops what the bag cannot hold (arrays and objects)', async () => {
        seed();

        const bag = await changeDeviceProperties('d1', {
            visionModes: 'pet',
            nested: { a: 1 } as any,
            list: [1, 2] as any,
        });

        expect(bag).toEqual({ visionModes: 'pet' });
    });

    it('reads the bag back', async () => {
        seed({ properties: { visionModes: 'entrance', zoom: 3 } });

        expect(await getDeviceProperties('d1')).toEqual({
            visionModes: 'entrance',
            zoom: 3,
        });
    });

    it('delegates to a provider that keeps its properties elsewhere', async () => {
        seed(
            { provider: 'pf', type: 'light' },
            { _id: 'pf', codesource: 'fake' }
        );

        const bag = await changeDeviceProperties('d1', { armed: true });

        expect(fake.changeDeviceProperties).toHaveBeenCalledWith(
            expect.objectContaining({ device: expect.anything() }),
            { armed: true }
        );
        // The generic bag is not touched when the provider owns the storage.
        expect(updateOne).not.toHaveBeenCalled();
        expect(bag).toEqual({ armed: true });
        expect(await getDeviceProperties('d1')).toEqual({ armed: true });
        expect(fake.getDeviceProperties).toHaveBeenCalled();
    });
});


describe('getDeviceCapabilities (the type catalogue)', () => {
    it('appends the type rows to what the provider declared', async () => {
        seed({ _id: 'd-plain' });

        const caps = await getDeviceCapabilities('d-plain');

        expect(caps?.state?.map((field) => field.key)).toEqual([
            'level',
            'visionModes',
        ]);
    });

    it('adds them even when the provider declares nothing (an HA camera)', async () => {
        // The `homeassistant` provider knows nothing about vision modes: its row
        // is shared with every other HA device, which is exactly why the row
        // cannot live in the `camera` provider.
        seed(
            { _id: 'd-bare', provider: 'pb' },
            { _id: 'pb', codesource: 'bare' }
        );

        const caps = await getDeviceCapabilities('d-bare');

        expect(caps?.state?.map((field) => field.key)).toEqual(['visionModes']);
    });

    it('leaves a type with no profile exactly as the provider declared it', async () => {
        seed({ _id: 'd-light', type: 'light' });

        const caps = await getDeviceCapabilities('d-light');

        expect(caps?.state?.map((field) => field.key)).toEqual(['level']);
    });

    it('still answers for a provider row whose codesource has no module', async () => {
        // A hand-written row with a typo used to throw a TypeError outside the
        // try in `call()` — a 500 on `/capabilities`, `/state` and the whole
        // device page.
        seed(
            { _id: 'd-typo', provider: 'px' },
            { _id: 'px', codesource: 'cameraa' }
        );

        const caps = await getDeviceCapabilities('d-typo');
        expect(caps?.state?.map((field) => field.key)).toEqual(['visionModes']);

        const bag = await changeDeviceProperties('d-typo', {
            visionModes: 'presence',
        });
        expect(bag).toEqual({ visionModes: 'presence' });
    });
});
