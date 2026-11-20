/**
 * The browser's live view: which sources can be streamed at all, the passthrough
 * itself (Content-Type, bytes, the HA token added server-side) and the refusal
 * paths. The camera lives in Mongo, so the device lookup is stubbed; HTTP is
 * stubbed too — this file is about the decisions, not about the network.
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
            },
            providers: {
                findOne: async (query: any) =>
                    state.providers.find((p) => p._id === query._id) ?? null,
            },
        },
    };
});

jest.mock('../../devices/providers/homeassistant/client', () => ({
    getHaToken: () => 'ha-token',
    haBaseUrl: 'http://ha.local:8123',
}));

import { EventEmitter } from 'events';
import { Readable } from 'stream';
import {
    isBrowserStreamable,
    notStreamableMessage,
    snapshotCamera,
    streamCamera,
} from '../stream';

const dbState = (jest.requireMock('../../core/db') as any).__state;
const originalFetch = global.fetch;

let fetchMock: jest.Mock;

/**
 * A response object with just what the handlers touch. It extends EventEmitter
 * because `Readable.pipe()` needs `on`/`once`/`emit` on the destination.
 */
function fakeRes() {
    const res: any = new EventEmitter();
    res.statusCode = 0;
    res.headers = {};
    res.body = [];
    res.sent = null;
    res.status = (code: number) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data: any) => {
        res.sent = data;
        return res;
    };
    res.writeHead = (code: number, headers: any) => {
        res.statusCode = code;
        res.headers = headers ?? {};
        return res;
    };
    res.setHeader = (key: string, value: any) => {
        res.headers[key] = value;
    };
    res.write = (data: any) => {
        if (data) res.body.push(Buffer.from(data));
        return true;
    };
    res.end = (data?: any) => {
        if (data) res.body.push(Buffer.from(data));
        return res;
    };
    return res;
}

const device = (over: any = {}) => ({
    _id: 'cam-1',
    name: 'Frigo',
    externalId: 'camera.fridge',
    provider: 'p-1',
    type: 'camera',
    ...over,
});

/** The camera's provider row: one row per camera, the source lives here. */
const provider = (over: any = {}) => ({
    _id: 'p-1',
    name: 'Caméra cuisine',
    codesource: 'camera',
    host: 'http://cam/video.mjpg',
    properties: { kind: 'mjpeg' },
    ...over,
});

/** Install one camera + its provider (what `loadCamera` reads). */
const useCamera = (deviceOver: any = {}, providerOver: any = {}) => {
    dbState.devices = [device(deviceOver)];
    dbState.providers = [provider(providerOver)];
};

/** What the fetch stub returns for a live stream. */
const streamResponse = (bytes = 'frame-bytes') => ({
    ok: true,
    status: 200,
    headers: new Headers({
        'content-type': 'multipart/x-mixed-replace; boundary=ffmpeg',
    }),
    body: Readable.toWeb(Readable.from([Buffer.from(bytes)])),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
    dbState.devices = [];
    dbState.providers = [];
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe('isBrowserStreamable', () => {
    it('accepts mjpeg and ha only', () => {
        expect(isBrowserStreamable('mjpeg')).toBe(true);
        expect(isBrowserStreamable('ha')).toBe(true);
        for (const kind of ['webcam', 'rtsp', 'echo'] as const) {
            expect(isBrowserStreamable(kind)).toBe(false);
        }
        expect(isBrowserStreamable(undefined)).toBe(false);
    });

    it('explains why a source cannot be shown', () => {
        expect(notStreamableMessage('webcam')).toContain('vision-feed');
        expect(notStreamableMessage('rtsp')).toContain('RTSP');
        expect(notStreamableMessage('echo')).toContain('echo');
        expect(notStreamableMessage(undefined)).toContain('no readable source');
    });
});

describe('streamCamera', () => {
    it('answers 404 for an unknown camera', async () => {
        const res = fakeRes();
        await streamCamera('nope', res);

        expect(res.statusCode).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a source the browser cannot play', async () => {
        useCamera(
            { externalId: '0' },
            { host: '0', properties: { kind: 'webcam' } }
        );

        const res = fakeRes();
        await streamCamera('cam-1', res);

        expect(res.statusCode).toBe(415);
        expect(res.sent.message).toContain('vision-feed');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('pipes the camera stream through with its content type', async () => {
        useCamera();
        fetchMock.mockResolvedValue(streamResponse());

        const res = fakeRes();
        await streamCamera('cam-1', res);
        await settle();

        expect(fetchMock.mock.calls[0][0]).toBe('http://cam/video.mjpg');
        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toContain(
            'multipart/x-mixed-replace'
        );
        expect(Buffer.concat(res.body).toString()).toBe('frame-bytes');
    });

    it('adds the HA token server-side', async () => {
        useCamera(
            { externalId: 'camera.fridge' },
            {
                codesource: 'homeassistant',
                host: undefined,
            }
        );
        fetchMock.mockResolvedValue(streamResponse());

        const res = fakeRes();
        await streamCamera('cam-1', res);
        await settle();

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://ha.local:8123/api/camera_proxy/camera.fridge');
        expect(init.headers.Authorization).toBe('Bearer ha-token');
    });

    it('reports an unreachable camera', async () => {
        useCamera();
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

        const res = fakeRes();
        await streamCamera('cam-1', res);

        expect(res.statusCode).toBe(502);
    });

    it('reports a camera that refuses', async () => {
        useCamera();
        fetchMock.mockResolvedValue({
            ...streamResponse(),
            ok: false,
            status: 503,
        });

        const res = fakeRes();
        await streamCamera('cam-1', res);

        expect(res.statusCode).toBe(502);
        expect(res.sent.message).toContain('503');
    });
});

describe('snapshotCamera', () => {
    it('answers 200 with the JPEG bytes', async () => {
        useCamera();
        fetchMock.mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            arrayBuffer: async () => Buffer.from('jpeg-bytes'),
        });

        const res = fakeRes();
        await snapshotCamera('cam-1', res);

        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toBe('image/jpeg');
        expect(Buffer.concat(res.body).toString()).toBe('jpeg-bytes');
    });

    it('answers 404 for an unknown camera', async () => {
        const res = fakeRes();
        await snapshotCamera('nope', res);

        expect(res.statusCode).toBe(404);
    });

    it('answers 503 when the source cannot be grabbed at all', async () => {
        useCamera(
            { externalId: '0' },
            { host: '0', properties: { kind: 'webcam' } }
        );

        const res = fakeRes();
        await snapshotCamera('cam-1', res);

        expect(res.statusCode).toBe(503);
        expect(res.sent.message).toContain('vision-feed');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
