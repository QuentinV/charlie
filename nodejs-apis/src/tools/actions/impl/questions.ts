import { ToolExecutionContext, Tools } from '../../../types';
import { getWeather } from '../../../weather/service';
import { t } from '../langs';

/**
 * Intents whose reply asks a follow-up question. Several of them share the
 * policy: only one question per conversation, otherwise answering it matches
 * the same intent again and the exact same question loops forever.
 */
const SMALL_TALK_INTENTS = ['greet', 'howAreYou'];

export const tools: Tools = {
    askTime: {
        exec: async () =>
            `Il est ${new Date().toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            })}.`,
    },
    askDate: {
        exec: async () =>
            `Nous sommes le ${new Date().toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            })}.`,
    },
    askWeather: {
        exec: async () => {
            // The same reading the Météo device publishes and the echo screen
            // prints: one service, one answer, no second weather source.
            const reading = await getWeather();
            if (!reading) {
                // Location not configured or upstream unavailable → let the
                // caller know it is not possible rather than answering wrong.
                return false;
            }
            return t('weather.answer', {
                temp: reading.temperature,
                rain: reading.precipitation,
                windspeed: reading.windSpeed,
            });
        },
    },
    howAreYou: {
        exec: async (_req, ctx?: ToolExecutionContext) =>
            ctx?.memory?.hasIntent(SMALL_TALK_INTENTS)
                ? t('howAreYou.again')
                : t('howAreYou.response'),
    },
    whoAreYou: {
        exec: async () => t('whoAreYou.response'),
    },
};

export default tools;