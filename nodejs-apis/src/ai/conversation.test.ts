import {
    Conversation,
    ECHO_WAKE_WORDS,
    REGISTRATION_TIMEOUT_MS,
    WEB_WAKE_WORDS,
    expectsFollowUp,
    prefixWakeWords,
    wordWakeWords,
} from './conversation';

describe('conversation wake-word strippers', () => {
    test('prefixWakeWords strips a leading wake word (echo)', () => {
        const strip = prefixWakeWords(ECHO_WAKE_WORDS);
        expect(strip('charlie allume la lumière')).toBe('allume la lumière');
        expect(strip('charlie, allume la lumière')).toBe('allume la lumière');
        expect(strip('charlie ')).toBe('');
        expect(strip('bonjour')).toBeNull();
    });

    test('wordWakeWords strips a wake word anywhere (web)', () => {
        const strip = wordWakeWords(WEB_WAKE_WORDS);
        expect(strip('hey charlie éteins la lumière')).toBe('éteins la lumière');
        expect(strip('charlie, éteins la lumière')).toBe('éteins la lumière');
        expect(strip('charlie')).toBe('');
        expect(strip('allume la lumière')).toBeNull();
        // Longest match wins: "hi charlie" before "hi".
        expect(strip('hi charlie allume')).toBe('allume');
    });
});

describe('expectsFollowUp', () => {
    test('is true only for a question', () => {
        expect(expectsFollowUp('Très bien. Quel est ton nom ?')).toBe(true);
        expect(expectsFollowUp('Ça va ?   ')).toBe(true);
        expect(expectsFollowUp("C'est fait.")).toBe(false);
        expect(
            expectsFollowUp(
                'Merci Marie. Pour enregistrer ta voix, répète après moi : « Bonjour Charlie, je suis prêt. »'
            )
        ).toBe(false);
        expect(expectsFollowUp('')).toBe(false);
    });

    test('is true while a voice-profile registration is pending', () => {
        // The registration prompts are not questions but still expect an
        // answer, so the microphone must stay open.
        expect(expectsFollowUp("C'est fait.", true)).toBe(true);
        expect(expectsFollowUp('répète après moi : « … »', true)).toBe(true);
    });
});

describe('Conversation', () => {
    let clock: number;
    let ended: string[];

    const make = (config = {}) =>
        new Conversation({
            strip: wordWakeWords(WEB_WAKE_WORDS),
            bareWake: 'wake',
            endSession: (id: string) => ended.push(id),
            now: () => clock,
            timeoutMs: 1000,
            ...config,
        });

    beforeEach(() => {
        clock = 1000;
        ended = [];
    });

    test('ignores an utterance with no wake word while idle', () => {
        const c = make();
        const d = c.resolve('allume la lumière');
        expect(d.command).toBeUndefined();
        expect(d.sessionId).toBeUndefined();
        expect(ended).toEqual([]);
    });

    test('wake word + command opens a turn with a session', () => {
        const c = make();
        const d = c.resolve('charlie allume la lumière');
        expect(d.command).toBe('allume la lumière');
        expect(d.inConversation).toBe(false);
        expect(typeof d.sessionId).toBe('string');
    });

    test('bare wake word reports wakeOnly and opens the window', () => {
        const c = make();
        const d = c.resolve('charlie');
        expect(d.wakeOnly).toBe(true);
        expect(d.command).toBeUndefined();
        expect(d.sessionId).toBeDefined();

        c.keep(d.sessionId!);
        // A follow-up without the wake word is accepted inside the window.
        const follow = c.resolve('allume la lumière');
        expect(follow.inConversation).toBe(true);
        expect(follow.command).toBe('allume la lumière');
        expect(follow.sessionId).toBe(d.sessionId);
    });

    test('manual (push-to-talk) uses the whole utterance', () => {
        const c = make();
        const d = c.resolve('allume la lumière', { manual: true });
        expect(d.command).toBe('allume la lumière');
        expect(typeof d.sessionId).toBe('string');
    });

    test('keep accepts an extended window (voice-profile registration)', () => {
        const c = make();
        const d = c.resolve('charlie allume');
        c.keep(d.sessionId!, REGISTRATION_TIMEOUT_MS);

        // Still open well past the default 1s window configured in `make`.
        clock += 5000;
        const follow = c.resolve('allume la lumière');
        expect(follow.inConversation).toBe(true);
        expect(follow.command).toBe('allume la lumière');
        expect(ended).toEqual([]);
    });

    test('the window expires and ends the session', () => {
        const c = make();
        const d = c.resolve('charlie allume');
        c.keep(d.sessionId!);

        clock += 1001;
        const next = c.resolve('allume la lumière');
        // Window lapsed → session ended and the utterance ignored (no wake word).
        expect(next.command).toBeUndefined();
        expect(ended).toEqual([d.sessionId]);
        expect(c.session).toBeUndefined();
    });

    test("bareWake 'ignore' mirrors the echo behaviour", () => {
        const c = make({
            bareWake: 'ignore',
            strip: prefixWakeWords(ECHO_WAKE_WORDS),
        });

        // Bare wake word while idle → ignored.
        expect(c.resolve('charlie ').command).toBeUndefined();

        // Bare wake word inside the window → full text is used (echo quirk).
        const d = c.resolve('charlie allume');
        c.keep(d.sessionId!);
        expect(c.resolve('charlie ').command).toBe('charlie');
    });

    test('release ends the session and closes the window', () => {
        const c = make();
        const d = c.resolve('charlie allume');
        c.keep(d.sessionId!);

        c.release(d.sessionId);
        expect(ended).toEqual([d.sessionId]);
        expect(c.session).toBeUndefined();
        expect(c.resolve('allume').command).toBeUndefined();
    });

    test('close ends the active session (socket teardown)', () => {
        const c = make();
        const d = c.resolve('charlie allume');
        c.keep(d.sessionId!);

        c.close();
        expect(ended).toEqual([d.sessionId]);
        expect(c.session).toBeUndefined();
    });
});
