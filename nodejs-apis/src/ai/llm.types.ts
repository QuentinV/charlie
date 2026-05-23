export interface LlmChatCompletionsTools {
    type: string;
    function?: {
        name: string;
        description: string;
        parameters: any;
    };
}

export interface LlmChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    name?: string;
}

export interface LlmChatCompletionsRequest {
    messages: LlmChatMessage[];
    tools: LlmChatCompletionsTools[];
}

export interface LlmChatCompletionsChoicesTool {
    type: 'function';
    function: { name: string; arguments: string };
    id: string;
}

export interface LlmChatCompletionsChoices {
    finish_reason: 'tool_calls' | 'stop';
    index: number;
    message: {
        role: 'assistant';
        content: string;
        tool_calls?: LlmChatCompletionsChoicesTool[];
    };
}

export interface LlmChatCompletionsResponse {
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
