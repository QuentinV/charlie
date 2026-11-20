/**
 * The live view of a camera **for the browser**: a stream passthrough and a
 * single-frame grab.
 *
 * A browser plays MJPEG natively in an `<img>`, but that tag cannot send an
 * Authorization header (hence `?token=` on this one route) and an HA camera needs
 * the HA token added server-side. So the brain proxies the resolved source rather
 * than handing the page a URL. `webcam` / `rtsp` / `echo` sources are *not*
 * proxied: a local device index only exists where `vision-feed` runs, and nothing
 * here transcodes RTSP.
 */
import { Readable } from 'stream';
import {
    getHaToken,
    haBaseUrl,
} from '../devices/providers/homeassistant/client';
import { loadCamera } from './index';
import { fetchSnapshot } from './snapshot';
import { CameraSourceKind, resolveSource } from './sources';

/** The kinds a plain HTTP passthrough can serve. */
export function isBrowserStreamable(kind?: CameraSourceKind): boolean {
    return kind === 'mjpeg' || kind === 'ha';
}

/** Why a source cannot be shown in the browser (what the panel says). */
export function notStreamableMessage(kind?: string): string {
    if (kind === 'webcam') {
        return 'a local webcam is only readable by vision-feed (publish it as an mjpeg source to watch it here)';
    }
    if (kind === 'rtsp') {
        return 'an RTSP stream needs vision-feed (a browser cannot play RTSP)';
    }
    if (kind === 'echo') {
        return 'an echo camera is not served over HTTP yet';
    }
    return 'this camera has no readable source yet';
}

function sendJson(res: any, status: number, message: string): void {
    res.status(status).json({ message });
}

/** Pipe the camera's live stream into an `<img>` (MJPEG passthrough). */
export async function streamCamera(deviceId: string, res: any): Promise<void> {
    const loaded = await loadCamera(deviceId);
    if (!loaded) return sendJson(res, 404, 'camera not found');
    const { device, provider } = loaded;

    const resolved = resolveSource(device, provider, {
        haBaseUrl,
        haToken: getHaToken(),
    });
    if (!resolved || !isBrowserStreamable(resolved.kind)) {
        return sendJson(res, 415, notStreamableMessage(resolved?.kind));
    }

    // The page closing (tab, navigation, unmount) must end the upstream read: an
    // MJPEG source has no natural end.
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    let upstream: any;
    try {
        const headers: Record<string, string> = {};
        if (resolved.token) headers.Authorization = `Bearer ${resolved.token}`;
        upstream = await fetch(resolved.url, {
            headers,
            signal: controller.signal,
        });
    } catch (e) {
        return sendJson(res, 502, `camera unreachable: ${String(e)}`);
    }
    if (!upstream.ok || !upstream.body) {
        return sendJson(res, 502, `camera answered ${upstream.status}`);
    }

    res.writeHead(200, {
        'Content-Type':
            upstream.headers.get('content-type') ??
            'multipart/x-mixed-replace',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
    });

    const body = Readable.fromWeb(upstream.body as any);
    body.on('error', () => res.end());
    body.pipe(res);
}

/** One frame as a JPEG: the still fallback, and the describe input. */
export async function snapshotCamera(deviceId: string, res: any): Promise<void> {
    const loaded = await loadCamera(deviceId);
    if (!loaded) return sendJson(res, 404, 'camera not found');

    const image = await fetchSnapshot(loaded.device, loaded.provider);
    if (!image) {
        const kind = resolveSource(loaded.device, loaded.provider)?.kind;
        return sendJson(res, 503, `no frame available: ${notStreamableMessage(kind)}`);
    }

    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return sendJson(res, 502, 'unexpected snapshot format');

    const bytes = Buffer.from(match[2], 'base64');
    res.writeHead(200, {
        'Content-Type': match[1],
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
    });
    res.end(bytes);
}
