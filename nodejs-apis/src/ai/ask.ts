import 'dotenv/config';

const host = process.env.AI_AGENTS_HOST;

export async function ask(question: string) {
    const res = await fetch(`${host}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
    });
    const json = res.json();
    console.log(JSON.stringify(json));
}
