/**
 * `GET /api/vision/feeds` — the contract `vision-feed` polls.
 *
 * What is pinned here: a camera is a feed **only when it selected modes** (a
 * generic `device.properties.visionModes` entry) — there is **no master switch**,
 * the selection is the switch — and the policy is the per-class resolution of
 * that selection, never one merged triple. A camera that leaves the list has its
 * threads stopped in the container, which is the only "off" there is.
 */
jest.mock('../../core/db', () => {
    const state: { devices: any[]; providers: any[] } = {
        devices: [],
        providers: [],
    };
    // The query is honoured (the camera list filters on `type: 'camera'`), so a
    // device of another type can never leak into the feed list.
    const matches = (query: any) => (doc: any) =>
        Object.entries(query ?? {}).every(([key, value]) => doc[key] === value);
    return {
        __state: state,
        cs: {
            devices: {
                find: (query: any) => ({
                    toArray: async () => state.devices.filter(matches(query)),
                }),
            },
            providers: {
                find: (query: any) => ({
                    toArray: async () => state.providers.filter(matches(query)),
                }),
            },
        },
    };
});

jest.mock('../../devices/providers/homeassistant/client', () => ({
    haBaseUrl: 'http://ha:8123',
    getHaToken: () => 'ha-token',
}));

import { listFeeds } from '../index';

const store = (jest.requireMock('../../core/db') as any).__state;

/** One camera under one provider row. */
const camera = (over: any = {}, provider: any = {}) => {
    store.devices.push({
        _id: 'cam1',
        name: 'Frigo',
        externalId: 'webcam-host',
        provider: 'p1',
        type: 'camera',
        ...over,
    });
    store.providers.push({
        _id: 'p1',
        codesource: 'camera',
        host: 'http://127.0.0.1:9312/video.mjpg',
        properties: { kind: 'mjpeg' },
        ...provider,
    });
};

describe('listFeeds', () => {
    beforeEach(() => {
        store.devices.length = 0;
        store.providers.length = 0;
    });

    it('resolves a selection into the per-class policy', async () => {
        camera({ properties: { visionModes: 'entrance,pet' } });

        const [feed] = await listFeeds();

        expect(feed.cameraId).toBe('cam1');
        expect(feed.modes).toEqual(['pet', 'entrance']); // table order
        // The union follows the selected modes' table order: `pet` first.
        expect(feed.policy.classes).toEqual(['cat', 'dog', 'person']);
        expect(feed.policy.dwellByClass).toEqual({
            person: 3,
            cat: 10,
            dog: 10,
        });
        // Only `entrance` escalates: the cat never pays a VLM call.
        expect(feed.policy.escalateClasses).toEqual(['person']);
        expect(feed.policy.modesByClass.person).toEqual(['entrance']);
        expect(feed.policy.gestureModes).toEqual([]);
        expect(feed.relay).toBe(true); // an mjpeg source is read through the brain
        expect(feed.source).toEqual({
            kind: 'mjpeg',
            url: 'http://127.0.0.1:9312/video.mjpg',
            user: undefined,
            password: undefined,
        });
    });

    it('skips a camera that selected no mode (that is the off state)', async () => {
        camera({ properties: { visionModes: '' } });
        camera({ _id: 'cam2', properties: {} });
        camera({ _id: 'cam3' });

        expect(await listFeeds()).toEqual([]);
    });

    it('skips a camera whose source cannot be resolved', async () => {
        // A camera provider row without a kind is not a source.
        camera({ properties: { visionModes: 'presence' } }, { properties: {} });
        expect(await listFeeds()).toEqual([]);
    });

    it('derives an HA camera source from the codesource', async () => {
        store.devices.push({
            _id: 'cam-ha',
            name: 'Salon',
            externalId: 'camera.salon',
            provider: 'ha',
            type: 'camera',
            properties: { visionModes: 'presence' },
        });
        store.providers.push({ _id: 'ha', codesource: 'homeassistant' });

        const [feed] = await listFeeds();

        expect(feed.source).toEqual({
            kind: 'ha',
            url: 'http://ha:8123/api/camera_proxy/camera.salon',
            token: 'ha-token',
        });
        expect(feed.relay).toBe(true);
        expect(feed.policy.escalateClasses).toEqual(['person']);
    });

    it('has no master switch: the selection is the switch', async () => {
        // Nothing global can turn the pipeline off — a camera with modes is a
        // feed, a camera without is not, and that is the whole rule.
        camera({ properties: { visionModes: 'presence' } });
        camera({ _id: 'cam2', properties: {} });

        const feeds = await listFeeds();

        expect(feeds.map((feed) => feed.cameraId)).toEqual(['cam1']);
    });

    it('never reports a camera that is not a camera', async () => {
        camera({
            _id: 'light1',
            type: 'light',
            properties: { visionModes: 'presence' },
        });
        expect(await listFeeds()).toEqual([]);
    });
});
