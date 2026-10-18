import {
    capMemory,
    contextKey,
    emptyMemory,
    hasExecutedIntent,
    LIGHT_LEVEL_PREF,
    learnedPreferences,
    mergeSummary,
    renderConversation,
    renderForPrompt,
    resolveIntentWithMemory,
    TV_VOLUME_PREF,
} from './memory.logic';
import { ConversationEntry, MemoryView, UserMemory } from './memory.types';

function view(overrides: Partial<MemoryView> = {}): MemoryView {
    return {
        context: { at: Date.now() },
        log: [],
        ...overrides,
    };
}

describe('memory.logic', () => {
    test('contextKey prefers the recognized user over the session', () => {
        expect(contextKey({ user: 'Alice', sessionId: 's1' })).toBe('Alice');
        expect(contextKey({ sessionId: 's1' })).toBe('s1');
        expect(contextKey({})).toBeUndefined();
    });

    test('resolves an implicit reference from the conversation context', () => {
        const v = view({ context: { activeDeviceId: 'dev1', at: Date.now() } });
        const resolved = resolveIntentWithMemory(
            { name: 'turnOffDevice', freeText: 'la' },
            v
        );
        expect(resolved.slots?.deviceId).toBe('dev1');
    });

    test('does not override an explicit device target', () => {
        const v = view({ context: { activeDeviceId: 'dev1', at: Date.now() } });
        const resolved = resolveIntentWithMemory(
            { name: 'turnOnDevice', slots: { deviceType: 'light' } },
            v
        );
        expect(resolved.slots?.deviceId).toBeUndefined();
    });

    test('falls back to the active room when no device is known', () => {
        const v = view({ context: { activeRoomId: 'room1', at: Date.now() } });
        const resolved = resolveIntentWithMemory({ name: 'turnOnDevice' }, v);
        expect(resolved.slots?.room).toBe('room1');
    });

    test('applies a learned brightness preference when no value is given', () => {
        const profile: UserMemory = emptyMemory('Alice');
        profile.preferences[LIGHT_LEVEL_PREF] = 30;
        const resolved = resolveIntentWithMemory(
            { name: 'setBrightness' },
            view({ profile })
        );
        expect(resolved.slots?.number).toBe('30');
    });

    test('keeps an explicit brightness value over the preference', () => {
        const profile: UserMemory = emptyMemory('Alice');
        profile.preferences[LIGHT_LEVEL_PREF] = 30;
        const resolved = resolveIntentWithMemory(
            { name: 'setBrightness', slots: { number: '80' } },
            view({ profile })
        );
        expect(resolved.slots?.number).toBe('80');
    });

    test('learns volume/brightness from explicit values only', () => {
        expect(
            learnedPreferences({
                name: 'setBrightness',
                slots: { number: '45' },
            })
        ).toEqual({ [LIGHT_LEVEL_PREF]: 45 });
        expect(
            learnedPreferences({ name: 'setVolume', slots: { number: '20' } })
        ).toEqual({ [TV_VOLUME_PREF]: 20 });
        expect(learnedPreferences({ name: 'setBrightness' })).toEqual({});
        expect(learnedPreferences({ name: 'turnOnDevice' })).toEqual({});
    });

    test('caps facts and topics', () => {
        const m = emptyMemory('Alice');
        m.facts = ['a', 'b', 'c'];
        m.topics = { t1: 'x', t2: 'y', t3: 'z' };
        const capped = capMemory(m, { maxFacts: 2, maxTopics: 1 });
        expect(capped.facts).toEqual(['b', 'c']);
        expect(Object.keys(capped.topics)).toEqual(['t3']);
    });

    test('merges a summary without losing existing data', () => {
        const m = emptyMemory('Alice');
        m.facts = ['existing'];
        const merged = mergeSummary(m, {
            summary: 'new summary',
            facts: ['existing', 'fresh'],
            topics: { cuisine: 'aime cuisiner' },
        });
        expect(merged.summary).toBe('new summary');
        expect(merged.facts).toEqual(['existing', 'fresh']);
        expect(merged.topics).toEqual({ cuisine: 'aime cuisiner' });
    });

    test('renders a bounded memory block', () => {
        const profile: UserMemory = emptyMemory('Alice');
        profile.preferences[LIGHT_LEVEL_PREF] = 30;
        profile.facts = ['aime le jazz'];
        profile.summary = 'résumé';
        const rendered = renderForPrompt(view({ profile }));
        expect(rendered).toContain('light.level=30');
        expect(rendered).toContain('aime le jazz');
        expect(rendered).toContain('résumé');
        expect(renderForPrompt(view())).toBe('');
        const long = renderForPrompt(
            view({ profile: { ...profile, summary: 'x'.repeat(5000) } }),
            100
        );
        expect(long.length).toBeLessThanOrEqual(101);
    });

    test('detects an intent already executed in the conversation', () => {
        const entries: ConversationEntry[] = [
            { role: 'user', text: 'bonjour', at: 0 },
            { role: 'assistant', text: 'Salut !', at: 0 },
            { role: 'action', intent: 'greet', outcome: 'answered', at: 0 },
        ];

        expect(hasExecutedIntent(entries, ['greet'])).toBe(true);
        expect(hasExecutedIntent(entries, ['howAreYou', 'greet'])).toBe(true);
        expect(hasExecutedIntent(entries, ['howAreYou'])).toBe(false);
        // prose mentions the intent name but is not an NLU fragment
        expect(
            hasExecutedIntent(
                [{ role: 'user', text: 'howAreYou', at: 0 }],
                ['howAreYou']
            )
        ).toBe(false);
        expect(hasExecutedIntent([], ['greet'])).toBe(false);
    });

    test('renders the conversation transcript', () => {
        const text = renderConversation([
            { role: 'user', text: 'allume', at: 0 },
            { role: 'action', intent: 'turnOnDevice', outcome: 'done', at: 0 },
            { role: 'assistant', text: "C'est fait.", at: 0 },
        ]);
        expect(text).toBe(
            "[user] allume\n[action] turnOnDevice (done)\n[assistant] C'est fait."
        );
    });
});
