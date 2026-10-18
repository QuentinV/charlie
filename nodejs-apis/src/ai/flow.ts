import { getActions } from '../tools/actions';
import { ToolExecutionContext, Tools } from '../types';
import { findIntent } from './nlu/nlu';
import { log } from '../manager/services/activities';
import { settings } from '../manager/services/settings';
import { chat } from './llm';
import { tts } from './tts';
import * as voiceProfile from './voiceProfile';
import * as memory from './memory';
import { expectsFollowUp } from './conversation';
import { v4 as uuid } from 'uuid';

export { expectsFollowUp };

const positiveAnswers = [
    "C'est fait.",
    "C'est fait ! Je vais m'octroyer une pause de deux secondes pour fêter ça.",
    "C'est fait ! J'espère que vous appréciez l'effort.",
    "C'est comme si c'était fait.",
    'Mission accomplie.',
    "Pas de problème, je m'en occupe.",
    "C'est réglé, chef.",
    "Biiip... boop... c'est fini!",
    'Affirmatif.',
    'Pas de souci.',
];
const notPossibleAnswers = [
    "Cette action n'est pas disponible.",
    'Je ne peux pas faire ça, malheureusement.',
    "Désolée, mes pouvoirs s'arrêtent ici.",
    'Action impossible. Mon système dit non.',
    'Erreur 404 : Volonté non trouvée.',
];
const doesNotUnderstandAnswers = [
    'Je ne comprends pas.',
    'Hein ? Peux-tu répéter ?',
    "Je n'ai pas capté un seul mot.",
    "C'est du chinois pour moi, ça.",
    'Vous parlez à une maison, là. Soyez plus clair !',
    'Pardon ? Ma logique me fait défaut.',
];

function random(arr: string[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Short acknowledgement label shown on the echo screen. */
export function shortTextFor(result: unknown): string {
    if (typeof result === 'string') return 'Ok';
    if (result === null) return 'Comprends pas';
    if (result === false) return 'Pas possible';
    return 'Ok';
}

/** Full answer spoken back to the user. */
export function longTextFor(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result === null) return random(doesNotUnderstandAnswers);
    if (result === false) return random(notPossibleAnswers);
    return random(positiveAnswers);
}

/** Outcome label recorded in the conversation log for an executed intent. */
function actionOutcome(response: unknown): string {
    if (response === true) return 'done';
    if (response === false) return 'not-possible';
    if (typeof response === 'string') return 'answered';
    return 'none';
}

// Sentence the user is asked to repeat so we capture a clean, long enough
// voice sample for the profile registration.
const REPEAT_SENTENCE = 'Bonjour Charlie, je suis prêt.';

// Minimum sample length: 0.5s of PCM16 16kHz mono.
const MIN_SAMPLE_BYTES = 16000;

export interface AskOptions {
    log?: boolean;
    /** Stable id used to keep the LLM conversation memory across turns. */
    sessionId?: string;
    /** Name of the speaker recognized through the voice profile, if any. */
    user?: string;
    /** Raw PCM16 (16kHz, mono) audio of the current utterance, if available. */
    audio?: Buffer;
}

/**
 * Handle the 2-turn voice profile registration when one is pending for the
 * session. Returns the answer to speak, or `undefined` when the utterance is
 * not part of a registration and should flow through the normal pipeline.
 */
async function handlePendingRegistration(
    sessionId: string,
    text: string,
    audio: Buffer
): Promise<string | boolean | undefined> {
    const pending = voiceProfile.getPending(sessionId);
    if (!pending) return undefined;

    if (pending.phase === 'name') {
        const name = voiceProfile.extractName(text);
        if (!name) {
            return "Je n'ai pas bien compris ton nom. Comment t'appelles-tu ?";
        }
        voiceProfile.advanceToSample(sessionId, name);
        return `Merci ${name}. Pour enregistrer ta voix, répète après moi : « ${REPEAT_SENTENCE} »`;
    }

    // phase === 'sample'
    const name = pending.name;
    if (!name) {
        voiceProfile.clearPending(sessionId);
        return false;
    }
    if (audio.length < MIN_SAMPLE_BYTES) {
        return `Je n'ai pas bien entendu. Répète après moi : « ${REPEAT_SENTENCE} »`;
    }
    const ok = await voiceProfile.register(name, audio);
    voiceProfile.clearPending(sessionId);
    return ok
        ? `C'est fait, ${name}. Ton profil vocal est enregistré.`
        : "Je n'ai pas pu enregistrer ton profil. Réessaie plus tard.";
}

export async function ask(
    text: string,
    options?: AskOptions
): Promise<string | boolean | null | void> {
    const isLog = options?.log ?? true;
    const sessionId = options?.sessionId;
    const audio = options?.audio;
    
    try {
        // A voice profile registration in progress consumes the next
        // utterance(s): first the name, then the repeated voice sample.
        if (audio && sessionId) {
            const handled = await handlePendingRegistration(
                sessionId,
                text,
                audio
            );
            if (handled !== undefined) {
                return handled;
            }
        }

        const actions: Tools = await getActions();

        // First NLU for quick win
        const res = findIntent(text);

        isLog && log('nlu', 'Find intent', { context: { text }, data: res });
        if (res?.name && actions[res.name]) {
            // Enrich the intent with memory (implicit device references,
            // learned preferences) before executing it.
            const view = await memory.getMemory({
                user: options?.user,
                sessionId,
            });
            const resolved = memory.resolveIntentWithMemory(res, view);
            const ctx: ToolExecutionContext = {
                user: options?.user,
                sessionId,
                memory: memory.conversationMemory(sessionId),
            };
            const response = await actions[resolved.name].exec(
                { ...resolved, user: options?.user, sessionId },
                ctx
            );

            // NLU fragments belong to the conversation: the log lets later
            // turns (and the end-of-session summarizer) see what was executed.
            memory.logTurn(sessionId, options?.user, {
                role: 'action',
                intent: resolved.name,
                slots: resolved.slots,
                outcome: actionOutcome(response),
                at: Date.now(),
            });

            // Implicit preference learning: only from explicitly provided
            // values (computed on the original, unresolved intent).
            if (options?.user && response !== false && response !== null) {
                const learned = memory.learnedPreferences(res);
                if (Object.keys(learned).length) {
                    await memory.learnPreferences(options.user, learned);
                }
            }

            if (response === true) {
                return random(positiveAnswers);
            } else if (response === false) {
                return false;
            } else if (response !== null) {
                return response;
            }
        } else {
            isLog && log('nlu', `Cannot find intent for ${text}`);
        }
    } catch (e) {
        throw e;
    }

    if (settings.flow?.agentic?.enabled) {
        try {
            isLog && log('nlu', `Fallback to LLM`);
            const view = await memory.getMemory({
                user: options?.user,
                sessionId,
            });
            return await chat(sessionId ?? uuid(), text, undefined, {
                user: options?.user,
                memory: memory.renderMemory(view),
            });
        } catch (e) {
            throw e;
        }
    }

    return null;
}

export interface AnswerOptions extends AskOptions {
    /** TTS output format: raw PCM16 (`audio/L16`, default) or `audio/wav`. */
    audioType?: 'audio/L16' | 'audio/wav';
}

export interface AnswerResult {
    result: string | boolean | null | void;
    /** Short acknowledgement label (echo screen feedback). */
    short: string;
    /** Full answer text (spoken and/or displayed). */
    text: string;
    /** Synthesised audio, format given by `AnswerOptions.audioType`. */
    audio: Buffer;
    /**
     * Whether the echo device should keep the microphone open for a follow-up
     * turn (no wake word needed). Decided by the server.
     */
    conversation: boolean;
}

/**
 * Single source of truth for a turn: ask() → classify the result → tts().
 * Transports are only responsible for framing/sending the returned pieces.
 */
export async function answer(
    text: string,
    options?: AnswerOptions
): Promise<AnswerResult> {
    if (options?.sessionId) {
        memory.logTurn(options.sessionId, options.user, {
            role: 'user',
            text,
            at: Date.now(),
        });
    }
    const result = await ask(text, options);
    const short = shortTextFor(result);
    const long = longTextFor(result);
    const audio = await tts({
        text: long,
        type: options?.audioType ?? 'audio/L16',
    });
    if (options?.sessionId) {
        memory.logTurn(options.sessionId, options.user, {
            role: 'assistant',
            text: long,
            at: Date.now(),
        });
    }
    return {
        result,
        short,
        text: long,
        audio: Buffer.from(audio),
        // Keep the microphone open for a follow-up when the reply is a
        // question, or while a voice-profile registration is pending: its
        // prompts are not questions but still need the next utterance.
        conversation: expectsFollowUp(
            long,
            !!voiceProfile.getPending(options?.sessionId)
        ),
    };
}
