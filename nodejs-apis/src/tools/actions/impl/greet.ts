import { Tools } from '../../../types';
import { t } from '../langs';

export const tools: Tools = {
    greet: {
        exec: async () => t('greet.response'),
    },
    stop: {
        exec: async () => 'ok',
    },
};

export default tools;
