import 'dotenv/config';

const host = process.env.RASA_HOST;

export async function callRasa(text: string) {
    const res: any = await fetch(`http://${host}/model/parse`, {
        method: 'POST',
        body: JSON.stringify({ text }),
    });

    return res.json();
}
