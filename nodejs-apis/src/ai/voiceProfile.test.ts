import {
    addSample,
    advanceToSample,
    audioStats,
    beginRegistration,
    BASE_SAMPLE_COUNT,
    clearPending,
    ENROLLMENT_SENTENCES,
    EnrollmentReport,
    EXTRA_SENTENCES,
    extractName,
    getPending,
    getSamples,
    isAbortPhrase,
    markRejectedSample,
    MAX_ENROLLMENT_SAMPLES,
    MIN_SAMPLE_BYTES,
    nextStep,
    popSample,
    sentenceFor,
} from './voiceProfile';

/** PCM16 16 kHz mono sine wave (`seconds` long) at `amplitude` (0..1). */
function tone(seconds: number, amplitude = 0.5): Buffer {
    const sampleCount = Math.round(16000 * seconds);
    const pcm = Buffer.alloc(sampleCount * 2);
    for (let index = 0; index < sampleCount; index++) {
        const value = Math.round(Math.sin(index / 12) * 32767 * amplitude);
        pcm.writeInt16LE(value, index * 2);
    }
    return pcm;
}

/** An enrolment report with sensible defaults for the step tests. */
function report(overrides: Partial<EnrollmentReport>): EnrollmentReport {
    return {
        status: 'low_confidence',
        accepted: false,
        committed: false,
        samples: 3,
        ...overrides,
    };
}

describe('voiceProfile.extractName', () => {
    test('strips common French lead-ins', () => {
        expect(extractName("je m'appelle Quentin")).toBe('Quentin');
        expect(extractName('je me nomme Marie')).toBe('Marie');
        expect(extractName('mon nom est Paul')).toBe('Paul');
        expect(extractName("moi c'est Sophie")).toBe('Sophie');
        expect(extractName("c'est Julie")).toBe('Julie');
    });

    test('keeps a bare name and preserves accents/casing', () => {
        expect(extractName('Quentin')).toBe('Quentin');
        expect(extractName('quentin')).toBe('Quentin');
        expect(extractName('je suis Léa')).toBe('Léa');
    });

    test('returns undefined when there is no name', () => {
        expect(extractName("je m'appelle")).toBeUndefined();
        expect(extractName('')).toBeUndefined();
    });
});

describe('voiceProfile enrolment sentences', () => {
    test('three base sentences, then phonetic extras', () => {
        expect(ENROLLMENT_SENTENCES).toHaveLength(3);
        expect(BASE_SAMPLE_COUNT).toBe(3);
        expect(sentenceFor(0)).toBe(ENROLLMENT_SENTENCES[0]);
        expect(sentenceFor(1)).toBe(ENROLLMENT_SENTENCES[1]);
        expect(sentenceFor(2)).toBe(ENROLLMENT_SENTENCES[2]);
        // The third one is the held-out verification sentence.
        expect(sentenceFor(2)).toMatch(/identité/);
        expect(sentenceFor(3)).toBe(EXTRA_SENTENCES[0]);
        expect(sentenceFor(4)).toBe(EXTRA_SENTENCES[1]);
        // Never crash on an out-of-range index.
        expect(sentenceFor(-1)).toBe(ENROLLMENT_SENTENCES[0]);
        expect(sentenceFor(99)).toBe(
            EXTRA_SENTENCES[(99 - BASE_SAMPLE_COUNT) % EXTRA_SENTENCES.length]
        );
    });
});

describe('voiceProfile.audioStats', () => {
    test('rejects silence and too-short recordings', () => {
        expect(audioStats(Buffer.alloc(0)).usable).toBe(false);
        expect(audioStats(Buffer.alloc(16000 * 2)).usable).toBe(false);
        expect(audioStats(Buffer.alloc(16000 * 2 * 2)).usable).toBe(false);
    });

    test('accepts a loud, long-enough sentence', () => {
        const stats = audioStats(tone(2));
        expect(stats.usable).toBe(true);
        expect(stats.seconds).toBeCloseTo(2, 1);
        expect(stats.rms).toBeGreaterThan(0.01);
        expect(tone(2).length).toBeGreaterThanOrEqual(MIN_SAMPLE_BYTES);
    });

    test('accepts a quiet echo-level capture', () => {
        // The echo microphone records around -44 dBFS: the client-side gate
        // must stay well below the profiler's authoritative level gate.
        const stats = audioStats(tone(2, 0.006));
        expect(stats.rms).toBeGreaterThan(0.002);
        expect(stats.usable).toBe(true);
    });
});

describe('voiceProfile.nextStep', () => {
    test('finishes when the profile is accepted', () => {
        expect(
            nextStep(report({ accepted: true, status: 'success' }), 3)
        ).toBe('done');
    });

    test('asks for the same sentence when the recording is rejected', () => {
        expect(
            nextStep(report({ status: 'rejected', reason: 'silent' }), 3)
        ).toBe('retry');
    });

    test('asks for a rescue sentence until the sample budget is spent', () => {
        expect(nextStep(report({}), 3)).toBe('more');
        expect(nextStep(report({}), MAX_ENROLLMENT_SAMPLES - 1)).toBe('more');
        expect(nextStep(report({}), MAX_ENROLLMENT_SAMPLES)).toBe('abort');
    });

    test('gives up when the profiler is unreachable', () => {
        expect(nextStep(undefined, 3)).toBe('abort');
    });
});

describe('voiceProfile.isAbortPhrase', () => {
    test('recognises cancellation', () => {
        expect(isAbortPhrase('annule')).toBe(true);
        expect(isAbortPhrase('Annule s il te plait')).toBe(true);
        expect(isAbortPhrase('laisse tomber')).toBe(true);
        expect(isAbortPhrase('pas maintenant')).toBe(true);
    });

    test('does not mistake a sentence for a cancellation', () => {
        expect(isAbortPhrase('')).toBe(false);
        expect(isAbortPhrase('bonjour')).toBe(false);
        expect(
            isAbortPhrase(
                "Bonjour Charlie, j'active mon profil vocal aujourd'hui."
            )
        ).toBe(false);
    });
});

describe('voiceProfile pending registration', () => {
    const session = 'session-test';

    beforeEach(() => {
        clearPending(session);
    });

    test('walks through the name -> sample phases', () => {
        expect(getPending(session)).toBeUndefined();

        beginRegistration(session);
        expect(getPending(session)?.phase).toBe('name');
        expect(getPending(session)?.samples).toEqual([]);

        advanceToSample(session, 'Quentin');
        expect(getPending(session)?.phase).toBe('sample');
        expect(getPending(session)?.name).toBe('Quentin');
        expect(getPending(session)?.samples).toEqual([]);
    });

    test('accumulates samples in order and can drop the last one', () => {
        beginRegistration(session);
        advanceToSample(session, 'Quentin');

        const first = tone(2);
        const second = tone(2.5);
        expect(addSample(session, first)).toBe(1);
        expect(addSample(session, second)).toBe(2);
        expect(getSamples(session)).toEqual([first, second]);

        popSample(session);
        expect(getSamples(session)).toEqual([first]);
    });

    test('a successful sample resets the rejection counter', () => {
        beginRegistration(session);
        advanceToSample(session, 'Quentin');

        expect(markRejectedSample(session)).toBe(1);
        expect(markRejectedSample(session)).toBe(2);
        expect(addSample(session, tone(2))).toBe(1);
        expect(getPending(session)?.rejections).toBe(0);
        expect(markRejectedSample(session)).toBe(1);
    });

    test('expires after the TTL, refreshed by each recorded sample', () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
            beginRegistration(session);
            jest.advanceTimersByTime(29000);
            expect(getPending(session)).toBeDefined();

            addSample(session, tone(2));
            jest.advanceTimersByTime(29000);
            expect(getPending(session)).toBeDefined();

            jest.advanceTimersByTime(2000);
            expect(getPending(session)).toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });

    test('ignores an empty session id', () => {
        beginRegistration('');
        expect(getPending('')).toBeUndefined();
        expect(getSamples('')).toEqual([]);
        expect(addSample('', tone(2))).toBe(0);
    });

    test('clearPending drops everything, including the samples', () => {
        beginRegistration(session);
        advanceToSample(session, 'Quentin');
        addSample(session, tone(2));

        clearPending(session);
        expect(getPending(session)).toBeUndefined();
        expect(getSamples(session)).toEqual([]);
    });
});
