/**
 * The recent vision events, **in memory** (one ring per camera).
 *
 * This backs a live view, not a history: the durable trail is the activity log
 * (`recordEvent` writes there too), and a panel that shows the last few minutes
 * has no use for a collection. A restart empties it, by design — the activity
 * log keeps the record.
 */
import { VisionEvent } from '../types';

/** At most this many events per camera… */
export const KEEP_EVENTS = 50;
/** …and nothing older than this (a stale list is worse than an empty one). */
export const EVENT_MAX_AGE_MS = 30 * 60 * 1000;

export interface StoredVisionEvent extends VisionEvent {
    /** The keyframe file name (`<id>.jpg`) the event carried, if any. */
    keyframe?: string;
}

const byCamera: { [cameraId: string]: StoredVisionEvent[] } = {};

/** The file name inside a keyframe URL (`/api/vision/keyframes/<id>.jpg`). */
export function keyframeFile(keyframeUrl?: string): string | undefined {
    const name = keyframeUrl?.split('/').pop()?.trim();
    return name && name.endsWith('.jpg') ? name : undefined;
}

/** Pure: what survives at `now` — recent enough, and the last `keep` only. */
export function pruneEvents(
    list: StoredVisionEvent[],
    now: number,
    keep = KEEP_EVENTS,
    maxAge = EVENT_MAX_AGE_MS
): StoredVisionEvent[] {
    return list.filter((event) => now - event.at <= maxAge).slice(-keep);
}

/** Remember one event for its camera (newest last). */
export function appendEvent(event: VisionEvent): StoredVisionEvent {
    const stored: StoredVisionEvent = {
        ...event,
        keyframe: keyframeFile(event.keyframeUrl),
    };
    const list = byCamera[event.cameraId] ?? [];
    byCamera[event.cameraId] = pruneEvents([...list, stored], Date.now());
    return stored;
}

/** The most recent events of one camera, **newest first**. */
export function listEvents(cameraId: string, limit = 20): StoredVisionEvent[] {
    const list = pruneEvents(byCamera[cameraId] ?? [], Date.now());
    byCamera[cameraId] = list;
    return list.slice(-limit).reverse();
}

/** Forget a camera (its device is gone, or a test wants a clean slate). */
export function forgetCamera(cameraId: string): void {
    delete byCamera[cameraId];
}
