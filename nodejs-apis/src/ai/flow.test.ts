// `uuid` v13 is ESM-only and Jest does not transform node_modules: stub it so
// the flow (and the activity logger it pulls in) can be exercised.
jest.mock('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v7: () => '00000000-0000-7000-8000-000000000000',
}));

import { ask, expectsFollowUp } from './flow';
import { clearConversation, getConversation } from './memory';
import { ConversationEntry } from './memory.types';

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