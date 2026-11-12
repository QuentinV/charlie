/**
 * Phase 1 of a scan: which document type is on the image.
 *
 * One call carrying the registry catalogue and a closed enum of the module ids.
 * Measured (Qwen3-VL-4B, CPU): ~36 s for the first call on an image, 5 s once
 * the router's prompt cache holds it — the extraction call of the same scan
 * therefore reuses the encoded image.
 *
 * `unknown` is a legitimate answer, not a failure: it resolves to the fallback
 * module, which describes the image instead of pretending it is a recipe.
 */
import { visionJson } from '../ai/llm';
import {
    UNKNOWN_TYPE,
    answerType,
    buildDetectPrompt,
    classifierSchema,
    parseJsonAnswer,
} from './logic';
import { classifierModules, fallbackModule, getVisionModule } from './modules';
import { VisionModule } from './modules/types';

export interface Detection {
    module: VisionModule<any>;
    /** `detected` when the classifier chose, `forced` when the caller named it. */
    source: 'detected' | 'forced';
    /** Raw classifier answer, kept on the scan for prompt debugging. */
    raw?: string;
}

/**
 * The module named by a caller (UI chip, MCP tool arg, "scan a receipt"): no
 * classifier call at all, which is both faster and exact.
 */
export function forcedModule(type?: string): VisionModule<any> | undefined {
    const id = (type ?? '').trim();
    if (!id) return undefined;
    if (id === UNKNOWN_TYPE) return fallbackModule();
    return getVisionModule(id);
}

export interface DetectOptions {
    host?: string;
    model?: string;
}

/** Ask the multimodal model which document type the image holds. */
export async function detectType(
    image: string,
    options?: DetectOptions
): Promise<Detection> {
    const modules = classifierModules();
    const answer = await visionJson(image, {
        prompt: buildDetectPrompt(modules),
        schema: classifierSchema(modules.map((m) => m.id)),
        schemaName: 'document_type',
        // One enum value: a short JSON object is the whole answer.
        maxTokens: 16,
        ...options,
    });

    const type = answerType(
        parseJsonAnswer(answer),
        modules.map((m) => m.id)
    );

    return {
        module: getVisionModule(type) ?? fallbackModule(),
        source: 'detected',
        raw: typeof answer === 'string' ? answer : undefined,
    };
}
