import 'dotenv/config';
import { getTools, getToolsSchemas } from '../tools/mcp';
import { log as ogLog } from '../manager/services/activities';
import { Activity } from '../types';
import {
    LlmChatCompletionsChoicesTool,
    LlmChatCompletionsRequest,
} from './llm.types';

const host = process.env.LLM_HOST ?? 'llm:9308';
const LIMIT_TURN = 10;
const LLM_LANG_OUTPUT = process.env.LLM_LANGUAGE?.toUpperCase() ?? 'FRENCH';

function log(message: string, activity?: Activity) {
    return ogLog('LLM', message, activity);
}

// ===== Sessions =====
const sessions: { [id: string]: LlmChatCompletionsRequest } = {};

async function getSession(
    sessionId: string
): Promise<LlmChatCompletionsRequest> {
    if (!sessions[sessionId])
        sessions[sessionId] = {
            messages: [
                {
                    role: 'system',
                    content: 'You are an helpful home assistant named Charlie.',
                },
            ],
            tools: await getToolsSchemas(),
        };
    return sessions[sessionId];
}

// ===== Tool execution =====
async function execTool({
    function: { name, arguments: args },
}: LlmChatCompletionsChoicesTool): Promise<string> {
    try {
        const params = JSON.parse(args);

        log(`calling ${name}`, { context: { name: name, params } });

        const tool = (await getTools())?.[name];
        if (!tool) {
            throw new Error(`tool not found ${name}`);
        }

        const res = await tool?.exec(params);

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
export async function chat(
    sessionId: string,
    mesage: string,
    notif?: ({
        tools,
        mess,
    }: {
        tools: LlmChatCompletionsChoicesTool[];
        mess: string;
    }) => void
): Promise<string> {
    const session = await getSession(sessionId);

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
                            result: await execTool(t),
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
