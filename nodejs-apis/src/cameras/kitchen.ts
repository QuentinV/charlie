/**
 * Fridge / pantry: a camera whose selection includes the `grocery` mode puts
 * what it sees on the shopping list when someone stays in front of it.
 *
 * Brain-side on purpose — `vision-feed` is a sensor and holds no home policy, so
 * the feed only reports the event; deciding that an arrival becomes groceries,
 * and reading the frame it carries, is the brain's business. The image is the
 * event's **own keyframe** when it has one (that works for every source kind,
 * webcam and RTSP included), else a fresh snapshot for the http sources. The
 * items go through the single ingestion point (`addRequests`), raw first: the
 * background restructurer turns them into lines exactly as it does for a spoken
 * request. The on-demand MCP tool shares this code, so there is one path.
 */
import { visionJson } from '../ai/llm';
import { log } from '../manager/services/activities';
import { addRequests } from '../skills/shopping/list';
import { scheduleRestructure, shoppingEnabled } from '../skills/shopping/restructure';
import { Device, Provider, VisionEvent, VisionEventKind } from '../types';
import { parseJsonAnswer } from '../vision/logic';
import { loadCamera } from './index';
import { readKeyframe } from './keyframes';
import {
    GROCERY_ITEMS_SCHEMA,
    buildGroceryPrompt,
    groceryItemsFromAnswer,
} from './logic';
import { VisionMode, visionGrocery, visionModesOf } from './modes';
import { fetchSnapshot } from './snapshot';

/** The kinds worth looking at: the moment someone arrives or settles. */
const GROCERY_KINDS: VisionEventKind[] = ['enter', 'dwell', 'appear'];

/** A fridge is looked at, not spammed: default gap between two looks. */
export const DEFAULT_GROCERY_COOLDOWN_S = 60;

/** Last look per camera (in-memory: a restart only costs one extra look). */
const lastRun: { [cameraId: string]: number } = {};

/**
 * Pure: the mode that asks for a look at the shelves, or undefined. The camera
 * must have selected a mode flagged `grocery`, the event must be an arrival **of
 * a class that mode watches** (a fridge camera may also watch the cat), and the
 * previous look must be older than the mode's cooldown.
 */
export function groceryDue(
    event: VisionEvent,
    modes: VisionMode[],
    lastLookAt: number | undefined,
    now: number
): VisionMode | undefined {
    if (!GROCERY_KINDS.includes(event.kind)) return undefined;

    const mode = visionGrocery(modes);
    if (!mode) return undefined;

    const seen = event.classes.map((cls) => cls.toLowerCase());
    if (
        mode.classes.length &&
        !mode.classes.some((cls) => seen.includes(cls.toLowerCase()))
    ) {
        return undefined;
    }

    const cooldownMs = (mode.cooldownS ?? DEFAULT_GROCERY_COOLDOWN_S) * 1000;
    if (lastLookAt !== undefined && now - lastLookAt < cooldownMs) {
        return undefined;
    }
    return mode;
}

/**
 * The event's own keyframe (any source kind), else a fresh snapshot (http
 * sources only). `undefined` when neither is available — a webcam without
 * escalation cannot be looked at on demand.
 */
export async function eventImage(
    event: VisionEvent,
    device: Device,
    provider?: Provider | null
): Promise<string | undefined> {
    const name = event.keyframeUrl?.split('/').pop();
    if (name) {
        const bytes = readKeyframe(name);
        if (bytes) return `data:image/jpeg;base64,${bytes.toString('base64')}`;
    }
    return fetchSnapshot(device, provider);
}

/**
 * Look at one image and append the groceries it shows. Never invents: an answer
 * that is not `{ items: string[] }` adds nothing. Returns the added names.
 */
export async function addGroceryItemsFromImage(
    image: string,
    hint?: string,
    user?: string
): Promise<string[]> {
    const answer = await visionJson(image, {
        prompt: buildGroceryPrompt(hint),
        schema: GROCERY_ITEMS_SCHEMA,
        schemaName: 'grocery_items',
        maxTokens: 256,
    });
    const items = groceryItemsFromAnswer(parseJsonAnswer(answer));
    if (!items.length) return [];

    await addRequests(items, 'camera', user);
    scheduleRestructure();
    return items;
}

/**
 * A vision event arrived: look at the shelves when the camera's modes ask for
 * it. Never throws and never blocks the event path — the caller does not await
 * it.
 */
export async function onVisionEvent(event: VisionEvent): Promise<void> {
    try {
        // The cheap gates first: an arrival on a camera that never asks for a
        // look costs no DB read at all.
        if (!GROCERY_KINDS.includes(event.kind)) return;
        if (!shoppingEnabled()) return;

        const loaded = await loadCamera(event.cameraId);
        if (!loaded) return;

        const mode = groceryDue(
            event,
            visionModesOf(loaded.device.properties?.visionModes),
            lastRun[event.cameraId],
            Date.now()
        );
        if (!mode) return;

        const image = await eventImage(event, loaded.device, loaded.provider);
        if (!image) return;

        // Record the look before the model call: a slow VLM must not let a
        // second event through the cooldown.
        lastRun[event.cameraId] = Date.now();
        const items = await addGroceryItemsFromImage(image, mode.label);
        if (!items.length) return;

        await log(
            'vision-feed',
            `fridge: ${items.length} article(s) added to the shopping list`,
            {
                context: {
                    cameraId: event.cameraId,
                    mode: mode.id,
                    items,
                },
            }
        );
    } catch (e) {
        // A broken flow must never lose the event it was derived from.
        await log('vision-feed', 'fridge flow failed', {
            data: { error: String(e) },
        });
    }
}
