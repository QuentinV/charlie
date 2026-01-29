import { callRasa } from './nlu';
import { getActions } from '../tools/actions';
import { askDirect } from './llm';
import { Tools } from '../types';

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

export async function ask(text: string) {
    try {
        const actions: Tools = await getActions();

        // First NLU for quick win
        const res = await callRasa(text);

        // nlu_fallback

        console.log(`Intent = ${res?.intent?.name}`);
        if (res?.intent?.name && actions[res.intent.name]) {
            const entities = res.entities;
            const params = entities.reduce((prev, e) => {
                prev[e.entity] = e.value;
                return prev;
            }, {});
            console.log(
                `Intent = ${res.intent.name} with params = ${JSON.stringify(params)}`
            );
            //console.log(JSON.stringify(res));

            const response = await actions[res.intent.name].exec(params);
            if (response === true) {
                return positiveAnswers[Math.random() * positiveAnswers.length];
            } else if (response === false) {
                return `Je n'ai pas pu faire ça.`;
            } else if (response) {
                return response;
            }
        }

        if (process.env.BRAIN === 'SMART') {
            // Fallback to LLM for complex tasks or misunderstanding
            console.log(`Fallback to LLM`);
            return askDirect(text);
        }
    } catch (e) {}

    return 'Désolé je ne comprends pas !';
}
