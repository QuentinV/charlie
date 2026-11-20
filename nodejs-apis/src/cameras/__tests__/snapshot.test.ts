/**
 * `fetchSnapshot`: one frame, quickly, or nothing.
 *
 * The point of these tests is the live-stream case — an MJPEG URL is a multipart
 * stream that never ends, so it must not hang the agent — and the explicit
 * single-frame URL that makes such a camera askable on demand. Both the stream
 * and the snapshot URL live on the camera's **provider row**.
 */
jest.mock('../../devices/providers/homeassistant/client', () => ({
    getHaToken: () => '',
    haBaseUrl: 'http://ha.local:8123',
}));

import { SNAPSHOT_TIMEOUT_MS, fetchSnapshot } from '../snapshot';
import { Device, Provider } from '../../types';

const bytes = Buffer.from('jpeg-bytes');
const originalFetch = global.fetch;

const cam = (over: Partial<Device> = {}): Device => ({
    _id: 'cam-1',
    name: 'Frigo',
    externalId: 'camera.fridge',
    provider: 'p-1',
    type: 'camera',
    ...over,
});

const mjpeg = (over: Partial<Provider> = {}): Provider => ({
    _id: 'p-1',
    name: 'Caméra cuisine',
    codesource: 'camera',
    properties: { kind: 'mjpeg' },
    ...over,
});

const ha = (): Provider => ({
    _id: 'ha-1',
    name: 'Home Assistant',
    codesource: 'homeassistant',
});

const okResponse = () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
    arrayBuffer: async () => bytes,
});

let fetchMock: jest.Mock;

beforeEach(() => {
    fetchMock = jest.fn(async () => okResponse());
    (global as any).fetch = fetchMock;
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe('fetchSnapshot', () => {
    it('returns a data URL from an mjpeg provider', async () => {
        const image = await fetchSnapshot(
            cam(),
            mjpeg({ host: 'http://cam/video' })
        );

        expect(fetchMock.mock.calls[0][0]).toBe('http://cam/video');
        expect(image).toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    });

    it('prefers a declared single-frame URL over the stream', async () => {
        await fetchSnapshot(
            cam(),
            mjpeg({
                host: 'http://cam/video.mjpg',
                properties: { kind: 'mjpeg', snapshotUrl: 'http://cam/snapshot.jpg' },
            })
        );

        expect(fetchMock.mock.calls[0][0]).toBe('http://cam/snapshot.jpg');
    });

    it('ignores a blank snapshot URL', async () => {
        await fetchSnapshot(
            cam(),
            mjpeg({
                host: 'http://cam/video.mjpg',
                properties: { kind: 'mjpeg', snapshotUrl: '   ' },
            })
        );

        expect(fetchMock.mock.calls[0][0]).toBe('http://cam/video.mjpg');
    });

    it('gives every request a deadline (a stream never ends)', async () => {
        await fetchSnapshot(cam(), mjpeg({ host: 'http://cam/video' }));

        const init = fetchMock.mock.calls[0][1];
        expect(SNAPSHOT_TIMEOUT_MS).toBeGreaterThan(0);
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('resolves the HA camera_proxy URL from the device entity id', async () => {
        await fetchSnapshot(cam({ externalId: 'camera.fridge' }), ha());

        expect(fetchMock.mock.calls[0][0]).toBe(
            'http://ha.local:8123/api/camera_proxy/camera.fridge'
        );
    });

    it('refuses sources only vision-feed can open', async () => {
        expect(
            await fetchSnapshot(
                cam({ externalId: '0' }),
                mjpeg({ properties: { kind: 'webcam' } })
            )
        ).toBeUndefined();
        expect(
            await fetchSnapshot(
                cam(),
                mjpeg({ host: 'rtsp://cam', properties: { kind: 'rtsp' } })
            )
        ).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns nothing when the fetch fails (timeout, refused, offline)', async () => {
        fetchMock.mockRejectedValue(new Error('The operation was aborted'));

        expect(
            await fetchSnapshot(cam(), mjpeg({ host: 'http://cam/video' }))
        ).toBeUndefined();
    });

    it('returns nothing for an empty body', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            arrayBuffer: async () => Buffer.alloc(0),
        });

        expect(
            await fetchSnapshot(cam(), mjpeg({ host: 'http://cam/video' }))
        ).toBeUndefined();
    });

    it('keeps the mime the server answered with', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'image/png; charset=binary' }),
            arrayBuffer: async () => bytes,
        });

        expect(
            await fetchSnapshot(cam(), mjpeg({ host: 'http://cam/frame' }))
        ).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    });

    it('answers nothing for a camera whose provider is gone', async () => {
        expect(await fetchSnapshot(cam(), null)).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});