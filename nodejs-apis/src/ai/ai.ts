import { Mistral } from '@mistralai/mistralai';
import 'dotenv/config';

const apiKey = process.env.MISTRAL_API_KEY ?? '';

const mistral = new Mistral({ apiKey });

const agentId = 'ag:5415f6da:20250911:charlie:eb856c8e';

async function run() {
    await fetch(`https://api.mistral.ai/v1/agents/${agentId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tools: [
                {
                    type: 'mcp',
                    url: 'https://mymovies.freeboxos.fr:9301/mcp',
                },
            ],
        }),
    });

    const result = await mistral.agents.complete({
        agentId,
        messages: [
            {
                role: 'user',
                content: "What's the weather like in Marseille?",
            },
        ],
    });

    console.log(JSON.stringify(result));
}
