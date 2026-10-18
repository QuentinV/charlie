// `uuid` v13 is ESM-only and Jest does not transform node_modules: stub it so
// the flow (and the activity logger it pulls in) can be exercised.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

import { ask, expectsFollowUp } from './flow';
import { clearConversation, getConversation } from './memory';
import { ConversationEntry } from './memory.types';
import {
    beginRegistration,
    clearPending,
    getPending,
    getSamples,
} from './voiceProfile';

/** Ask one turn in a conversation and return the assistant's answer text. */
async function say(sessionId: string, text: string): Promise<string> {
    const reply = await ask(text, { sessionId, log: false });
    expect(typeof reply).toBe('string');
    return reply as string;
}

/** NLU fragments recorded in the conversation log, in order. */
function executedIntents(sessionId: string): string[] {
    return (getConversation(sessionId)?.entries ?? [])
        .filter(
            (e): e is Extract<ConversationEntry, { role: 'action' }> =>
                e.role === 'action'
        )
        .map((e) => e.intent);
}

describe('small talk', () => {
    test('a greeting asks its question once per conversation', async () => {
        const sessionId = 'test-small-talk-greet';
        clearConversation(sessionId);

        const first = await say(sessionId, 'bonjour');
        expect(expectsFollowUp(first)).toBe(true);

        // Answering (or repeating) the greeting must not ask it again: a reply
        // ending with '?' re-opens the microphone and would loop forever.
        const second = await say(sessionId, 'bonjour');
        expect(second).not.toMatch(/\?/);
        expect(expectsFollowUp(second)).toBe(false);
    });

    test('answering "how are you" closes instead of asking again', async () => {
        const sessionId = 'test-small-talk-how-are-you';
        clearConversation(sessionId);

        const first = await say(sessionId, 'comment ça va ?');
        expect(expectsFollowUp(first)).toBe(true);

        // "ça va bien et toi ?" is the answer to Charlie's own question: the
        // NLU resolves it as howAreYou again.
        const second = await say(sessionId, 'ça va bien et toi ?');
        expect(second).not.toMatch(/\?/);
        expect(expectsFollowUp(second)).toBe(false);
    });

    test('a new conversation asks its question again', async () => {
        clearConversation('test-small-talk-fresh-1');
        clearConversation('test-small-talk-fresh-2');

        const first = await say('test-small-talk-fresh-1', 'salut');
        const other = await say('test-small-talk-fresh-2', 'salut');

        expect(expectsFollowUp(first)).toBe(true);
        expect(expectsFollowUp(other)).toBe(true);
    });

    test('the conversation log records the executed NLU intents', async () => {
        const sessionId = 'test-small-talk-log';
        clearConversation(sessionId);

        await say(sessionId, 'bonjour');
        await say(sessionId, 'bonjour');

        expect(executedIntents(sessionId)).toEqual(['greet', 'greet']);
        expect(getConversation(sessionId)?.entries).toContainEqual(
            expect.objectContaining({
                role: 'action',
                intent: 'greet',
                outcome: 'answered',
            })
        );
    });
});

/** PCM16 16 kHz mono sine wave, long and loud enough to be enrolled. */
function tone(seconds = 2): Buffer {
    const sampleCount = Math.round(16000 * seconds);
    const pcm = Buffer.alloc(sampleCount * 2);
    for (let index = 0; index < sampleCount; index++) {
        pcm.writeInt16LE(Math.round(Math.sin(index / 12) * 12000), index * 2);
    }
    return pcm;
}

type EnrollmentStatus = 'success' | 'low_confidence' | 'rejected';

/** Enrolment report the mocked profiler returns. */
function enrollment(status: EnrollmentStatus) {
    return {
        status,
        accepted: status === 'success',
        committed: status === 'success',
        samples: 3,
        kept_samples: status === 'success' ? 3 : 2,
        confidence: status === 'success' ? 0.9 : 0.3,
        threshold: 0.5,
        scores: { test: 0.8, loo_min: 0.6, loo_mean: 0.7, centroid_mean: 0.8 },
        ...(status === 'rejected'
            ? { sample_index: 2, reason: 'too_short' }
            : {}),
    };
}

describe('voice profile registration', () => {
    const session = 'test-voice-registration';
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;

    /** Queue the profiler responses, in order. */
    function profilerReturns(...statuses: EnrollmentStatus[]) {
        let call = 0;
        fetchMock.mockImplementation(async () => {
            const status = statuses[Math.min(call, statuses.length - 1)];
            call += 1;
            return new Response(JSON.stringify(enrollment(status)), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
    }

    beforeEach(() => {
        clearPending(session);
        fetchMock = jest.fn();
        (global as any).fetch = fetchMock;
    });

    afterEach(() => {
        (global as any).fetch = realFetch;
        clearPending(session);
    });

    test('speaks three sentences, then confirms the held-out verification', async () => {
        profilerReturns('success');
        beginRegistration(session);

        const name = await ask("je m'appelle Quentin", {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(name).toContain(
            "Bonjour Charlie, j'active mon profil vocal aujourd'hui."
        );
        expect(getPending(session)?.phase).toBe('sample');

        const second = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(second).toContain('Le grand chêne sombre');

        const third = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(third).toContain("S'il te plaît, vérifie mon identité");

        const done = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(done).toContain('profil vocal est enregistré');
        expect(getPending(session)).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('asks for a rescue sentence when the verification is not convincing', async () => {
        profilerReturns('low_confidence', 'success');
        beginRegistration(session);

        await ask("je m'appelle Quentin", {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        await ask('x', { sessionId: session, audio: tone(), log: false });
        await ask('x', { sessionId: session, audio: tone(), log: false });

        const rescue = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(rescue).toContain('Les vagues brillantes');
        expect(getSamples(session)).toHaveLength(3);

        const done = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(done).toContain('profil vocal est enregistré');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('re-asks the same sentence when the recording is unusable', async () => {
        beginRegistration(session);

        await ask("je m'appelle Quentin", {
            sessionId: session,
            audio: tone(),
            log: false,
        });

        const reply = await ask('x', {
            sessionId: session,
            audio: Buffer.alloc(16000 * 2 * 2),
            log: false,
        });
        expect(reply).toContain("Je n'ai pas bien entendu");
        expect(reply).toContain(
            "Bonjour Charlie, j'active mon profil vocal aujourd'hui."
        );
        expect(getSamples(session)).toHaveLength(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });


    test('re-asks the same sentence when the profiler rejects the recording', async () => {
        profilerReturns('rejected');
        beginRegistration(session);

        await ask("je m'appelle Quentin", {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        await ask('x', { sessionId: session, audio: tone(), log: false });
        await ask('x', { sessionId: session, audio: tone(), log: false });

        const reply = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(reply).toContain("Je n'ai pas bien entendu");
        expect(reply).toContain("S'il te plaît, vérifie mon identité");
        expect(getSamples(session)).toHaveLength(2);
    });

    test('"annule" stops the registration without enrolling anything', async () => {
        beginRegistration(session);

        const reply = await ask('annule', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(reply).toContain("j'annule l'enregistrement");
        expect(getPending(session)).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('reports a down profiler instead of enrolling', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        beginRegistration(session);

        await ask("je m'appelle Quentin", {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        await ask('x', { sessionId: session, audio: tone(), log: false });
        await ask('x', { sessionId: session, audio: tone(), log: false });

        const reply = await ask('x', {
            sessionId: session,
            audio: tone(),
            log: false,
        });
        expect(reply).toContain("Je n'ai pas pu joindre le service");
        expect(getPending(session)).toBeUndefined();
    });
});
