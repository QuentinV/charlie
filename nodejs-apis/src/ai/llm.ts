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
const LIMIT_TURN = 10;
const LLM_LANG_OUTPUT = process.env.LLM_LANGUAGE?.toUpperCase() ?? 'FRENCH';

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
export async function req(
    req: LlmChatCompletionsRequest
): Promise<LlmChatCompletionsResponse> {
    const res = await fetch(`http://${host}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(req),
    });
    return res.json();
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
