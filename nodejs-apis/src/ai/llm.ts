import 'dotenv/config';

const host = process.env.LLM_HOST ?? 'llm:9308';
const LIMIT_TURN = 10;

interface LlmChatCompletionsTools {
    name: string;
    description: string;
    parameters: any;
}

interface LlmChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
}

interface LlmChatCompletionsRequest {
    messages: LlmChatMessage[];
    tools: LlmChatCompletionsTools[];
}

interface LlmChatCompletionsChoices {
    finish_reason: 'tool_calls' | 'stop';
    index: number;
    message: {
        role: 'assistant';
        content: string;
        tool_calls?: {
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
            id: string;
        }[];
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

function execTool() {
    /**
         * Execute any tools by name with given parameters
         */
        CallTool: async (call) => {
            const { toolName, argumentsJson } = call.request;
            console.log(`LLM requested tool: ${toolName}`);

            const params = JSON.parse(argumentsJson);

            try {
                log('MCP Tools', `calling ${toolName}`, {
                    context: { name: toolName, params },
                });

                const tool = (await getTools())?.[toolName];
                if (!tool) {
                    return { errorMessage: 'not found' };
                }

                const res = await tool?.exec(params);

                if (res === true || res === false) {
                    return {
                        resultJson: JSON.stringify({ success: res }),
                    };
                } else if (res) {
                    return {
                        resultJson:
                            typeof res !== 'string' ? JSON.stringify(res) : res,
                    };
                }
            } catch (e) {
                return {
                    errorMessage: `An error occured.`,
                };
            }

            return { resultJson: JSON.stringify({ success: 'unknown' }) };
        },
      
}

export async function chat(sessionId: string, mesage: string, notif?: (mess: string) => void): Promise<string> {
    // TODO create session if not exist
    // TODO get tools
    // TODO add system prompt : you are an home assistant named Charlie.
    // TODO call LLM
    // TODO checkk for tool_calls, execute and return
    // TODO loop and verify  it doesn't reach MAX turn
    // udpate user with notif
    return 'ok';
}

export async function req(question: string): Promise<AskResponse> {
    const res = await fetch(`http://${host}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
    });
    return res.json();
}

export async function askDirect(question: string): Promise<string> {
    const json = await ask(question);
    return (
        json.output_entries[json.output_entries.length - 1]?.content ??
        'Je ne sais pas'
    );
}
