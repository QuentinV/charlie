/**
 * Grab one frame from a camera as a data URL, for the agent's on-demand
 * questions ("what does the garden camera see?", "what is in the fridge?").
 *
 * Only http-based sources are grabbable from the brain: an HA `camera_proxy`
 * snapshot or an MJPEG/JPEG endpoint. A webcam or an RTSP stream needs OpenCV,
 * so those must go through `vision-feed` — the tool says so rather than failing
 * silently.
 *
 * An MJPEG URL is usually a **live multipart stream, which never ends**: reading
 * its body would hang the agent forever. So a request is always given a deadline,
 * and a camera provider may declare an explicit single-frame URL
 * (`provider.properties.snapshotUrl`) that wins over the stream — that is how a
 * live camera stays askable on demand.
 */
import {
    getHaToken,
    haBaseUrl,
} from '../devices/providers/homeassistant/client';
import { Device, Provider } from '../types';
import { resolveSource } from './sources';

/** A frame is not worth waiting longer than this for. */
export const SNAPSHOT_TIMEOUT_MS = 5000;

export async function fetchSnapshot(
    device: Device,
    provider?: Provider | null
): Promise<string | undefined> {
    const resolved = resolveSource(device, provider, {
        haBaseUrl,
        haToken: getHaToken(),
    });
    if (!resolved) return undefined;
    if (resolved.kind !== 'ha' && resolved.kind !== 'mjpeg') return undefined;

    // A declared single-frame URL beats the stream (see the module comment).
    const declared = provider?.properties?.snapshotUrl;
    const url =
        typeof declared === 'string' && declared.trim()
            ? declared.trim()
            : resolved.url;

    try {
        const headers: Record<string, string> = {};
        if (resolved.token) headers.Authorization = `Bearer ${resolved.token}`;
        const res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
        });
        if (!res.ok) return undefined;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!bytes.length) return undefined;
        const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(
            ';'
        )[0];
        return `data:${mime};base64,${bytes.toString('base64')}`;
    } catch {
        // Timed out (a live stream), refused, unreachable: no frame.
        return undefined;
    }
}

