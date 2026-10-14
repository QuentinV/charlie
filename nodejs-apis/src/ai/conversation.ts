import { randomUUID } from 'crypto';

/**
 * Wake-word stripper. Returns the utterance with the wake word removed
 * (`''` when the utterance was only the wake word) or `null` when no wake
 * word was found.
 */
export type WakeStripper = (text: string) => string | null;

/** Echo-style wake words, matched with `startsWith` (longest first). */
export const ECHO_WAKE_WORDS = ['charlie, ', 'charlie ', 'charlie. '];

/**
 * Web-UI wake words, matched anywhere in the utterance with word boundaries
 * (longest first so "hey charlie" wins over "hey"/"charlie").
 */
export const WEB_WAKE_WORDS = [
    'hey charlie',
    'hi charlie',
    'charlie',
    'hey',
    'hi',
];

const escapeRE = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strip a leading wake word (`startsWith`), like the echo `verify()`. */
export function prefixWakeWords(words: string[]): WakeStripper {
    return (text: string) => {
        const t = (text ?? '').toLowerCase();
        for (const w of words) {
            if (t.startsWith(w)) return (text ?? '').substring(w.length);
        }
        return null;
    };
}

/** Strip a wake word found anywhere, keeping word boundaries (web UI). */
export function wordWakeWords(words: string[]): WakeStripper {
    const patterns = words.map(
        (w) => new RegExp(`(?:^|\\s)${escapeRE(w)}(?=$|\\s|[.,!?;])`, 'i')
    );
    return (text: string) => {
        const t = text ?? '';
        for (const re of patterns) {
            const m = t.match(re);
            if (!m || m.index === undefined) continue;
            const before = t.slice(0, m.index);
            const after = t.slice(m.index + m[0].length);
            return `${before} ${after}`
                .replace(/\s+/g, ' ')
                .replace(/^[\s.,!?;:]+/, '')
                .trim();
        }
        return null;
    };
}

/**
 * Whether the assistant expects the user to answer back. The server decides
 * this per turn: the transports keep the microphone open for a follow-up
 * only when this is true. The reply is a question when it ends with a `?`,
 * or when a voice-profile registration is pending — that flow is a multi-turn
 * exchange whose prompts are not questions ("… répète après moi : « … »").
 */
export function expectsFollowUp(
    text: string,
    pendingRegistration = false
): boolean {
    return pendingRegistration || /\?\s*$/.test((text ?? '').trim());
}

/**
 * Extended follow-up window used while a voice-profile registration is
 * pending: the sentence to repeat is long to speak back, so its playback
 * would otherwise eat most of the default window.
 */
export const REGISTRATION_TIMEOUT_MS = 30000;

export interface ConversationConfig {
    /** Removes the wake word from an utterance. */
    strip: WakeStripper;
    /** How long the follow-up window stays open after a turn (ms). */
    timeoutMs?: number;
    /** Ends a session (transports pass `endSession`). Injected to stay pure. */
    endSession?: (sessionId: string) => void;
    /**
     * What to do with a bare wake word (wake word, no command):
     * - `'ignore'` (echo): drop it when idle, use the full text in-window;
     * - `'wake'` (web UI): report `wakeOnly` so the caller can answer.
     */
    bareWake?: 'ignore' | 'wake';
    /** Clock, injectable for tests. */
    now?: () => number;
}

export interface TurnDecision {
    /** Command to answer (`undefined` → nothing to do). */
    command?: string;
    /** True when the utterance was a bare wake word. */
    wakeOnly: boolean;
    /** True when the utterance landed inside an open follow-up window. */
    inConversation: boolean;
    /** Session id to use for this turn (created lazily, only when needed). */
    sessionId?: string;
}

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Server-side conversation state machine shared by every voice transport
 * (echo device and browser). It owns the session lifecycle and the follow-up
 * window; transports only frame/send the returned decision.
 */
export class Conversation {
    private readonly strip: WakeStripper;
    private readonly timeoutMs: number;
    private readonly endSession?: (sessionId: string) => void;
    private readonly bareWake: 'ignore' | 'wake';
    private readonly now: () => number;

    private sessionId?: string;
    private until = 0;

    constructor(config: ConversationConfig) {
        this.strip = config.strip;
        this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.endSession = config.endSession;
        this.bareWake = config.bareWake ?? 'ignore';
        this.now = config.now ?? Date.now;
    }

    /** Currently active session id, if the window is still open. */
    get session(): string | undefined {
        return this.sessionId;
    }

    /**
     * Resolve a recognized utterance against the current conversation window.
     * Expires the window first (ending the session) when it has lapsed.
     */
    resolve(text: string, options: { manual?: boolean } = {}): TurnDecision {
        const inConversation = this.now() < this.until;

        // Window lapsed → the session is over.
        if (!inConversation && this.sessionId) {
            this.endSession?.(this.sessionId);
            this.sessionId = undefined;
            this.until = 0;
        }

        const raw = text ?? '';
        const trimmed = raw.trim();
        let command: string | undefined;
        let wakeOnly = false;

        if (options.manual) {
            // Push-to-talk / typed input: the whole utterance is the command.
            command = trimmed || undefined;
        } else {
            const stripped = this.strip(raw);
            if (stripped !== null && stripped.trim()) {
                command = stripped.trim();
            } else if (stripped !== null) {
                // Bare wake word.
                if (this.bareWake === 'wake') wakeOnly = true;
                else if (inConversation) command = trimmed || undefined;
            } else if (inConversation) {
                command = trimmed || undefined;
            }
        }

        const hasTurn = !!command || wakeOnly;
        return {
            command,
            wakeOnly,
            inConversation,
            sessionId: hasTurn ? (this.sessionId ?? randomUUID()) : undefined,
        };
    }

    /** Keep the session alive for a follow-up turn. */
    keep(sessionId: string, timeoutMs?: number): void {
        this.sessionId = sessionId;
        this.until = this.now() + (timeoutMs ?? this.timeoutMs);
    }

    /** End a session and close the window. */
    release(sessionId?: string): void {
        const id = sessionId ?? this.sessionId;
        if (id) this.endSession?.(id);
        this.sessionId = undefined;
        this.until = 0;
    }

    /** End whatever session is active (socket closing). */
    close(): void {
        if (this.sessionId) this.endSession?.(this.sessionId);
        this.sessionId = undefined;
        this.until = 0;
    }
}
