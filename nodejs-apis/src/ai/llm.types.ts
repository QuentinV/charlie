export interface LlmChatCompletionsTools {
    type: string;
    function?: {
        name: string;
        description: string;
        parameters: any;
    };
}

/**
 * One part of a multimodal message (llama.cpp's OpenAI-compatible API). A
 * vision message is `[{ type: 'image_url', … }, { type: 'text', … }]`.
 */
export interface LlmChatContentPart {
    type: 'text' | 'image_url';
    /** Set when `type` is `text`. */
    text?: string;
    /**
     * Set when `type` is `image_url`: an http(s) URL, or a
     * `data:image/<type>;base64,<payload>` URL (what a camera snapshot gives).
     */
    image_url?: { url: string };
}

export interface LlmChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** Plain text, or content parts for a multimodal (vision) message. */
    content: string | LlmChatContentPart[];
    tool_call_id?: string;
    name?: string;
}

export interface LlmChatCompletionsRequest {
    messages: LlmChatMessage[];
    tools: LlmChatCompletionsTools[];
    response_format?: any;
    /**
     * Model id to route the request to. Router mode (`llama-server
     * --models-dir`) loads the model on demand when it is not loaded yet and
     * keeps it warm afterwards; left undefined for a single-model server.
     */
    model?: string;
    /** Extraction tasks want the greedy default, not creativity. */
    temperature?: number;
    /** Upper bound on the answer, so a confused small model cannot ramble. */
    max_tokens?: number;
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
