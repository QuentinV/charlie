import fs from 'fs';
import yaml from 'js-yaml';
import { compareTwoStrings } from 'string-similarity';

interface IntentConfig {
    starts: string[];
    slots?: string[];
}

interface SlotConfig {
    type: string;
    keys: string[];
}

type Synonyms = { [name: string]: string[] };

interface Config {
    intents: { [name: string]: IntentConfig };
    slots?: { [name: string]: SlotConfig };
    synonyms?: Synonyms;
}

const file = fs.readFileSync('./src/ai/nlu/intents.yml', 'utf8');
const config = yaml.load(file) as Config;

interface Intent {
    name: string;
    freeText?: string;
    slots?: { [key: string]: string };
}

function normalize(str: string) {
    return (
        str
            .toLowerCase()
            // Handle accent
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            // replace(/(\p{L})\1{2,}/gu, "$1") // collapse 3+ repeated letters
            .replace(/[.,;:!?]/g, '')
            .trim()
    );
}

function matchAndRemoveFuzzyPrefix(
    text: string,
    intent: string,
    threshold = 0.75
) {
    const textWords = text.trim().split(/\s+/);
    const intentWords = intent.trim().split(/\s+/);

    if (textWords.length < intentWords.length) {
        return;
    }

    const candidate = textWords.slice(0, intentWords.length).join(' ');
    const score = compareTwoStrings(normalize(candidate), normalize(intent));
    if (score < threshold) {
        return;
    }

    return textWords.slice(intentWords.length).join(' ').trim();
}

function extractIntent(text: string): { name: string; freeText?: string } {
    for (let intentKey in config.intents) {
        const intent = config.intents[intentKey];
        for (let j = 0; j < intent.starts.length; ++j) {
            const key = intent.starts[j];
            if (key === text) {
                return { name: intentKey };
            }
            const res = matchAndRemoveFuzzyPrefix(text, key);
            if (res !== undefined) {
                const r: Intent = { name: intentKey };
                if (res !== '') r.freeText = res;
                return r;
            }
        }
    }
}

const synFillingWords = [
    'le',
    'la',
    'les',
    'un',
    'une',
    'des',
    'du',
    'de',
    'dans',
];

function extractSynonyms(
    text: string,
    synonymKey: string,
    threeshold: number = 0.75
) {
    const normalizedText = normalize(text).replace(/l'/g, '');

    const textWords = normalizedText
        .split(/\s+/)
        .filter((s) => !synFillingWords.includes(s));

    const synonyms = config.synonyms[synonymKey];
    for (let i = 0; i < synonyms.length; ++i) {
        const syn = synonyms[i];
        const synWords = synonyms[i].split(/\s+/);
        if (textWords.length >= synWords.length) {
            for (let j = 0; j < textWords.length; ++j) {
                const w1 = textWords.slice(j, synWords.length).join(' ');

                if (
                    compareTwoStrings(normalize(w1), normalize(syn)) >
                    threeshold
                ) {
                    return {
                        name: synonymKey,
                        text: w1,
                        remainingText: textWords
                            .join(' ')
                            .replace(w1, '')
                            .trim(),
                    };
                }
            }
        }
    }
}

export interface FindIntentRequestOptions {}

export function findIntent(
    text: string,
    options?: FindIntentRequestOptions
): Intent | undefined {
    const baseIntent = extractIntent(text);
    if (!baseIntent) return;

    const intentConfig = config.intents[baseIntent.name];
    if (
        baseIntent.freeText === undefined ||
        !config.slots ||
        !intentConfig.slots?.length
    ) {
        return baseIntent;
    }

    // Resolve slots
    const intent: Intent = { ...baseIntent };
    let remainingText = baseIntent.freeText;
    intent.slots = intentConfig.slots.reduce(
        (prev, slotKey) => {
            const slotConfig = config.slots[slotKey];
            if (slotConfig.type === 'synonym') {
                for (let i = 0; i < slotConfig.keys.length; ++i) {
                    const synonymKey = slotConfig.keys[i];
                    const synonym = extractSynonyms(remainingText, synonymKey);
                    if (synonym) {
                        remainingText = synonym.remainingText;
                        prev[slotKey] = synonym.name;
                    }
                }
            } else if (remainingText) {
                prev[slotKey] = remainingText;
            }
            return prev;
        },
        {} as { [key: string]: string }
    );

    return intent;
}
