import { getActions } from '../tools/actions';
import { askDirect } from './llm';
import { Tools } from '../types';
import { findIntent } from './nlu/nlu';

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

export async function ask(text: string) {
    try {
        const actions: Tools = await getActions();

        // First NLU for quick win
        const res = findIntent(text);

        console.log(`Intent = ${res?.name}`);
        if (res?.name && actions[res.name]) {
            console.log(
                `Intent = ${res.name} with params = ${JSON.stringify(res.slots)}`
            );
            //console.log(JSON.stringify(res));

            const response = await actions[res.name].exec(res);
            if (response === true) {
                return positiveAnswers[Math.random() * positiveAnswers.length];
            } else if (response === false) {
                return `Je n'ai pas pu faire ça.`;
            } else if (response !== null) {
                return response;
            }
        } else {
            console.log(`Cannot find intent for ${text}`);
        }
    } catch (e) {}

    if (process.env.BRAIN === 'SMART') {
        try {
            // Fallback to LLM for complex tasks or misunderstanding
            console.log(`Fallback to LLM`);
            return askDirect(text);
        } catch (e) {}
    }

    return 'Désolé je ne comprends pas !';
}
