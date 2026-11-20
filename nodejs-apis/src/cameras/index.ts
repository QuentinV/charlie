/**
 * The camera registry the live pipeline consumes.
 *
 * `GET /api/vision/feeds` returns every camera that **selected vision modes**
 * (`device.properties.visionModes`), with its resolved source and its policy — the
 * per-class tables of `cameras/modes.ts`. The brain owns this; `vision-feed`
 * only polls it.
 *
 * The source comes from the camera's **provider row** (one row per camera,
 * see `cameras/sources.ts`), so a camera + its provider are loaded together.
 *
 * The list **is** the switch: there is no master flag. A camera that selected no
 * mode is not analysed at all, so a house with no configured camera has nothing
 * to stop.
 */
import { cs } from '../core/db';
import {
    getHaToken,
    haBaseUrl,
} from '../devices/providers/homeassistant/client';
import { Device, Provider } from '../types';
import { VisionPolicy, visionModesOf, visionPolicyOf } from './modes';
import {
    CameraSourceView,
    FeedSource,
    cameraSourceView,
    relaysSource,
    resolveSource,
} from './sources';

export interface Feed {
    cameraId: string;
    name: string;
    /** The modes the camera selected, in table order. */
    modes: string[];
    source: FeedSource;
    /**
     * True when `vision-feed` must read the stream **through the brain**
     * (`/api/vision/feeds/<id>/stream`) instead of opening `source.url`: the
     * camera may sit on the brain's host, where the container cannot reach it.
     */
    relay: boolean;
    /** The per-class policy of the selection (see `cameras/modes.ts`). */
    policy: VisionPolicy;
}

/** Every camera with modes selected, source + per-class policy resolved. */
export async function listFeeds(): Promise<Feed[]> {
    const cameras: Device[] = await cs.devices.find({ type: 'camera' }).toArray();
    // One query for every provider row: no N+1 per camera.
    const providers: Provider[] = await cs.providers.find().toArray();
    const byId = new Map(providers.map((p) => [p._id, p]));

    const feeds: Feed[] = [];
    for (const cam of cameras) {
        // No mode selected = the camera is not analysed at all (there is no
        // `off` mode: an empty selection cannot mean anything else).
        const modes = visionModesOf(cam.properties?.visionModes);
        if (!modes.length) continue;

        const source = resolveSource(cam, byId.get(cam.provider), {
            haBaseUrl,
            haToken: getHaToken(),
        });
        // A camera whose source cannot be resolved is skipped rather than
        // failing the whole list.
        if (!source) continue;

        feeds.push({
            cameraId: cam._id,
            name: cam.name,
            modes: modes.map((mode) => mode.id),
            source,
            relay: relaysSource(source.kind),
            policy: visionPolicyOf(modes),
        });
    }
    return feeds;
}

/**
 * One camera with the provider row that carries its source. Every consumer that
 * needs a frame (snapshot, live view, describe, fridge flow) loads this pair
 * through here, so the join cannot drift.
 */
export async function loadCamera(deviceId: string): Promise<{
    device: Device;
    provider: Provider | null;
} | null> {
    const device: Device | null = await cs.devices.findOne({ _id: deviceId });
    if (!device) return null;
    const provider: Provider | null = await cs.providers.findOne({
        _id: device.provider,
    });
    return { device, provider };
}

/**
 * The read-only source view of one camera, for the device page: what the feed
 * would open, and — when it would open nothing — why.
 *
 * The source is provider config, so it is **derived on read** and never stored
 * on the device: the panel then shows the provider row's truth, instead of a
 * copy that can only be stale (and that an HA camera's shared row could never
 * fill). `null` only when the device itself does not exist.
 */
export async function cameraSourceViewOf(
    deviceId: string
): Promise<CameraSourceView | null> {
    const loaded = await loadCamera(deviceId);
    if (!loaded) return null;
    return cameraSourceView(loaded.device, loaded.provider, { haBaseUrl });
}
