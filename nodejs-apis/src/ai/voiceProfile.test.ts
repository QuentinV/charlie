import {
    advanceToSample,
    beginRegistration,
    clearPending,
    extractName,
    getPending,
} from './voiceProfile';

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

describe('voiceProfile pending registration', () => {
    test('walks through the name → sample phases', () => {
        const session = 'session-test';
        clearPending(session);
        expect(getPending(session)).toBeUndefined();

        beginRegistration(session);
        expect(getPending(session)?.phase).toBe('name');

        advanceToSample(session, 'Quentin');
        expect(getPending(session)?.phase).toBe('sample');
        expect(getPending(session)?.name).toBe('Quentin');

        clearPending(session);
        expect(getPending(session)).toBeUndefined();
    });

    test('ignores an empty session id', () => {
        beginRegistration('');
        expect(getPending('')).toBeUndefined();
    });
});
