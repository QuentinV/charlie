/**
 * Camera source resolution — pure, no I/O. The HA base URL / token are passed
 * in (they are runtime state), so nothing here boots the HA client.
 *
 * Since phase 1 the source is **provider config**: a camera provider row is one
 * camera (like a Shelly row is one plug) and the device only carries
 * `externalId`. These tests pin that join, including the HA case where `kind`
 * is derived from the codesource and the entity id *is* the `externalId`.
 */
import {
    cameraSourceIssue,
    cameraSourceOf,
    cameraSourceView,
    relaysSource,
    resolveSource,
    sourceKindOf,
    sourceTarget,
} from '../sources';
import { Device, Provider } from '../../types';

const cam = (over: Partial<Device> = {}): Device => ({
    _id: 'cam-1',
    name: 'Frigo',
    externalId: 'webcam-host',
    provider: 'p-1',
    type: 'camera',
    ...over,
});

const provider = (over: Partial<Provider> = {}): Provider => ({
    _id: 'p-1',
    name: 'Caméra cuisine',
    codesource: 'camera',
    ...over,
});

describe('sourceKindOf', () => {
    it('derives ha from the codesource, whatever the properties say', () => {
        expect(sourceKindOf(provider({ codesource: 'homeassistant' }))).toBe(
            'ha'
        );
        expect(
            sourceKindOf(
                provider({
                    codesource: 'homeassistant',
                    properties: { kind: 'webcam' },
                })
            )
        ).toBe('ha');
    });

    it('reads the kind of a camera provider row', () => {
        for (const kind of ['webcam', 'rtsp', 'mjpeg', 'echo'] as const) {
            expect(sourceKindOf(provider({ properties: { kind } }))).toBe(kind);
        }
    });

    it('refuses an unknown kind instead of guessing one', () => {
        expect(sourceKindOf(provider())).toBeUndefined();
        expect(
            sourceKindOf(provider({ properties: { kind: 'nope' } }))
        ).toBeUndefined();
        expect(sourceKindOf(null)).toBeUndefined();
    });
});

describe('cameraSourceOf', () => {
    it('reads the URL and the declared single-frame URL', () => {
        expect(
            cameraSourceOf(
                provider({
                    host: '  http://cam/video.mjpg ',
                    properties: {
                        kind: 'mjpeg',
                        snapshotUrl: ' http://cam/s.jpg ',
                    },
                })
            )
        ).toEqual({
            kind: 'mjpeg',
            url: 'http://cam/video.mjpg',
            snapshotUrl: 'http://cam/s.jpg',
        });
    });

    it('drops a blank snapshot URL', () => {
        expect(
            cameraSourceOf(
                provider({
                    host: 'http://cam',
                    properties: { kind: 'mjpeg', snapshotUrl: '   ' },
                })
            )?.snapshotUrl
        ).toBeUndefined();
    });

    it('is undefined for a provider that is not a camera', () => {
        expect(cameraSourceOf(provider())).toBeUndefined();
    });
});

describe('resolveSource', () => {
    it('maps a webcam to an index spec, defaulting to 0', () => {
        expect(
            resolveSource(cam(), provider({ properties: { kind: 'webcam' } }))
        ).toEqual({ kind: 'webcam', url: '0' });
        expect(
            resolveSource(
                cam(),
                provider({ host: '2', properties: { kind: 'webcam' } })
            )
        ).toEqual({ kind: 'webcam', url: '2' });
    });

    it('passes rtsp/mjpeg URLs through with the provider credentials', () => {
        const p = provider({
            host: 'rtsp://cam/1',
            user: 'a',
            password: 'b',
            properties: { kind: 'rtsp' },
        });
        expect(resolveSource(cam(), p)).toEqual({
            kind: 'rtsp',
            url: 'rtsp://cam/1',
            user: 'a',
            password: 'b',
        });
        // The stream URL is what the feed opens: without it there is nothing.
        expect(
            resolveSource(cam(), provider({ properties: { kind: 'mjpeg' } }))
        ).toBeNull();
    });

    it('resolves an HA camera from the device externalId + the HA provider', () => {
        const ha = provider({ codesource: 'homeassistant', name: 'HA' });
        const device = cam({ externalId: 'camera.salon' });

        expect(
            resolveSource(device, ha, {
                haBaseUrl: 'http://ha:8123',
                haToken: 'tok',
            })
        ).toEqual({
            kind: 'ha',
            url: 'http://ha:8123/api/camera_proxy/camera.salon',
            token: 'tok',
        });

        // No HA instance booted → unusable, never a half URL.
        expect(resolveSource(device, ha)).toBeNull();
        // No entity id on the device → unusable.
        expect(
            resolveSource(cam({ externalId: '' }), ha, {
                haBaseUrl: 'http://ha:8123',
            })
        ).toBeNull();
    });

    it('maps an echo source to its device id', () => {
        expect(
            resolveSource(
                cam({ externalId: 'echo-1' }),
                provider({ properties: { kind: 'echo' } })
            )
        ).toEqual({ kind: 'echo', url: 'echo-1' });
    });

    it('returns null when the camera has no usable provider row', () => {
        expect(resolveSource(cam(), null)).toBeNull();
        expect(resolveSource(cam(), undefined)).toBeNull();
        expect(resolveSource(cam(), provider())).toBeNull();
    });
});

describe('relaysSource', () => {
    it('relays what the container cannot open itself', () => {
        // A host-local mjpeg URL (a webcam helper on 127.0.0.1) and an HA proxy
        // that needs a token: both are fetched through the brain.
        expect(relaysSource('mjpeg')).toBe(true);
        expect(relaysSource('ha')).toBe(true);
    });

    it('leaves a source the feed can open on its own', () => {
        // rtsp is reachable from the container (and nothing here speaks rtsp),
        // and a webcam index only means something where the feed runs.
        expect(relaysSource('rtsp')).toBe(false);
        expect(relaysSource('webcam')).toBe(false);
        expect(relaysSource('echo')).toBe(false);
        expect(relaysSource(undefined)).toBe(false);
    });
});

describe('sourceTarget', () => {
    it('shows the entity for ha/echo, the URL otherwise', () => {
        expect(
            sourceTarget(cam({ externalId: 'camera.salon' }), { kind: 'ha' })
        ).toBe('camera.salon');
        expect(
            sourceTarget(cam({ externalId: 'echo-1' }), { kind: 'echo' })
        ).toBe('echo-1');
        expect(
            sourceTarget(cam(), { kind: 'mjpeg', url: 'http://cam/v.mjpg' })
        ).toBe('http://cam/v.mjpg');
        // The feed defaults a webcam to index 0, so the readout does too.
        expect(sourceTarget(cam(), { kind: 'webcam' })).toBe('0');
        expect(sourceTarget(cam(), undefined)).toBe('');
    });
});

describe('cameraSourceIssue', () => {
    it('is undefined for a camera that can feed', () => {
        expect(
            cameraSourceIssue(
                cam(),
                provider({
                    host: 'http://cam/v.mjpg',
                    properties: { kind: 'mjpeg' },
                })
            )
        ).toBeUndefined();
        expect(
            cameraSourceIssue(
                cam(),
                provider({ properties: { kind: 'webcam' } })
            )
        ).toBeUndefined();
        expect(
            cameraSourceIssue(
                cam({ externalId: 'echo-1' }),
                provider({ properties: { kind: 'echo' } })
            )
        ).toBeUndefined();
        expect(
            cameraSourceIssue(
                cam({ externalId: 'camera.salon' }),
                provider({ codesource: 'homeassistant' }),
                { haBaseUrl: 'http://ha:8123' }
            )
        ).toBeUndefined();
    });

    it('names the missing piece instead of answering a bare null', () => {
        // No provider row at all.
        expect(cameraSourceIssue(cam(), null)).toBe('provider-missing');
        // A row with no type: it is the gate for everything else, so a URL and a
        // snapshot URL are ignored until it is set.
        expect(
            cameraSourceIssue(
                cam(),
                provider({
                    host: 'http://cam',
                    properties: { snapshotUrl: 'http://cam/s.jpg' },
                })
            )
        ).toBe('no-kind');
        expect(
            cameraSourceIssue(
                cam(),
                provider({ properties: { kind: 'nope' } })
            )
        ).toBe('no-kind');
        // A type that needs a URL, without one.
        expect(
            cameraSourceIssue(
                cam(),
                provider({ properties: { kind: 'rtsp' } })
            )
        ).toBe('no-url');
        // An entity-based source without the entity.
        expect(
            cameraSourceIssue(
                cam({ externalId: '' }),
                provider({ codesource: 'homeassistant' }),
                { haBaseUrl: 'http://ha:8123' }
            )
        ).toBe('no-entity');
        expect(
            cameraSourceIssue(
                cam({ externalId: '' }),
                provider({ properties: { kind: 'echo' } })
            )
        ).toBe('no-entity');
        // No HA instance booted: an HA camera cannot be opened at all.
        expect(
            cameraSourceIssue(
                cam({ externalId: 'camera.salon' }),
                provider({ codesource: 'homeassistant' })
            )
        ).toBe('ha-unavailable');
    });
});

describe('cameraSourceView', () => {
    it('reads the provider row and never carries the HA token', () => {
        const view = cameraSourceView(
            cam({ externalId: 'camera.salon' }),
            provider({ codesource: 'homeassistant' }),
            { haBaseUrl: 'http://ha:8123', haToken: 'secret' }
        );

        expect(view).toEqual({
            source: { kind: 'ha' },
            target: 'camera.salon',
        });
        expect(JSON.stringify(view)).not.toContain('secret');
    });

    it('reports the reason when it resolves to nothing', () => {
        expect(cameraSourceView(cam(), provider({ properties: {} }))).toEqual({
            source: null,
            target: '',
            issue: 'no-kind',
        });
    });
});
