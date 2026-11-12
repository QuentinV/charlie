/**
 * Pure helpers of the vision module: the classifier catalogue/schema, the prompt
 * rendering and the tolerant answer parsing. No model, no database — the
 * pipeline tests (Phase 2) stub those.
 */
import {
    UNKNOWN_TYPE,
    answerType,
    asNumber,
    asString,
    buildDetectPrompt,
    buildExtractPrompt,
    classifierSchema,
    durationSeconds,
    parseJsonAnswer,
    positiveNumber,
} from '../logic';

describe('scalar readers', () => {
    test('asString trims and rejects non-strings', () => {
        expect(asString('  farine ')).toBe('farine');
        expect(asString('   ')).toBeUndefined();
        expect(asString(6)).toBeUndefined();
        expect(asString(null)).toBeUndefined();
    });

    test('asNumber accepts the model’s string numbers', () => {
        expect(asNumber(6)).toBe(6);
        expect(asNumber('6')).toBe(6);
        expect(asNumber('1,5')).toBe(1.5);
        expect(asNumber('1 h 30')).toBeUndefined();
        expect(asNumber(NaN)).toBeUndefined();
    });

    test('positiveNumber turns the "the image does not say" 0 into an absence', () => {
        expect(positiveNumber(500)).toBe(500);
        expect(positiveNumber(0)).toBeUndefined();
        expect(positiveNumber(-2)).toBeUndefined();
        expect(positiveNumber(undefined)).toBeUndefined();
    });

    test('durationSeconds keeps plausible durations and drops the absurd', () => {
        expect(durationSeconds(900)).toBe(900);
        expect(durationSeconds('5400')).toBe(5400);
        expect(durationSeconds(0)).toBe(0);
        expect(durationSeconds(-5)).toBe(0);
        // 30 h is a misread, not a cooking time.
        expect(durationSeconds(30 * 60 * 60)).toBe(0);
        expect(durationSeconds(undefined)).toBe(0);
    });
});

describe('parseJsonAnswer', () => {
    test('reads a plain JSON object', () => {
        expect(parseJsonAnswer('{"type":"recipe"}')).toEqual({
            type: 'recipe',
        });
    });

    test('reads through a code fence and around prose', () => {
        expect(
            parseJsonAnswer('```json\n{"type": "recipe"}\n```')
        ).toEqual({ type: 'recipe' });
        expect(
            parseJsonAnswer('Voici le résultat : {"type": "recipe"} voilà.')
        ).toEqual({ type: 'recipe' });
    });

    test('returns undefined when nothing parses', () => {
        expect(parseJsonAnswer('aucun objet ici')).toBeUndefined();
        expect(parseJsonAnswer('')).toBeUndefined();
        expect(parseJsonAnswer(null)).toBeUndefined();
    });
});

describe('classifier', () => {
    const catalogue = [
        { id: 'recipe', hint: 'A cooking recipe.' },
        { id: 'receipt', hint: 'A shop till receipt.' },
    ];

    test('the schema is a closed enum of the declared types plus unknown', () => {
        expect(classifierSchema(catalogue.map((m) => m.id))).toEqual({
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['recipe', 'receipt', UNKNOWN_TYPE] },
            },
            required: ['type'],
        });
    });

    test('the prompt lists every declared type and the escape hatch', () => {
        const prompt = buildDetectPrompt(catalogue);
        expect(prompt).toContain('- recipe: A cooking recipe.');
        expect(prompt).toContain('- receipt: A shop till receipt.');
        expect(prompt).toContain(`- ${UNKNOWN_TYPE}: anything else`);
        // The fallback must never be proposed.
        expect(prompt).not.toContain('generic');
    });

    test('answerType only accepts a declared type, case-insensitively', () => {
        const ids = ['recipe', 'receipt'];
        expect(answerType({ type: 'recipe' }, ids)).toBe('recipe');
        expect(answerType({ type: 'RECIPE' }, ids)).toBe('recipe');
        expect(answerType({ type: 'invoice' }, ids)).toBe(UNKNOWN_TYPE);
        expect(answerType({ type: 42 }, ids)).toBe(UNKNOWN_TYPE);
        expect(answerType('recipe', ids)).toBe(UNKNOWN_TYPE);
    });
});

describe('buildExtractPrompt', () => {
    test('appends the schema rendered from the module, never a hand-written one', () => {
        const schema = {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
        };
        const prompt = buildExtractPrompt({ prompt: 'Read the recipe.', schema });

        expect(prompt.startsWith('Read the recipe.')).toBe(true);
        expect(prompt).toContain('JSON schema:');
        expect(prompt).toContain(JSON.stringify(schema, null, 2));
    });
});
