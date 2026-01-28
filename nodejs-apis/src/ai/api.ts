import { RestApis } from '../types';
import { ask } from './flow';

const routes: RestApis = {
    'assistant/chat': {
        post: {
            handler: async ({ body }) => ask(body.message),
            description: 'Chat with assistant',
        },
    },
};

export default routes;
