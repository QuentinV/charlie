import { RestApis } from '../types';
import { ask } from './llm';

const routes: RestApis = {
    'assistant/chat': {
        post: {
            handler: async ({ body }) => ask(body.message),
            description: 'Chat with assistant',
        },
    },
};

export default routes;
