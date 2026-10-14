import 'dotenv/config';
import { cs } from '../core/db';
import { settings } from '../manager/services/settings';
import {
    ConversationContext,
    ConversationEntry,
    MemoryScope,
    MemorySummary,
    MemoryView,
    UserMemory,
} from './memory.types';
import {
    capMemory,
    contextKey,
    emptyMemory,
    mergeSummary,
    renderForPrompt,
} from './memory.logic';

export * from './memory.logic';
export * from './memory.types';

const PROFILE_TTL_MS = 10 * 60 * 1000;
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const MAX_LOG_ENTRIES = 40;

const profiles = new Map<string, UserMemory>();
const contexts = new Map<string, ConversationContext>();
const conversations = new Map<
    string,
    { user?: string; entries: ConversationEntry[]; at: number }
>();

function caps() {
    return {
        maxFacts: Number(settings.memory?.maxFacts) || 20,
        maxTopics: Number(settings.memory?.maxTopics) || 10,
    };
}

function promptMaxChars(): number {
    return Number(settings.memory?.promptMaxChars) || 1200;
}

// --- profile (persisted in the `memories` collection) ---
export async function loadProfile(
    user?: string
): Promise<UserMemory | undefined> {
    if (!user) return undefined;
    if (profiles.has(user)) return profiles.get(user);
    try {
        const doc = await cs.memories.findOne({ user });
        const memory: UserMemory = doc
            ? {
                  user,
                  updated: doc.updated ?? new Date(),
                  preferences: doc.preferences ?? {},
                  facts: doc.facts ?? [],
                  topics: doc.topics ?? {},
                  summary: doc.summary,
              }
            : emptyMemory(user);
        profiles.set(user, memory);
        return memory;
    } catch (e) {
        console.error(
            '[memory] loadProfile failed',
            (e as any)?.message ?? e
        );
        return undefined;
    }
}

export async function saveProfile(memory: UserMemory): Promise<void> {
    const capped = capMemory(memory, caps());
    profiles.set(capped.user, capped);
    try {
        await cs.memories.updateOne(
            { user: capped.user },
            {
                $set: {
                    user: capped.user,
                    updated: capped.updated,
                    preferences: capped.preferences,
                    facts: capped.facts,
                    topics: capped.topics,
                    summary: capped.summary,
                },
            },
            { upsert: true }
        );
    } catch (e) {
        console.error(
            '[memory] saveProfile failed',
            (e as any)?.message ?? e
        );
    }
}

export async function updateProfile(
    user: string,
    mutate: (memory: UserMemory) => void
): Promise<UserMemory | undefined> {
    if (!user) return undefined;
    const memory = (await loadProfile(user)) ?? emptyMemory(user);
    mutate(memory);
    memory.updated = new Date();
    await saveProfile(memory);
    return memory;
}

/** Store learned preferences for a user (implicit learning). */
export async function learnPreferences(
    user: string,
    preferences: Record<string, number>
): Promise<void> {
    if (!user) return;
    const keys = Object.keys(preferences);
    if (!keys.length) return;
    await updateProfile(user, (m) => {
        for (const k of keys) m.preferences[k] = preferences[k];
    });
}

// --- per-turn view ---
export async function getMemory(scope: MemoryScope): Promise<MemoryView> {
    const profile = await loadProfile(scope.user);
    const key = contextKey(scope);
    const context = (key && contexts.get(key)) ?? { at: Date.now() };
    const conv = scope.sessionId
        ? conversations.get(scope.sessionId)
        : undefined;
    return {
        user: scope.user,
        profile,
        context,
        log: conv?.entries ?? [],
    };
}

/** Render the (bounded) memory block to inject into the LLM prompt. */
export function renderMemory(view: MemoryView): string {
    return renderForPrompt(view, promptMaxChars());
}

// --- conversation context (NLU) ---
export function setContext(
    scope: MemoryScope,
    patch: Partial<ConversationContext>
): void {
    const key = contextKey(scope);
    if (!key) return;
    const current = contexts.get(key) ?? { at: Date.now() };
    contexts.set(key, {
        ...current,
        ...patch,
        user: scope.user ?? current.user,
        at: Date.now(),
    });
}

export function setActiveDevice(
    scope: MemoryScope,
    deviceId?: string,
    deviceName?: string,
    roomId?: string
): void {
    if (!deviceId) return;
    setContext(scope, {
        activeDeviceId: deviceId,
        activeDeviceName: deviceName,
        ...(roomId ? { activeRoomId: roomId } : {}),
    });
}

export function clearContext(scope: MemoryScope): void {
    const key = contextKey(scope);
    if (key) contexts.delete(key);
}

// --- conversation log (for end-of-session summarization) ---
export function logTurn(
    sessionId: string | undefined,
    user: string | undefined,
    entry: ConversationEntry
): void {
    if (!sessionId) return;
    const conv = conversations.get(sessionId) ?? {
        user,
        entries: [],
        at: Date.now(),
    };
    conv.user = user ?? conv.user;
    conv.entries.push(entry);
    if (conv.entries.length > MAX_LOG_ENTRIES) {
        conv.entries.splice(0, conv.entries.length - MAX_LOG_ENTRIES);
    }
    conv.at = Date.now();
    conversations.set(sessionId, conv);
}

export function getConversation(
    sessionId?: string
): { user?: string; entries: ConversationEntry[] } | undefined {
    if (!sessionId) return;
    const conv = conversations.get(sessionId);
    return conv ? { user: conv.user, entries: conv.entries } : undefined;
}

export function clearConversation(sessionId?: string): void {
    if (sessionId) conversations.delete(sessionId);
}

// --- summarizer output ---
export async function applySummary(
    user: string,
    summary: MemorySummary
): Promise<void> {
    if (!user) return;
    const memory = (await loadProfile(user)) ?? emptyMemory(user);
    await saveProfile(mergeSummary(memory, summary));
}

// --- lifecycle sweep: evict idle context / conversations / cached profiles ---
setInterval(() => {
    const now = Date.now();
    const ctxTtl = Number(settings.memory?.contextTtlMs) || CONTEXT_TTL_MS;
    for (const [key, ctx] of contexts) {
        if (now - ctx.at > ctxTtl) contexts.delete(key);
    }
    for (const [key, conv] of conversations) {
        if (now - conv.at > PROFILE_TTL_MS) conversations.delete(key);
    }
    for (const [user, mem] of profiles) {
        if (now - mem.updated.getTime() > PROFILE_TTL_MS) profiles.delete(user);
    }
}, 60_000).unref?.();
