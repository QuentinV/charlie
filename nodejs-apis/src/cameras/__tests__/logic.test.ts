/**
 * Cameras module — the pure helpers (event parsing, grocery answers).
 */
import {
    buildGroceryPrompt,
    describeRequestFromBody,
    groceryItemsFromAnswer,
    looksDegenerate,
    visionEventFromBody,
} from '../logic';

describe('visionEventFromBody', () => {
    it('normalizes a valid event', () => {
        const e = visionEventFromBody({
            cameraId: 'cam1',
            kind: 'enter',
            classes: ['person', 42],
            modes: ['presence', 'commands', 7],
            at: 1234,
            trackId: 7,
        });
        expect(e).toMatchObject({
            cameraId: 'cam1',
            kind: 'enter',
            classes: ['person'],
            modes: ['presence', 'commands'],
            at: 1234,
            trackId: 7,
        });
    });

    it('rejects an event without a camera id', () => {
        expect(visionEventFromBody({ kind: 'motion' })).toBeNull();
        expect(visionEventFromBody(null)).toBeNull();
        expect(visionEventFromBody('nope')).toBeNull();
    });

    it('falls back to motion, no mode and Date.now() on a partial body', () => {
        const e = visionEventFromBody({ cameraId: 'cam1', kind: 'nope' })!;
        expect(e.kind).toBe('motion');
        expect(e.classes).toEqual([]);
        expect(e.modes).toEqual([]);
        expect(typeof e.at).toBe('number');
    });

    it('carries an escalation result when present', () => {
        const e = visionEventFromBody({
            cameraId: 'cam1',
            vlm: { tier: 'heavy', text: 'un chat sur le plan de travail' },
            keyframeUrl: '/api/vision/keyframes/abc.jpg',
        })!;
        expect(e.vlm).toEqual({
            tier: 'heavy',
            text: 'un chat sur le plan de travail',
        });
        expect(e.keyframeUrl).toBe('/api/vision/keyframes/abc.jpg');
    });

    it('drops a malformed escalation result', () => {
        const e = visionEventFromBody({ cameraId: 'cam1', vlm: { tier: 'fast' } })!;
        expect(e.vlm).toBeUndefined();
    });
});

describe('describeRequestFromBody', () => {
    it('requires an image', () => {
        expect(describeRequestFromBody({ prompt: 'x' })).toBeNull();
        expect(describeRequestFromBody(null)).toBeNull();
    });

    it('returns the trimmed image and the optional prompt', () => {
        expect(
            describeRequestFromBody({ image: ' data:image/jpeg;base64,AA ' })
        ).toEqual({ image: 'data:image/jpeg;base64,AA', prompt: undefined });
        expect(
            describeRequestFromBody({ image: 'http://x/a.jpg', prompt: 'p' })
        ).toEqual({ image: 'http://x/a.jpg', prompt: 'p' });
    });
});

describe('grocery answer parsing', () => {
    it('keeps trimmed, de-duplicated item names', () => {
        expect(
            groceryItemsFromAnswer({ items: [' Lait ', 'lait', 'Œufs', 42, ''] })
        ).toEqual(['Lait', 'Œufs']);
    });

    it('never invents: a wrong shape yields nothing', () => {
        expect(groceryItemsFromAnswer(undefined)).toEqual([]);
        expect(groceryItemsFromAnswer({ items: 'lait' })).toEqual([]);
        expect(groceryItemsFromAnswer({})).toEqual([]);
    });

    it('builds a prompt that forbids invention and carries the hint', () => {
        expect(buildGroceryPrompt()).toMatch(/never invent/i);
        expect(buildGroceryPrompt('the top shelf')).toContain('the top shelf');
    });
});

describe('looksDegenerate', () => {
    it('accepts a real description', () => {
        expect(
            looksDegenerate(
                'Une personne se tient devant le réfrigérateur ouvert, dans une cuisine sombre.'
            )
        ).toBe(false);
    });

    it('accepts a legitimate repetition', () => {
        expect(
            looksDegenerate(
                'Une voiture rouge, puis une voiture bleue, et enfin une voiture verte devant la maison'
            )
        ).toBe(false);
    });

    it('rejects a word looping — captured live from the fast model', () => {
        expect(
            looksDegenerate(
                "C'est une caméra qui est déjà déjà déjà déjà déjà déjà déjà déjà déjà déjà déjà déjà"
            )
        ).toBe(true);
    });

    it('rejects a phrase looping', () => {
        expect(
            looksDegenerate(
                'le chat est noir le chat est noir le chat est noir le chat est noir'
            )
        ).toBe(true);
    });

    it('rejects fluent nonsense that reuses its own phrases — captured live', () => {
        expect(
            looksDegenerate(
                "C'est un film de l'animal, qui est enfant, et qui est enfant de l'animal. C'est un film de l'animal qui est enfant de l'animal."
            )
        ).toBe(true);
    });

    it('accepts a sentence that only looks repetitive', () => {
        expect(
            looksDegenerate(
                'Un homme marche vers la porte, une femme marche vers la fenêtre, un chien marche vers le jardin.'
            )
        ).toBe(false);
    });

    it('does not judge an answer too short to be a loop', () => {
        expect(looksDegenerate('')).toBe(false);
        expect(looksDegenerate('déjà déjà')).toBe(false);
        expect(looksDegenerate('un chat sur le canapé')).toBe(false);
    });
});
