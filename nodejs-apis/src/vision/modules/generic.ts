/**
 * Fallback module: the document matched no type, so Charlie describes it.
 *
 * It is the `unknown` branch of the classifier (never proposed to it) and the
 * module behind a plain "qu'est-ce que c'est ?" — the answer is prose, stored
 * like any other result so the UI stays uniform.
 */
import { asString } from '../logic';
import { VisionModule } from './types';

export interface GenericVisionData {
    description: string;
}

export const GENERIC_SCHEMA = {
    type: 'object',
    properties: { description: { type: 'string' } },
    required: ['description'],
};

const generic: VisionModule<GenericVisionData> = {
    id: 'generic',
    label: 'Description',
    hint: 'Anything that is not one of the other document types.',
    fallback: true,
    schema: GENERIC_SCHEMA,
    prompt: [
        'Describe the document or the object on the image, for someone who cannot see it.',
        'Reply ONLY with the JSON object, no text around it.',
        'Rules:',
        '- description: three sentences maximum, in the language of the document.',
        '- Say what it is, then the useful content (names, amounts, dates).',
        '- Never invent a detail that is not visible.',
    ].join('\n'),
    maxTokens: 220,
    parse(raw) {
        const description = asString((raw as any)?.description);
        return description ? { description } : null;
    },
    summarize: (data) => data.description,
};

export default generic;
