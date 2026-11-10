/**
 * Vision helper: one image plus one question to the multimodal model served by
 * the same llama.cpp router. `fetch` is stubbed, so the suite pins the request
 * contract (model id, content parts, greedy decoding) and the degenerate paths
 * — the router refusing the id, an answer without a choice, an unreachable
 * server — which must all yield an empty string instead of breaking the turn.
 */

// `uuid` v13 is ESM-only and Jest does not transform node_modules: stub it so
// the LLM module can be imported.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

// The activity log writes to Mongo; the helper only has to call it.
jest.mock('../manager/services/activities', () => ({
    log: async () => {},
    recordActivity: async () => {},
}));

import { describeImage, visionHost, visionModel } from './llm';

/** A one-pixel PNG, i.e. what a camera snapshot produces. */
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

interface Call {
    url: string;
    body: any;
}

/** A router answer carrying `content` (+ the parts the caller inspects). */
function answered(content: string | null) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { role: 'assistant', content } }],
        }),
    } as any;
}

describe('describeImage', () => {
    const realFetch = global.fetch;
    let calls: Call[];
    let responses: any[];

    beforeEach(() => {
        calls = [];
        responses = [];
        global.fetch = (async (url: any, init: any) => {
            calls.push({ url: String(url), body: JSON.parse(init.body) });
            return responses.shift() ?? answered('ok');
        }) as any;
    });

    afterAll(() => {
        global.fetch = realFetch;
    });

    test('asks the router for the vision model with the image, then the prompt', async () => {
        responses = [answered('  Une cuisine ensoleillée.  ')];

        const text = await describeImage(IMAGE, 'Que vois-tu ?');

        expect(text).toBe('Une cuisine ensoleillée.');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(
            `http://${visionHost()}/v1/chat/completions`
        );
        expect(calls[0].body.model).toBe('qwen3vl-4b');
        expect(calls[0].body.model).toBe(visionModel());
        expect(calls[0].body.tools).toEqual([]);
        expect(calls[0].body.temperature).toBe(0);
        expect(calls[0].body.messages[0].content).toEqual([
            { type: 'image_url', image_url: { url: IMAGE } },
            { type: 'text', text: 'Que vois-tu ? (ALWAYS ANSWER IN FRENCH)' },
        ]);
    });

    test('uses a default question, in the brain language, when none is given', async () => {
        const snapshot = 'http://homeassistant:8123/api/camera_proxy/camera.salon';

        await describeImage(snapshot);

        const parts = calls[0].body.messages[0].content;
        expect(parts[0]).toEqual({
            type: 'image_url',
            image_url: { url: snapshot },
        });
        expect(parts[1].text).toMatch(/\(ALWAYS ANSWER IN [A-Z]+\)$/);
    });

    test('retries without the model when the router refuses the id', async () => {
        responses = [
            {
                ok: false,
                status: 404,
                json: async () => ({ error: 'model not found' }),
            } as any,
            answered('Un salon avec un canapé.'),
        ];

        await expect(describeImage(IMAGE)).resolves.toBe(
            'Un salon avec un canapé.'
        );
        expect(calls.map((c) => c.body.model)).toEqual([
            'qwen3vl-4b',
            undefined,
        ]);
    });

    test('returns an empty string when the answer carries no choice', async () => {
        responses = [{ ok: true, status: 200, json: async () => ({}) } as any];

        await expect(describeImage(IMAGE)).resolves.toBe('');
    });

    test('returns an empty string when the router cannot be reached', async () => {
        global.fetch = (async () => {
            throw new Error('ECONNREFUSED');
        }) as any;

        await expect(describeImage(IMAGE)).resolves.toBe('');
    });
});
