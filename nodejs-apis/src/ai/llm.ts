import 'dotenv/config';
import { toolsExecutors, toolsSchemas } from '../tools/mcp';
import { log as ogLog } from '../manager/services/activities';
import { Activity } from '../types';
import * as memory from './memory';
import { ConversationEntry, MemorySummary } from './memory.types';
import { clearPending } from './voiceProfile';
import {
    LlmChatCompletionsChoicesTool,
    LlmChatCompletionsRequest,
    LlmChatCompletionsResponse,
} from './llm.types';

const host = process.env.LLM_HOST ?? 'llm:9308';
/**
 * Chat model id served by the LLM router (`LLM_MODEL`). The service runs both
 * models behind llama-server's router mode and loads each one on demand, so the
 * brain has to name the model it wants. Unset = single-model server.
 */
const CHAT_MODEL = process.env.LLM_MODEL ?? 'qwen3-4b';
/**
 * Small model, for the background tasks that only extract text: shopping-list
 * restructuring and automation drafting. Same router, loaded on demand.
 */
const SMALL_TASK_MODEL = process.env.LLM_SMALL_TASK_MODEL ?? 'qwen3-1.7b';
/**
 * Vision model id served by the same router (`VISION_MODEL`): the multimodal
 * Qwen3-VL folder whose `mmproj` the router picks up as a sidecar. Loaded on
 * demand; the LRU drops it as soon as another model needs the slot
 * (`MODELS_MAX=2`), so a description does not hold RAM/VRAM indefinitely — it is
 * deliberately absent from `warmUp()`.
 */
const VISION_MODEL = process.env.VISION_MODEL ?? 'qwen3vl-4b';
const LIMIT_TURN = 10;
const LLM_LANG_OUTPUT = process.env.LLM_LANGUAGE?.toUpperCase() ?? 'FRENCH';

/** Model id the conversation and the summarizer use. */
export function chatModel(): string | undefined {
    return CHAT_MODEL;
}

/** Model id background tasks use (shopping restructure, automation compose). */
export function shoppingModel(): string | undefined {
    return SMALL_TASK_MODEL;
}

/** Host serving the small model (same container unless overridden). */
export function shoppingHost(): string {
    return process.env.LLM_SHOPPING_HOST ?? host;
}

/** Model id image descriptions use (served by the same router). */
export function visionModel(): string | undefined {
    return VISION_MODEL;
}

/** Host serving the vision model (same router unless overridden). */
export function visionHost(): string {
    return process.env.LLM_VISION_HOST ?? host;
}

/**
 * Ask the router to load the models ahead of the first request: in router mode
 * nothing is loaded at startup, and the load would otherwise delay the first
 * voice command. Best-effort: a single-model server has no `/models` endpoint.
 * The vision model is left out on purpose — warming it would hold its ~3.5 GB
 * until something else needs the slot.
 */
export async function warmUp(): Promise<void> {
    if (!CHAT_MODEL) return;
    const models = [...new Set([CHAT_MODEL, SMALL_TASK_MODEL])].filter(
        (m): m is string => !!m
    );
    for (const model of models) {
        try {
            const res = await fetch(`http://${host}/models/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model }),
            });
            log(
                res.ok
                    ? `warmup requested for ${model}`
                    : `warmup of ${model} refused (${res.status})`
            );
        } catch (e) {
            log('warmup failed', { data: { error: JSON.stringify(e) } });
        }
    }
}

function log(message: string, activity?: Activity) {
    return ogLog('LLM', message, activity);
}

// ===== Sessions =====
const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions: { [id: string]: LlmChatCompletionsRequest } = {};
const sessionsLastUsed: { [id: string]: number } = {};

async function getSession(
    sessionId: string
): Promise<LlmChatCompletionsRequest> {
    sessionsLastUsed[sessionId] = Date.now();
    if (!sessions[sessionId])
        sessions[sessionId] = {
            messages: [
                {
                    role: 'system',
                    content: 'You are an helpful home assistant named Charlie.',
                },
            ],
            tools: await toolsSchemas(),
            // Router mode: name the model so the server loads/keeps it warm.
            model: CHAT_MODEL,
        };
    return sessions[sessionId];
}

/** Release a conversation session and its LLM memory. */
export function endSession(sessionId?: string): void {
    if (!sessionId) return;
    delete sessions[sessionId];
    delete sessionsLastUsed[sessionId];
    // Drop any half-finished voice-profile registration for this session.
    clearPending(sessionId);
    // Fold the conversation into the user's persistent memory (best-effort).
    void finalizeConversation(sessionId);
}

const SUMMARIZER_PROMPT =
    'You maintain a long-term memory about a home assistant user. ' +
    'Given the transcript of a conversation, update the memory. ' +
    'Reply ONLY with a JSON object: ' +
    '{ "summary": string, "topics": { "<topic>": "<summary>" }, "facts": string[] }. ' +
    'Keep it short and factual. Omit anything not worth remembering.';

/**
 * End-of-session summarization: merge the conversation log into the user's
 * persistent memory. Tool-less LLM call so `response_format` is safe here.
 */
async function finalizeConversation(sessionId: string): Promise<void> {
    try {
        const conv = memory.getConversation(sessionId);
        memory.clearConversation(sessionId);
        memory.clearContext({ sessionId });
        if (!conv?.user || !conv.entries?.length) return;
        const summary = await summarize(conv.entries);
        if (summary) await memory.applySummary(conv.user, summary);
    } catch (e) {
        log('memory finalize failed', {
            data: { error: JSON.stringify(e) },
        });
    }
}

async function summarize(
    entries: ConversationEntry[]
): Promise<MemorySummary | undefined> {
    const transcript = memory.renderConversation(entries);
    if (!transcript.trim()) return;
    const res = await req({
        messages: [
            { role: 'system', content: SUMMARIZER_PROMPT },
            { role: 'user', content: transcript },
        ],
        tools: [],
        model: CHAT_MODEL,
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'memory_update',
                schema: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string' },
                        topics: {
                            type: 'object',
                            additionalProperties: { type: 'string' },
                        },
                        facts: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['summary'],
                },
            },
        },
    });
    const content = res.choices?.[0]?.message?.content;
    if (!content) return;
    try {
        return JSON.parse(content) as MemorySummary;
    } catch {
        return;
    }
}

// Evict sessions that have been idle for too long (orphans, one-shot API
// calls, crashed turns...).
setInterval(() => {
    const now = Date.now();
    for (const id of Object.keys(sessions)) {
        if (now - (sessionsLastUsed[id] ?? 0) > SESSION_TTL_MS) {
            endSession(id);
        }
    }
}, 60_000).unref?.();

// ===== Tool execution =====
async function execTool(
    { function: { name, arguments: args } }: LlmChatCompletionsChoicesTool,
    ctx?: { user?: string; sessionId?: string }
): Promise<string> {
    try {
        const params = JSON.parse(args);

        log(`calling ${name}`, { context: { name: name, params } });

        const tool = toolsExecutors()[name];
        if (!tool) {
            throw new Error(`tool not found ${name}`);
        }

        const res = await tool?.exec(params, ctx);

        if (res === true || res === false) {
            return JSON.stringify({ success: res });
        } else if (res) {
            return typeof res !== 'string' ? JSON.stringify(res) : res;
        }
    } catch (e) {
        const m = (e as any)?.message;
        log(`Error calling tools ${m}`, {
            context: { name: name },
            data: { error: JSON.stringify(e) },
        });
        return m ?? 'An error occured with tool';
    }

    return JSON.stringify({ success: 'unknown' });
}

// ===== Request to LLM =====
/**
 * One chat-completions round trip. `hostOverride` targets another instance
 * (the small model can live on its own host); when the server refuses the
 * requested `model` (single-model deployment, unknown id) the request is
 * retried once without it so a mixed setup keeps working.
 */
export async function req(
    request: LlmChatCompletionsRequest,
    hostOverride?: string
): Promise<LlmChatCompletionsResponse> {
    const target = hostOverride ?? host;

    const post = (body: LlmChatCompletionsRequest) =>
        fetch(`http://${target}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

    let res = await post(request);

    // Router refused the model (single-model deployment or unknown id): retry
    // once without it so a mixed setup keeps working.
    if (
        res.ok === false &&
        request.model &&
        (res.status === 400 || res.status === 404)
    ) {
        log(
            `model ${request.model} refused (${res.status}), retrying without it`
        );
        const { model, ...withoutModel } = request;
        void model;
        res = await post(withoutModel);
    }

    return res.json();
}

// ===== Vision =====
/** Question asked about an image when the caller does not supply one. */
const VISION_PROMPT = 'Décris cette image en une ou deux phrases.';

/**
 * Describe an image with the vision model (Qwen3-VL, served on demand by the
 * same llama.cpp router). `image` is either an http(s) URL or a
 * `data:image/<type>;base64,<payload>` URL — what a camera snapshot gives.
 * Returns the description, or an empty string when the router could not answer
 * (an unusable image must never break the turn that asked for it).
 *
 * The router loads the model on the first call and the LRU drops it as soon as
 * another model needs the slot (see llm/README.md), so nothing has to be
 * unloaded here.
 */
export async function describeImage(
    image: string,
    prompt?: string,
    hostOverride?: string
): Promise<string> {
    try {
        const res = await req(
            {
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: image } },
                            {
                                type: 'text',
                                text: `${prompt ?? VISION_PROMPT} (ALWAYS ANSWER IN ${LLM_LANG_OUTPUT})`,
                            },
                        ],
                    },
                ],
                tools: [],
                // Name the model so the router loads/keeps it warm.
                model: VISION_MODEL,
                // Describing is an observation, not a creative task.
                temperature: 0,
            },
            hostOverride ?? visionHost()
        );

        const answer = res.choices?.[0]?.message?.content;
        if (!answer) {
            log('vision: empty answer', { data: { model: VISION_MODEL } });
            return '';
        }
        return answer.trim();
    } catch (e) {
        log('vision failed', { data: { error: JSON.stringify(e) } });
        return '';
    }
}

export interface VisionJsonOptions {
    /** Instruction sent with the image (the module's prompt). */
    prompt: string;
    /** JSON schema the answer is constrained to (`response_format`). */
    schema: unknown;
    /** Schema name, for the router logs. */
    schemaName?: string;
    /** Upper bound on the answer. */
    maxTokens?: number;
    /** Model id (defaults to `VISION_MODEL`). */
    model?: string;
    /** Host (defaults to `visionHost()`). */
    host?: string;
}

/**
 * Structured answer from the multimodal model: the schema-constrained sibling of
 * `describeImage`. The vision modules own the prompts and validate the data this
 * returns (raw content) — here is only the transport, exactly as `req()` is for
 * the shopping restructurer. Returns null when the router could not answer.
 *
 * Measured on the shipped build (Qwen3-VL-4B Q4_K_M, CPU): constrained decoding
 * works with an image and `--jinja`, and the router's prompt cache reuses the
 * encoded image between two consecutive calls on the same model, so a
 * classify-then-extract scan pays the image prefill once (72 new tokens and 5 s
 * for the second call, against 30-36 s for the first).
 */
export async function visionJson(
    image: string,
    options: VisionJsonOptions
): Promise<string | null> {
    const model = options.model ?? VISION_MODEL;
    try {
        const res = await req(
            {
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: image } },
                            { type: 'text', text: options.prompt },
                        ],
                    },
                ],
                tools: [],
                model,
                // Extraction is an observation: greedy decoding.
                temperature: 0,
                ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: options.schemaName ?? 'vision_answer',
                        schema: options.schema,
                    },
                },
            },
            options.host ?? visionHost()
        );

        const answer = res.choices?.[0]?.message?.content;
        if (!answer) {
            log('vision: empty answer', { data: { model } });
            return null;
        }
        return answer;
    } catch (e) {
        log('vision failed', { data: { error: JSON.stringify(e) } });
        return null;
    }
}

// ===== Orchestration =====
export interface ChatOptions {
    /** Name of the speaker recognized through the voice profile, if any. */
    user?: string;
    /** Rendered memory block injected into the system prompt. */
    memory?: string;
}

export async function chat(
    sessionId: string,
    mesage: string,
    notif?: ({
        tools,
        mess,
    }: {
        tools: LlmChatCompletionsChoicesTool[];
        mess: string;
    }) => void,
    options?: ChatOptions
): Promise<string> {
    const session = await getSession(sessionId);

    // Refresh the system prompt with the recognized speaker (the session is
    // cached, so the identity may change between turns).
    const user =
        options?.user && options.user !== 'unknown' ? options.user : undefined;
    session.messages[0].content =
        'You are an helpful home assistant named Charlie.' +
        (user ? ` The person speaking is ${user}.` : '') +
        (options?.memory ? `\n${options.memory}` : '');

    session.messages.push({
        role: 'user',
        content: mesage + ` (ALWAYS ANSWER IN ${LLM_LANG_OUTPUT})`,
    });

    try {
        let nTurn = 0;
        while (nTurn < LIMIT_TURN) {
            nTurn++;

            const res = await req(session);

            const choice = res.choices?.[0];
            if (!choice) {
                throw Error('Error no answer');
            }

            session.messages.push(choice.message);

            // Return directly if stop
            if (choice.finish_reason === 'stop') {
                console.log(JSON.stringify(session));
                return choice.message.content;
            }

            // Tools parallel execution
            const message = choice.message;
            if (
                choice.finish_reason !== 'tool_calls' ||
                !message.tool_calls?.length
            ) {
                continue;
            }

            notif?.({ tools: message.tool_calls, mess: message.content });

            (
                await Promise.allSettled(
                    message.tool_calls.map(
                        async (t: LlmChatCompletionsChoicesTool) => ({
                            tool: t,
                            result: await execTool(t, {
                                user: options?.user,
                                sessionId,
                            }),
                        })
                    )
                )
            ).forEach((p: any) => {
                const r = p.value;
                session.messages.push({
                    role: 'tool',
                    tool_call_id: r.tool.id,
                    name: r.tool.function.name,
                    content: r.result,
                });
            });
        }

        if (nTurn === LIMIT_TURN) {
            throw Error('limit of turns has been reached');
        }
    } catch (e) {
        const m = (e as any)?.message;
        log(m ?? '', { data: { error: JSON.stringify(e) } });
        return m ?? 'An error occured';
    }

    return 'An unknown error occured';
}
