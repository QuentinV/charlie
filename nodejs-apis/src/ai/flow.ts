import { callRasa } from './nlu';
import { actions } from '../tools/actions';
import { askDirect } from './llm';

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
    // First NLU for quick win
    const res = await callRasa(text);

    // nlu_fallback

    console.log(`Intent = ${res.intent}`);
    if (res.intent && actions[res.intent]) {
        const entities = res.entities;
        const params = entities.reduce((prev, e) => {
            prev[e.entity] = e.value;
            return prev;
        });
        console.log(
            `Intent = ${res.intent} with params = ${JSON.stringify(params)}`
        );
        const response = actions[res.intent](params);
        if (response === 'ok') {
            return positiveAnswers[Math.random() * positiveAnswers.length];
        }
    }

    if (process.env.BRAIN === 'SMART') {
        // Fallback to LLM for complex tasks or misunderstanding
        try {
            console.log(`Fallback to LLM`);
            return askDirect(text);
        } catch (e) {
            //
        }
    }

    return 'Désolé je ne comprends pas !';
}
