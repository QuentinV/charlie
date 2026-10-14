/**
 * Structured, per-user memory shared by the NLU and the LLM.
 * Persisted in the `memories` collection (one document per recognized user).
 */
export interface UserMemory {
    user: string;
    updated: Date;
    /** Scalar preferences namespaced by domain, e.g. "light.level": 30. */
    preferences: Record<string, string | number | boolean>;
    /** Durable free-form facts about the user. */
    facts: string[];
    /** Topic -> running summary (LLM-driven). */
    topics: Record<string, string>;
    /** Bounded rollup injected into the LLM prompt. */
    summary?: string;
}

/**
 * Short-lived conversational context used by the NLU to resolve implicit
 * references ("éteins-la"). Keyed by user (if known) else session id.
 */
export interface ConversationContext {
    activeDeviceId?: string;
    activeDeviceName?: string;
    activeRoomId?: string;
    lastIntent?: string;
    lastSlots?: Record<string, string>;
    user?: string;
    at: number;
}

export type ConversationEntry =
    | { role: 'user'; text: string; at: number }
    | { role: 'assistant'; text: string; at: number }
    | {
          role: 'action';
          intent: string;
          slots?: Record<string, string>;
          outcome: string;
          device?: string;
          at: number;
      };

export interface MemoryScope {
    user?: string;
    sessionId?: string;
}

export interface MemoryView {
    user?: string;
    profile?: UserMemory;
    context: ConversationContext;
    log: ConversationEntry[];
}

/** Structured output of the end-of-session summarizer. */
export interface MemorySummary {
    summary?: string;
    topics?: Record<string, string>;
    facts?: string[];
}

export interface MemoryCaps {
    maxFacts?: number;
    maxTopics?: number;
}
