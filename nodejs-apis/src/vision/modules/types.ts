/**
 * Contract of a vision module: one *document type* Charlie understands.
 *
 * Adding a type = adding a file in this folder whose default export is a
 * `VisionModule` (and one line in `modules/index.ts`). Everything else derives
 * from the registry: the classifier's closed enum, the catalogue shown to the
 * model and to the UI's type picker, the extraction JSON schema, the prompts.
 *
 * A module owns its vocabulary (units, fields, rules) but never the transport:
 * the multimodal calls live in `ai/llm.ts` (`visionJson`) and the pipeline in
 * `vision/index.ts`, exactly like the HA device support owns domain tables while
 * the provider layer owns the gateway calls.
 */
import { ToolExecutionContext } from '../../types';

/** Runtime context handed to a module (recognized user, session, scan). */
export interface VisionContext extends ToolExecutionContext {
    /** Id of the scan the module is working on (for answers/messages). */
    scanId?: string;
}

/**
 * One follow-up a stored result offers: a UI button, an MCP tool, a spoken
 * confirmation. `run` returns the sentence the brain reports (English, like
 * every tool answer: the LLM turns it into the user's language).
 */
export interface VisionAction<T = any> {
    id: string;
    label: string;
    run: (data: T, ctx?: VisionContext) => Promise<string | void | boolean>;
}

export interface VisionModule<T = any> {
    /** Stable id: the classifier's value, the Mongo `type` and the UI key. */
    id: string;
    /** French label (UI, TTS): the documents are household objects. */
    label: string;
    /** English sentence telling the classifier when this module applies. */
    hint: string;
    /** JSON schema of the extraction → constrained decoding. */
    schema: object;
    /**
     * Extraction prompt, in English like the shopping one, with the schema
     * appended by `logic.ts#buildExtractPrompt`. It carries the module's own
     * rules (units, defaults, what must never be invented).
     */
    prompt: string;
    /**
     * Tolerant validation of the model answer (Zod + evidence rules): the
     * module's data, or `null` when the answer is unusable. Must never throw —
     * a bad answer is a failed scan, not a crashed request.
     */
    parse: (raw: unknown) => T | null;
    /** French one-liner describing a result (TTS, list rows). */
    summarize?: (data: T) => string;
    /** Optional follow-ups (a scanned recipe → the household recipe library). */
    actions?: VisionAction<T>[];
    /** Upper bound on the answer (a recipe is longer than a business card). */
    maxTokens?: number;
    /**
     * Fallback module: what `unknown` resolves to (a free description). Never
     * proposed to the classifier.
     */
    fallback?: boolean;
}
