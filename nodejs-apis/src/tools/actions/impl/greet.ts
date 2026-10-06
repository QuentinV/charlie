import { Tools } from '../../../types';
import { t } from '../langs';

export const tools: Tools = {
    greet: {
        exec: async () => t('greet.response'),
    },
    thanks: {
        exec: async () => t('thanks.response'),
    },
    goodbye: {
        exec: async () => t('goodbye.response'),
    },
    confirm: {
        exec: async () => t('confirm.response'),
    },
    deny: {
        exec: async () => t('deny.response'),
    },
    stop: {
        exec: async () => 'ok',
    },
};

export default tools;
