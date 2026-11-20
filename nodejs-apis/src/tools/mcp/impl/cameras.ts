import { z } from 'zod';
import { describeImage } from '../../../ai/llm';
import { cs } from '../../../core/db';
import { addGroceryItemsFromImage } from '../../../cameras/kitchen';
import { loadCamera } from '../../../cameras/index';
import { visionModesOf } from '../../../cameras/modes';
import { cameraSourceView } from '../../../cameras/sources';
import { fetchSnapshot } from '../../../cameras/snapshot';
import { shoppingEnabled } from '../../../skills/shopping/restructure';
import { Device, Provider, Tools } from '../../../types';

/** A short line describing a camera for the agent. */
function describeCamera(
    device: Device,
    provider?: Provider | null
): Record<string, unknown> {
    const modes = visionModesOf(device.properties?.visionModes).map(
        (mode) => mode.id
    );
    const view = cameraSourceView(device, provider);
    return {
        id: device._id,
        name: device.name,
        modes,
        analyzed: modes.length > 0,
        source: view.source?.kind ?? null,
        target: view.target || null,
        issue: view.issue ?? null,
    };
}

/**
 * Both "look at a camera" tools answer this when the frame cannot be grabbed: a
 * live MJPEG stream never ends, so it needs the camera's single-frame URL.
 */
const NO_SNAPSHOT =
    'No snapshot available for this camera: only Home Assistant and MJPEG sources can be snapshotted on demand, and a live MJPEG stream needs its "snapshot URL" filled in (a single-frame endpoint).';

const tools: Tools = {
    'fetch-camera-list': {
        description:
            'List the home cameras with their vision modes, whether the live vision pipeline analyses them, and the source each one resolves to (with the reason when it resolves to none). Use it to retrieve a camera id before looking at one.',
        inputSchema: {},
        exec: async () => {
            const cameras = await cs.devices.find({ type: 'camera' }).toArray();
            const providers: Provider[] = await cs.providers.find().toArray();
            const byId = new Map(providers.map((p) => [p._id, p]));
            return JSON.stringify(
                cameras.map((c) => describeCamera(c, byId.get(c.provider)))
            );
        },
    },

    'describe-camera': {
        description:
            'Look at a camera and answer a question about what it sees (people, animals, objects). Only Home Assistant and MJPEG cameras can be snapshotted on demand; a webcam or RTSP camera needs a live feed.',
        inputSchema: {
            cameraId: z.string(),
            question: z
                .string()
                .optional()
                .describe('What to ask about the image; defaults to a short description'),
        },
        exec: async ({ cameraId, question }) => {
            const loaded = await loadCamera(cameraId);
            if (!loaded) return 'Camera not found.';
            const image = await fetchSnapshot(loaded.device, loaded.provider);
            if (!image) {
                return NO_SNAPSHOT;
            }
            const text = await describeImage(image, question);
            return text || 'The vision model did not answer.';
        },
    },

    'add-camera-items-to-shopping': {
        description:
            'Look at a camera pointed at a fridge or a pantry shelf and add the grocery items it shows to the shopping list. Only what is actually visible is added; quantities are extracted in the background.',
        inputSchema: {
            cameraId: z.string(),
            hint: z
                .string()
                .optional()
                .describe('Optional focus, e.g. "the top shelf"'),
        },
        exec: async ({ cameraId, hint }, ctx) => {
            if (!shoppingEnabled()) {
                return 'The shopping list is disabled in the settings.';
            }
            const loaded = await loadCamera(cameraId);
            if (!loaded) return 'Camera not found.';

            const image = await fetchSnapshot(loaded.device, loaded.provider);
            if (!image) {
                return NO_SNAPSHOT;
            }

            // Same code as the automatic fridge flow (cameras/kitchen.ts): one
            // path, so the prompt/schema/parsing cannot drift apart.
            const items = await addGroceryItemsFromImage(image, hint, ctx?.user);
            if (!items.length) {
                return 'No grocery item recognized on the image.';
            }
            return `Added ${items.length} item(s) from the camera to the shopping list, structuring in progress.`;
        },
    },
};

export default tools;
