/**
 * REST surface of the live-camera pipeline: the feed list `vision-feed` polls,
 * the event sink it posts to, the keyframe escalation, the stored keyframes, and
 * the browser's live view (stream / still / events / describe).
 * All of it stays behind the auth gate — a feed list, a keyframe and a live
 * picture are private.
 */
import { RestApis } from '../types';
import { describeFrame } from './describe';
import { KEEP_EVENTS, listEvents } from './eventLog';
import { recordEvent } from './events';
import { listFeeds, loadCamera, cameraSourceViewOf } from './index';
import { readKeyframe } from './keyframes';
import { describeRequestFromBody, visionEventFromBody } from './logic';
import { fetchSnapshot } from './snapshot';
import { snapshotCamera, streamCamera } from './stream';

const routes: RestApis = {
    'vision/feeds': {
        get: {
            handler: async () => ({ feeds: await listFeeds() }),
            description:
                'Cameras marked to feed the live vision pipeline, with their source and policy',
        },
    },
    'vision/events': {
        post: {
            handler: async ({ body }) => {
                const event = visionEventFromBody(body);
                if (!event) return { ok: false, error: 'invalid vision event' };
                await recordEvent(event);
                return { ok: true };
            },
            description: 'Report a live vision event (used by vision-feed)',
        },
    },
    'vision/describe': {
        post: {
            handler: async ({ body }) => {
                const request = describeRequestFromBody(body);
                if (!request) return { ok: false, error: 'no image' };
                const result = await describeFrame(
                    request.image,
                    request.prompt
                );
                return { ok: !!result.text, ...result };
            },
            description:
                'Describe a camera keyframe (fast VLM first, heavy fallback); stores the keyframe',
        },
    },
    'vision/keyframes/:file': {
        get: {
            fullHandler: async ({ params }, res: any) => {
                const bytes = readKeyframe(params.file);
                if (!bytes) {
                    res.status(404).json({ message: 'keyframe not found' });
                    return;
                }
                res.setHeader('Content-Type', 'image/jpeg');
                res.send(bytes);
            },
            description: 'The stored keyframe of an escalated event',
        },
    },
    'vision/cameras/:id/events': {
        get: {
            handler: async ({ params, query }) => ({
                events: listEvents(
                    params.id,
                    Math.min(Number(query?.limit) || 20, KEEP_EVENTS)
                ),
            }),
            description:
                'The recent vision events of one camera (in memory, newest first)',
        },
    },
    'vision/cameras/:id/describe': {
        post: {
            handler: async ({ params }) => {
                const loaded = await loadCamera(params.id);
                if (!loaded) return { ok: false, error: 'camera not found' };

                const image = await fetchSnapshot(
                    loaded.device,
                    loaded.provider
                );
                if (!image) {
                    return {
                        ok: false,
                        error: 'no snapshot available for this camera',
                    };
                }
                const result = await describeFrame(image);
                return { ok: !!result.text, ...result };
            },
            description:
                'Look at a camera now and describe what it sees (stores the frame)',
        },
    },
    'devices/:id/source': {
        get: {
            fullHandler: async ({ params }, res: any) => {
                const view = await cameraSourceViewOf(params.id);
                if (!view) {
                    res.status(404).json({ message: 'camera not found' });
                    return;
                }
                res.json(view);
            },
            description:
                "The frame source a camera resolves to (read-only view of its provider row) and, when there is none, why",
        },
    },
    'devices/:id/stream': {
        get: {
            fullHandler: async ({ params }, res: any) =>
                streamCamera(params.id, res),
            description:
                'Live stream of a camera, for an <img> (MJPEG passthrough; accepts ?token=)',
        },
    },
    'vision/feeds/:id/stream': {
        get: {
            fullHandler: async ({ params }, res: any) =>
                streamCamera(params.id, res),
            description:
                'The same passthrough for vision-feed, which cannot reach a host-local camera (accepts ?token=: cv2 cannot send a header)',
        },
    },
    'devices/:id/snapshot': {
        get: {
            fullHandler: async ({ params }, res: any) =>
                snapshotCamera(params.id, res),
            description: 'One frame of a camera as a JPEG',
        },
    },
};

export default routes;

