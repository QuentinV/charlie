import {
    applyDelta,
    isRelativeLevel,
    NUANCE_STEPS,
    nuanceDelta,
    signedLevel,
} from './devices.logic';

describe('devices.logic — partial moves', () => {
    describe('nuanceDelta', () => {
        test('a nuance becomes a SIGNED change: opening +, closing -', () => {
            expect(nuanceDelta('open', 'slightly')).toBe(NUANCE_STEPS.slightly);
            expect(nuanceDelta('close', 'slightly')).toBe(
                -NUANCE_STEPS.slightly
            );
            expect(nuanceDelta('open', 'strongly')).toBe(NUANCE_STEPS.strongly);
            expect(nuanceDelta('close', 'strongly')).toBe(
                -NUANCE_STEPS.strongly
            );
        });

        test('no nuance -> no relative change (a plain full move)', () => {
            expect(nuanceDelta('open', undefined)).toBeUndefined();
            expect(nuanceDelta('close', '')).toBeUndefined();
            expect(nuanceDelta('close', 'unknown-word')).toBeUndefined();
        });

        test('a direction that is neither open nor close has no delta', () => {
            expect(nuanceDelta('all', 'slightly')).toBeUndefined();
            expect(nuanceDelta('onoff', 'slightly')).toBeUndefined();
        });
    });

    describe('applyDelta', () => {
        test('shifts the current level and clamps to 0..100', () => {
            expect(applyDelta(100, -10)).toBe(90);
            expect(applyDelta(20, 40)).toBe(60);
            expect(applyDelta(5, -40)).toBe(0);
            expect(applyDelta(95, 40)).toBe(100);
        });

        test('rounds a fractional level', () => {
            expect(applyDelta(33.4, 10)).toBe(43);
        });
    });

    describe('signedLevel / isRelativeLevel', () => {
        test('signedLevel renders the sign the action reads back', () => {
            expect(signedLevel(10)).toBe('+10');
            expect(signedLevel(-40)).toBe('-40');
            expect(signedLevel(0)).toBe('+0');
        });

        test('isRelativeLevel tells a move-by from an absolute target', () => {
            expect(isRelativeLevel('-10')).toBe(true);
            expect(isRelativeLevel('+10')).toBe(true);
            expect(isRelativeLevel('50')).toBe(false);
            expect(isRelativeLevel(undefined)).toBe(false);
            expect(isRelativeLevel('')).toBe(false);
        });
    });
});
