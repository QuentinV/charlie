import 'dotenv/config';

const host = process.env.AI_AGENTS_HOST;

interface AskResponse {
    input_entries: { role: 'user' | 'assistant'; content: string }[];
    conversation_id: string;
    output_entries: {
        id?: string;
        tool_call_id?: string;
        name?: string;
        arguments?: string;
        result?: string;
        type?: 'function.call' | 'message.output' | 'function.result';
        created_at?: string;
        completed_at?: string;
        agent_id?: string;
        model?: string;
        content?: string;
    }[];
}

export async function ask(question: string): Promise<AskResponse> {
    const res = await fetch(`${host}/ask`, {
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
