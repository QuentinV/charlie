import { completable } from '@modelcontextprotocol/sdk/server/completable.js';

server.registerPrompt(
    'review-code',
    {
        title: 'Code Review',
        description: 'Review code for best practices and potential issues',
        argsSchema: { code: z.string() },
    },
    ({ code }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Please review this code:\n\n${code}`,
                },
            },
        ],
    })
);

// Prompt with context-aware completion
server.registerPrompt(
    'team-greeting',
    {
        title: 'Team Greeting',
        description: 'Generate a greeting for team members',
        argsSchema: {
            department: completable(z.string(), (value) => {
                // Department suggestions
                return ['engineering', 'sales', 'marketing', 'support'].filter(
                    (d) => d.startsWith(value)
                );
            }),
            name: completable(z.string(), (value, context) => {
                // Name suggestions based on selected department
                const department = context?.arguments?.['department'];
                if (department === 'engineering') {
                    return ['Alice', 'Bob', 'Charlie'].filter((n) =>
                        n.startsWith(value)
                    );
                } else if (department === 'sales') {
                    return ['David', 'Eve', 'Frank'].filter((n) =>
                        n.startsWith(value)
                    );
                } else if (department === 'marketing') {
                    return ['Grace', 'Henry', 'Iris'].filter((n) =>
                        n.startsWith(value)
                    );
                }
                return ['Guest'].filter((n) => n.startsWith(value));
            }),
        },
    },
    ({ department, name }) => ({
        messages: [
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `Hello ${name}, welcome to the ${department} team!`,
                },
            },
        ],
    })
);

// Client
// Request completions for any argument
const result = await client.complete({
    ref: {
        type: 'ref/prompt', // or "ref/resource"
        name: 'example', // or uri: "template://..."
    },
    argument: {
        name: 'argumentName',
        value: 'partial', // What the user has typed so far
    },
    context: {
        // Optional: Include previously resolved arguments
        arguments: {
            previousArg: 'value',
        },
    },
});
