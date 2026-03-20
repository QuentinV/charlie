import { getActions } from '../tools/actions';
import { askDirect } from './llm';
import { Tools } from '../types';
import { findIntent } from './nlu/nlu';
import { log } from '../manager/services/activities';

const positiveAnswers = [
    `Très bien, c'est fait.`,
    'Avec plaisir.',
    'Voilà qui est fait.',
    'Entendu.',
    `C'est en route.`,
    `Parfait, je m'en occupe.`,
    'Ok',
    `C'est réglé.`,
    `D'accord.`,
    `C'est fait`,
];

console.log(process.env.BRAIN);

export async function ask(
    text: string
): Promise<string | boolean | null | void> {
    try {
        const actions: Tools = await getActions();

        // First NLU for quick win
        const res = findIntent(text);

        log('nlu', 'Find intent', { context: { text }, data: res });
        if (res?.name && actions[res.name]) {
            const response = await actions[res.name].exec(res);
            if (response === true) {
                return positiveAnswers[Math.random() * positiveAnswers.length];
            } else if (response === false) {
                return false;
            } else if (response !== null) {
                return response;
            }
        } else {
            log('nlu', `Cannot find intent for ${text}`);
        }
    } catch (e) {}

    if (process.env.BRAIN === 'SMART') {
        try {
            // Fallback to LLM for complex tasks or misunderstanding
            log('nlu', `Fallback to LLM`);
            return askDirect(text);
        } catch (e) {}
    }

    return null;
}
