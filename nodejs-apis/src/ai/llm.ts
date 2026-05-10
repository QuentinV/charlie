import 'dotenv/config';
import { getTools, getToolsSchemas } from '../tools/mcp';
import { log } from '../manager/services/activities';

const host = process.env.LLM_HOST ?? 'llm:9308';
const LIMIT_TURN = 10;

interface LlmChatCompletionsTools {
    type: string;
    function?: {
        name: string;
        description: string;
        parameters: any;
    };
}

interface LlmChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    name?: string;
}

interface LlmChatCompletionsRequest {
    messages: LlmChatMessage[];
    tools: LlmChatCompletionsTools[];
}

interface LlmChatCompletionsChoicesTool {
    type: 'function';
    function: { name: string; arguments: string };
    id: string;
}

interface LlmChatCompletionsChoices {
    finish_reason: 'tool_calls' | 'stop';
    index: number;
    message: {
        role: 'assistant';
        content: string;
        tool_calls?: LlmChatCompletionsChoicesTool[];
    };
}

interface LlmChatCompletionsResponse {
    choices: LlmChatCompletionsChoices[];
    created: number; // timestamp
    model: string;
    id: string;
    usage: {
        completion_tokens: number;
        prompt_tokens: number;
        total_tokens: number;
        prompt_tokens_details: {
            cached_tokens: number;
        };
    };
    timings: {
        cache_n: number;
        prompt_n: number;
        prompt_ms: number; // + predicted_ms = total
        prompt_per_token_ms: number;
        prompt_per_second: number;
        predicted_n: number;
        predicted_ms: number;
        predicted_per_token_ms: number;
        predicted_per_second: number;
    };
}

const sessions: { [id: string]: LlmChatCompletionsRequest } = {};

async function execTool({
    function: { name, arguments: args },
}: LlmChatCompletionsChoicesTool): Promise<string> {
    console.log(`LLM requested tool: ${name}`);

    const params = JSON.parse(args);

    try {
        log('MCP Tools', `calling ${name}`, {
            context: { name: name, params },
        });

        const tool = (await getTools())?.[name];
        if (!tool) {
            return 'tool not found';
        }

        const res = await tool?.exec(params);

        if (res === true || res === false) {
            return JSON.stringify({ success: res });
        } else if (res) {
            return typeof res !== 'string' ? JSON.stringify(res) : res;
        }
    } catch (e) {
        return `An error occured.`;
    }

    return JSON.stringify({ success: 'unknown' });
}

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
        content: mesage + '. TOUJOURS REPONDRE EN FRANCAIS.',
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
                    message.tool_calls.map(async (t) => ({
                        tool: t,
                        result: await execTool(t),
                    }))
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
        console.log(e);
        return 'An error occured';
    }

    return 'An unknown error occured';
}
