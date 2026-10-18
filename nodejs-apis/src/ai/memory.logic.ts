import {
    ConversationEntry,
    MemoryCaps,
    MemorySummary,
    MemoryView,
    UserMemory,
} from './memory.types';

/** Minimal shape of an NLU intent (avoids importing the NLU engine here). */
export interface IntentLike {
    name: string;
    freeText?: string;
    slots?: Record<string, string>;
}

/** Intents that target a device and can therefore use the conversation context. */
const DEVICE_INTENTS = new Set([
    'turnOnDevice',
    'turnOffDevice',
    'pauseDevice',
    'deviceStateQuery',
    'setBrightness',
    'setVolume',
    'brightnessUp',
    'brightnessDown',
    'volumeUp',
    'volumeDown',
]);

/** Words that, alone, mean "the previously mentioned device". */
const PRONOUNS = new Set([
    'la',
    'le',
    'les',
    'l',
    'ca',
    'cela',
    'celui',
    'celle',
    'ceux',
    'celles',
    'il',
    'elle',
    'ils',
    'elles',
    'y',
    'en',
    'lui',
    'leur',
    'ce',
    'cet',
    'cette',
    'ces',
]);

export const LIGHT_LEVEL_PREF = 'light.level';
export const TV_VOLUME_PREF = 'tv.volume';

/** Context key: the recognized user if known, else the conversation id. */
export function contextKey(scope: {
    user?: string;
    sessionId?: string;
}): string | undefined {
    return scope.user ?? scope.sessionId;
}

export function emptyMemory(user: string): UserMemory {
    return {
        user,
        updated: new Date(),
        preferences: {},
        facts: [],
        topics: {},
    };
}

/** True when the utterance carries no explicit device/room information. */
function isImplicitReference(freeText?: string): boolean {
    const t = (freeText ?? '').trim().toLowerCase();
    if (!t) return true;
    return t.split(/\s+/).every((w) => PRONOUNS.has(w));
}

function hasExplicitTarget(
    slots: Record<string, string>,
    freeText?: string
): boolean {
    if (slots.deviceType || slots.room || slots.predefinedRoom) return true;
    return !isImplicitReference(freeText);
}

export function getPreference(
    profile: UserMemory | undefined,
    key: string
): string | number | boolean | undefined {
    return profile?.preferences?.[key];
}

/**
 * Enrich an NLU intent with memory:
 *  - fill the target device from the conversation context (anaphora),
 *  - apply learned preferences when a value is missing.
 */
export function resolveIntentWithMemory(
    intent: IntentLike,
    view: MemoryView
): IntentLike {
    if (!intent?.name) return intent;
    const slots: Record<string, string> = { ...(intent.slots ?? {}) };

    if (
        DEVICE_INTENTS.has(intent.name) &&
        !slots.deviceId &&
        !hasExplicitTarget(slots, intent.freeText)
    ) {
        const ctx = view.context;
        if (ctx?.activeDeviceId) {
            slots.deviceId = ctx.activeDeviceId;
        } else if (ctx?.activeRoomId && !slots.room) {
            slots.room = ctx.activeRoomId;
        }
    }

    if (!slots.number) {
        if (intent.name === 'setBrightness' || intent.name === 'turnOnDevice') {
            const p = getPreference(view.profile, LIGHT_LEVEL_PREF);
            if (p != null) slots.number = String(p);
        } else if (intent.name === 'setVolume') {
            const p = getPreference(view.profile, TV_VOLUME_PREF);
            if (p != null) slots.number = String(p);
        }
    }

    return { ...intent, slots };
}

/**
 * Preferences to learn from an utterance. Computed on the *original* intent
 * (before resolution) so a value injected from memory is not re-learned.
 */
export function learnedPreferences(intent: IntentLike): Record<string, number> {
    const out: Record<string, number> = {};
    const raw = intent?.slots?.number;
    if (raw == null) return out;
    const value = Number(raw);
    if (Number.isNaN(value)) return out;
    if (intent.name === 'setBrightness') out[LIGHT_LEVEL_PREF] = value;
    else if (intent.name === 'setVolume') out[TV_VOLUME_PREF] = value;
    return out;
}

export function capMemory(
    memory: UserMemory,
    caps: MemoryCaps = {}
): UserMemory {
    const maxFacts = caps.maxFacts ?? 20;
    const maxTopics = caps.maxTopics ?? 10;
    const facts = (memory.facts ?? []).slice(-maxFacts);
    const topics = Object.fromEntries(
        Object.entries(memory.topics ?? {}).slice(-maxTopics)
    );
    return { ...memory, facts, topics };
}

export function mergeSummary(
    memory: UserMemory,
    summary: MemorySummary
): UserMemory {
    const topics = { ...(memory.topics ?? {}), ...(summary.topics ?? {}) };
    const facts = [...(memory.facts ?? [])];
    for (const f of summary.facts ?? []) {
        if (f && !facts.includes(f)) facts.push(f);
    }
    return {
        ...memory,
        summary: summary.summary ?? memory.summary,
        topics,
        facts,
        updated: new Date(),
    };
}

/** Render a bounded memory block for the LLM system prompt. */
export function renderForPrompt(view: MemoryView, maxChars = 1200): string {
    const lines: string[] = [];
    const p = view.profile;
    if (p) {
        const prefs = Object.entries(p.preferences ?? {});
        if (prefs.length) {
            lines.push(
                '- Preferences: ' +
                    prefs.map(([k, v]) => `${k}=${v}`).join(', ')
            );
        }
        if (p.facts?.length) lines.push('- Facts: ' + p.facts.join('; '));
        const topics = Object.entries(p.topics ?? {});
        if (topics.length) {
            lines.push(
                '- Topics: ' +
                    topics.map(([k, v]) => `${k}: ${v}`).join(' | ')
            );
        }
        if (p.summary) lines.push('- Summary: ' + p.summary);
    }
    const ctx = view.context;
    if (ctx?.activeDeviceName || ctx?.activeRoomId) {
        const parts: string[] = [];
        if (ctx.activeDeviceName) {
            parts.push(`active device ${ctx.activeDeviceName}`);
        }
        if (ctx.activeRoomId) parts.push(`active room ${ctx.activeRoomId}`);
        lines.push('- Current context: ' + parts.join(', '));
    }
    if (!lines.length) return '';
    let out = 'What you know about the user:\n' + lines.join('\n');
    if (out.length > maxChars) out = out.slice(0, maxChars) + '…';
    return out;
}

/**
 * Whether the conversation log already contains one of these executed intents.
 * Only NLU fragments (`role: 'action'`) count: the free text of a user or an
 * assistant turn is not an intent.
 */
export function hasExecutedIntent(
    entries: ConversationEntry[],
    intents: string[]
): boolean {
    const wanted = new Set(intents);
    const res = (entries ?? []).some(
        (e) => e.role === 'action' && wanted.has(e.intent)
    );
    return res;
}

/** Flatten a conversation log to text for the summarizer prompt. */
export function renderConversation(entries: ConversationEntry[]): string {
    return (entries ?? [])
        .map((e) => {
            if (e.role === 'action') {
                return `[action] ${e.intent}${
                    e.device ? ` -> ${e.device}` : ''
                } (${e.outcome})`;
            }
            return `[${e.role}] ${e.text}`;
        })
        .join('\n');
}
