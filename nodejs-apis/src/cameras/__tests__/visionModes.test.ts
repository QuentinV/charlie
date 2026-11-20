/**
 * The camera's vision modes, end to end through the **device layer**.
 *
 * What is pinned here:
 * - the selection is a **durable device property** (`Device.properties.visionModes`)
 *   and never `state` — five writers `$set` the whole state bag (HA sync, MQTT,
 *   the provider read-back…), so anything kept there is wiped by the next gateway
 *   event;
 * - the write is a **dotted** `$set`, so a sibling property in the bag survives;
 * - the mode rows are advertised for **every** camera, whatever provider serves
 *   it: they belong to the device type (`devices/device-properties.ts`), which is
 *   what makes an HA camera — whose provider row is shared with every other HA
 *   device — behave exactly like a camera-provider one;
 * - the source is **read back** from the provider row (`cameraSourceViewOf`), and
 *   when it cannot be resolved the view names what is missing instead of the
 *   device page showing three dashes.
 *
 * The provider registry is replaced (no MQTT/bonjour/COAP at import time): the
 * `camera` provider declares no state and no properties of its own, so these
 * paths must work without it — which is precisely the HA case.
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
jest.mock('../../devices/providers/plugin', () => ({ createPlugin: jest.fn() }));
jest.mock('../../devices/providers', () => ({
    __esModule: true,
    default: { camera: { api: {} }, homeassistant: { api: {} } },
}));
jest.mock('../../devices/providers/homeassistant/client', () => ({
    haBaseUrl: 'http://ha:8123',
    getHaToken: () => 'ha-token',
}));

import cameraApis from '../../devices/providers/camera';
import {
    changeDeviceProperties,
    getDeviceCapabilities,
    getDeviceProperties,
} from '../../devices';
import { cameraSourceViewOf } from '../index';
import { cs } from '../../core/db';

const store = (jest.requireMock('../../core/db') as any).__state;
const updateOne = cs.devices.updateOne as unknown as jest.Mock;

/** One camera under one camera provider row (an MJPEG source by default). */
const camera = (over: any = {}, provider: any = {}) => {
    const device = {
        _id: 'cam1',
        name: 'Frigo',
        externalId: 'webcam-host',
        provider: 'p1',
        type: 'camera',
        ...over,
    };
    store.devices.push(device);
    store.providers.push({
        // One row per device: the join is by `_id`, so a shared default would
        // make a second camera read the first one's settings.
        _id: device.provider,
        codesource: 'camera',
        host: 'http://127.0.0.1:9312/video.mjpg',
        properties: { kind: 'mjpeg', snapshotUrl: 'http://cam/snapshot.jpg' },
        ...provider,
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    store.devices.length = 0;
    store.providers.length = 0;
});

describe('the selection is a durable device property', () => {
    it('reads it from the bag, never from the state', async () => {
        camera({
            _id: 'cam-bag',
            properties: { visionModes: 'presence,grocery' },
            state: { power: 'off', properties: { visionModes: '' } },
        });

        expect(await getDeviceProperties('cam-bag')).toEqual({
            visionModes: 'presence,grocery',
        });
    });

    it('advertises the modes as a multienum, one hint per option', async () => {
        camera({ _id: 'cam-caps' });

        const caps = await getDeviceCapabilities('cam-caps');
        const field = caps?.state?.find((f) => f.key === 'visionModes')!;

        expect(field.type).toBe('multienum');
        expect(field.options?.map((o) => o.value)).toEqual([
            'presence',
            'pet',
            'entrance',
            'grocery',
            'commands',
        ]);
        // A mode is a preset: what it does has to be readable.
        expect(field.options?.every((o) => !!o.description)).toBe(true);
        expect(field.description).toBeTruthy();
    });

    it('gives an HA camera the same rows (its provider row is shared)', async () => {
        store.devices.push({
            _id: 'cam-ha',
            name: 'Salon',
            externalId: 'camera.salon',
            provider: 'ha',
            type: 'camera',
            properties: { visionModes: 'presence' },
        });
        store.providers.push({ _id: 'ha', codesource: 'homeassistant' });

        const caps = await getDeviceCapabilities('cam-ha');

        expect(caps?.state?.map((f) => f.key)).toEqual(['visionModes']);
    });

    it('writes it with a dotted $set, dropping unknown ids', async () => {
        camera({ _id: 'cam-write' });

        const bag = await changeDeviceProperties('cam-write', {
            visionModes: 'presence,nope,off',
        });

        expect(updateOne).toHaveBeenCalledWith(
            { _id: 'cam-write' },
            { $set: { 'properties.visionModes': 'presence' } }
        );
        expect(bag.visionModes).toBe('presence');
    });

    it('keeps a sibling property in the bag', async () => {
        camera({
            _id: 'cam-sib',
            properties: { visionModes: 'presence', sensitivity: 0.6 },
        });

        await changeDeviceProperties('cam-sib', { visionModes: 'pet' });

        expect(store.devices[0].properties).toEqual({
            visionModes: 'pet',
            sensitivity: 0.6,
        });
    });

    it('stores an emptied selection: that is the off state', async () => {
        camera({ _id: 'cam-off', properties: { visionModes: 'presence' } });

        const bag = await changeDeviceProperties('cam-off', {
            visionModes: '',
        });

        expect(bag.visionModes).toBe('');
    });

    it('survives a state write (the selection is not in the state)', async () => {
        camera({
            _id: 'cam-survive',
            properties: { visionModes: 'presence,grocery' },
        });
        await changeDeviceProperties('cam-survive', {
            visionModes: 'entrance',
        });

        // What every other writer does (`$set: { state }`) — HA sync, MQTT, the
        // provider read-back. It must not touch the mode selection.
        Object.assign(store.devices[0], {
            state: { power: 'on', properties: { something: 1 } },
        });

        expect(await getDeviceProperties('cam-survive')).toEqual({
            visionModes: 'entrance',
        });
    });
});

describe('cameraSourceViewOf', () => {
    it('reads the source from the provider row', async () => {
        camera({ _id: 'cam-src' });

        expect(await cameraSourceViewOf('cam-src')).toEqual({
            source: {
                kind: 'mjpeg',
                url: 'http://127.0.0.1:9312/video.mjpg',
                snapshotUrl: 'http://cam/snapshot.jpg',
            },
            target: 'http://127.0.0.1:9312/video.mjpg',
        });
    });

    it('derives an HA camera source from the codesource + the entity', async () => {
        store.devices.push({
            _id: 'cam-ha-src',
            name: 'Salon',
            externalId: 'camera.salon',
            provider: 'ha',
            type: 'camera',
        });
        store.providers.push({ _id: 'ha', codesource: 'homeassistant' });

        const view = await cameraSourceViewOf('cam-ha-src');

        expect(view?.source?.kind).toBe('ha');
        expect(view?.target).toBe('camera.salon');
        expect(view?.issue).toBeUndefined();
    });

    it('names what is missing instead of showing nothing', async () => {
        // The row has no type: it is the gate for everything else, which is the
        // one mistake that used to render as three silent dashes.
        camera({ _id: 'cam-nokind' }, { properties: {} });
        expect((await cameraSourceViewOf('cam-nokind'))?.issue).toBe('no-kind');

        // A type that needs a stream URL, without one.
        camera(
            { _id: 'cam-nourl', provider: 'p2' },
            { host: undefined, properties: { kind: 'rtsp' } }
        );
        expect((await cameraSourceViewOf('cam-nourl'))?.issue).toBe('no-url');

        // The provider row is gone (pushed without one on purpose).
        store.devices.push({
            _id: 'cam-noprov',
            name: 'Orpheline',
            externalId: 'x',
            provider: 'gone',
            type: 'camera',
        });
        expect((await cameraSourceViewOf('cam-noprov'))?.issue).toBe(
            'provider-missing'
        );

        // No such device at all.
        expect(await cameraSourceViewOf('nope')).toBeNull();
    });
});

describe('the camera provider itself', () => {
    it('declares only the provider-row settings', () => {
        // The source is provider config: `kind` is mandatory (it gates `host`
        // and `snapshotUrl`), so it carries the hint the dialog renders.
        const kind = cameraApis.settings?.find((f) => f.key === 'kind')!;
        expect(cameraApis.settings?.map((f) => f.key)).toEqual([
            'kind',
            'host',
            'snapshotUrl',
        ]);
        expect(kind.description).toBeTruthy();
    });

    it('declares no state and no properties of its own', async () => {
        // Everything durable about a camera is a *device type* concern
        // (`cameras/properties.ts` + the generic bag), which is what makes an HA
        // camera identical: this api is never reached for one.
        expect(await cameraApis.api.getCapabilities?.({} as any)).toEqual({
            functions: [],
        });
        expect(cameraApis.api.getDeviceState).toBeUndefined();
        expect(cameraApis.api.changeDeviceState).toBeUndefined();
        expect(cameraApis.api.getDeviceProperties).toBeUndefined();
        expect(cameraApis.api.changeDeviceProperties).toBeUndefined();
    });
});
