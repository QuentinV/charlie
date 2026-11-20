/**
 * Escalation: a keyframe → a one-line description, **fast model first**.
 *
 * The fast tier (`VISION_FAST_MODEL`, tiny + GPU-offloaded) answers the common
 * case; the heavy Qwen3-VL is only asked when the fast one has nothing useful to
 * say. There is **no setting** for that order: it is what makes escalating every
 * interesting event affordable, so it is not a knob — forcing the heavy model is
 * a deployment choice (`VISION_FAST_MODEL` unset). The keyframe is stored (and
 * rotated) so the event keeps a visual trace.
 * This is the only place that knows the model *choice* — the transport stays in
 * `ai/llm.ts`, exactly like the document pipeline.
 */
import { describeImage, fastVisionModel, visionModel } from '../ai/llm';
import { keyframeId, rotateKeyframes, saveKeyframe } from './keyframes';
import { looksDegenerate } from './logic';

/** Prompt used when the caller sends none (French, like the voice answers). */
export const DEFAULT_DESCRIBE_PROMPT =
    'Décris en une phrase ce qui se passe sur cette image de caméra (personnes, animaux, objets).';

/** Public API base path, hardcoded so this module never imports `swagger.ts`
 *  (which imports the whole route table — a cycle). */
const API_PATH = '/api/';

export interface DescribeResult {
    text: string;
    tier: 'fast' | 'heavy' | 'none';
    keyframeId?: string;
    keyframeUrl?: string;
}

/**
 * Keyframes kept on disk. Deliberately **not** a setting: rotation is
 * housekeeping, and a hundred one-frame JPEGs is what a year of interesting
 * events costs — far below what the volume holds. (A scan's retention *is* a
 * setting, `vision.keepScans`: a scan is user data, an event keyframe is not.)
 */
export const KEYFRAMES_KEPT = 100;

/** Decode a `data:` URL; undefined for anything else (http URLs pass through). */
function decodeDataUrl(image: string): Buffer | undefined {
    const match = image.match(/^data:[^;,]+;base64,(.+)$/);
    return match ? Buffer.from(match[1], 'base64') : undefined;
}

/**
 * Describe a keyframe. The image may be a `data:` URL (decoded and stored on
 * disk) or an http(s) URL (handed to the model as-is, nothing stored).
 */
export async function describeFrame(
    image: string,
    prompt?: string
): Promise<DescribeResult> {
    const p = prompt?.trim() || DEFAULT_DESCRIBE_PROMPT;

    let id: string | undefined;
    const bytes = decodeDataUrl(image);
    if (bytes) {
        id = keyframeId(bytes);
        saveKeyframe(id, bytes);
        rotateKeyframes(KEYFRAMES_KEPT);
    }

    const url = id ? `${API_PATH}vision/keyframes/${id}.jpg` : undefined;

    if (fastVisionModel()) {
        const fast = await describeImage(image, p, undefined, fastVisionModel());
        // A degenerate answer (a 500 M model looping on itself) is not an
        // observation: keep it out of the event and ask the heavy model.
        if (fast && !looksDegenerate(fast)) {
            return { text: fast, tier: 'fast', keyframeId: id, keyframeUrl: url };
        }
    }

    const heavy = await describeImage(image, p, undefined, visionModel());
    if (heavy) {
        return { text: heavy, tier: 'heavy', keyframeId: id, keyframeUrl: url };
    }
    return { text: '', tier: 'none', keyframeId: id, keyframeUrl: url };
}
