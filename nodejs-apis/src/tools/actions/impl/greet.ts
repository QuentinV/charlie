import { ToolExecutionContext, Tools } from '../../../types';
import { t } from '../langs';

/**
 * Small-talk intents answer with a follow-up question to keep the exchange
 * going. Asked once per conversation that is nice; asked again it re-opens the
 * microphone on the very same question and loops forever ("Comment ça va ?" →
 * "Ça va bien, merci. Et toi ?" → …). The conversation log is the source of
 * truth: once one of them ran, later small talk closes with a statement.
 */
const SMALL_TALK_INTENTS = ['greet', 'howAreYou'];

export const tools: Tools = {
    greet: {
        exec: async (_req, ctx?: ToolExecutionContext) =>
            ctx?.memory?.hasIntent(SMALL_TALK_INTENTS)
                ? t('greet.again')
                : t('greet.response'),
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
