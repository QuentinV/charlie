/**
 * Phase 2 of a scan: the content of the document, extracted with the schema of
 * the resolved module.
 *
 * The grammar does the first half of the containment — a unit or an enum value
 * outside the module's vocabulary is *impossible to emit* under
 * `response_format: json_schema` — and the module's `parse` does the second half,
 * the semantic rules a grammar cannot express (a unit with no quantity, a
 * missing duration, an unusable answer).
 */
import { visionJson } from '../ai/llm';
import { buildExtractPrompt, parseJsonAnswer } from './logic';
import { VisionModule } from './modules/types';

export interface Extraction<T = any> {
    data: T;
    /** Raw model answer, stored on the scan for prompt debugging. */
    raw: string;
}

export interface ExtractOptions {
    host?: string;
    model?: string;
}

/** Extract and validate a document. Throws with a human message when unusable. */
export async function extractDocument<T>(
    module: VisionModule<T>,
    image: string,
    options?: ExtractOptions
): Promise<Extraction<T>> {
    const answer = await visionJson(image, {
        prompt: buildExtractPrompt(module),
        schema: module.schema,
        schemaName: module.id,
        ...(module.maxTokens ? { maxTokens: module.maxTokens } : {}),
        ...options,
    });

    if (typeof answer !== 'string') {
        throw new Error('the vision model did not answer');
    }

    const raw = parseJsonAnswer(answer);
    const data = raw === undefined ? null : module.parse(raw);
    if (!data) {
        throw new Error(`the model answer is not a usable ${module.id}`);
    }

    return { data, raw: answer };
}
