import { z } from 'zod';
import { Tools } from '../../../types';

const tools: Tools = {
    greeting: {
        description: 'Dynamic greeting generator',
        inputSchema: { username: z.string() },
        exec: async ({ username }: { username: string }) =>
            `Hello, ${username}!`,
    },
};

export default tools;
