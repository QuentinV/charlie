import fs from 'fs';
import yaml from 'js-yaml';
import {
    compareTwoStrings,
    isFillingWord,
    normalize,
    normalizeAndSplit,
} from './utils';

interface IntentConfig {
    starts: string[];
    slots?: string[];
}

interface SlotConfig {
    type: string;
    keys: string[];
    filterFillingsWords?: boolean;
}

type Synonyms = { [name: string]: string[] };

interface Config {
    intents: { [name: string]: IntentConfig };
    slots?: { [name: string]: SlotConfig };
    synonyms?: Synonyms;
}

const file = fs.readFileSync('./src/ai/nlu/intents.yml', 'utf8');
const config = yaml.load(file) as Config;

export interface Intent {
    name: string;
    freeText?: string;
    confidence?: number;
    slots?: { [key: string]: string };
}

interface IntentMatch {
    name: string;
    freeText?: string;
    confidence: number;
}

/** IntentMatch plus the length of the matched trigger (used for tie-breaks). */
interface ScoredMatch extends IntentMatch {
    triggerLength: number;
}

const THRESHOLD = 0.75;

// Phrases silently stripped from the very start of an utterance (addressing
// the assistant, politeness and ability/modal phrasings) so that
// "peux-tu allumer la lumiere" matches like "allume la lumiere".
const LEAD_INS = [
    'charlie',
    'du coup',
    'alors',
    'ecoute',
    'dis moi',
    'dis donc',
    'dis',
    'tu sais quoi',
    's il te plait',
    'stp',
    's il vous plait',
    'svp',
    'peux tu',
    'est ce que tu peux',
    'est ce que tu pourrais',
    'est ce que tu veux',
    'tu peux',
    'tu pourrais',
    'pourrais tu',
    'pourrait tu',
    'je voudrais',
    'je voudrais bien',
    'je voudrai',
    'je veux',
    'j aimerais',
    'je te demande de',
];

// Phrases silently stripped once the trigger has been matched
// (trailing politeness / acknowledgement).
const TRAILING_POLITENESS = [
    's il te plait',
    'stp',
    's il vous plait',
    'svp',
    'merci',
    'merci beaucoup',
    'd accord',
];

// French number words -> digits (used by the `number` slot type).
const NUMBER_WORDS: Record<string, string> = {
    zero: '0',
    un: '1',
    une: '1',
    deux: '2',
    trois: '3',
    quatre: '4',
    cinq: '5',
    six: '6',
    sept: '7',
    huit: '8',
    neuf: '9',
    dix: '10',
    onze: '11',
    douze: '12',
    treize: '13',
    quatorze: '14',
    quinze: '15',
    seize: '16',
    vingt: '20',
    trente: '30',
    quarante: '40',
    cinquante: '50',
    soixante: '60',
    cent: '100',
    mille: '1000',
    demie: '0.5',
    demi: '0.5',
};

/**
 * Remove the given phrases (word-aligned, accent/case insensitive) from the
 * beginning (fromStart=true) or the end (fromStart=false) of a raw sentence,
 * preserving the original casing/accents of the remaining text.
 */
function stripPhrases(raw: string, phrases: string[], fromStart: boolean) {
    let cur = raw;
    let changed = true;
    while (changed) {
        changed = false;
        for (const phrase of phrases) {
            const np = normalize(phrase);
            const ncur = normalize(cur);
            if (!np) continue;
            if (fromStart) {
                if (ncur === np) {
                    cur = '';
                    changed = true;
                    break;
                }
                if (ncur.startsWith(`${np} `)) {
                    const count = np.split(/\s+/).length;
                    cur = cur.trim().split(/\s+/).slice(count).join(' ').trim();
                    changed = true;
                    break;
                }
            } else {
                if (ncur === np) {
                    cur = '';
                    changed = true;
                    break;
                }
                if (ncur.endsWith(` ${np}`)) {
                    const count = np.split(/\s+/).length;
                    const parts = cur.trim().split(/\s+/);
                    cur = parts.slice(0, parts.length - count).join(' ').trim();
                    changed = true;
                    break;
                }
            }
        }
    }
    return cur;
}

/**
 * Replace hyphens/apostrophes with spaces so raw word counts of an utterance
 * and of a trigger stay aligned ("est-ce que" / "non c'est" → plain words).
 */
function canonicalize(str: string): string {
    return str.replace(/[-–—'’]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface PrefixMatch {
    score: number;
    remaining: string;
}

function matchScore(text: string, trigger: string): PrefixMatch | undefined {
    const textWords = text.trim().split(/\s+/);
    const triggerWords = canonicalize(trigger).split(/\s+/);
    if (textWords.length < triggerWords.length) {
        return;
    }

    const candidate = textWords.slice(0, triggerWords.length).join(' ');
    const score = compareTwoStrings(candidate, trigger);
    if (score < THRESHOLD) {
        return;
    }

    const remaining = textWords
        .slice(triggerWords.length)
        .join(' ')
        // Do not keep trailing punctuation as free text (`Bonjour !`)
        .replace(/[.,;:!?]+$/, '')
        .trim();

    return { score, remaining };
}

/**
 * Score every (intent, trigger) candidate and keep the best match above the
 * threshold instead of the first one found. Exact matches score 1.0.
 */
function extractIntent(text: string): IntentMatch | undefined {
    let best: ScoredMatch | undefined;
    for (const intentKey in config.intents) {
        const intent = config.intents[intentKey];
        for (const trigger of intent.starts) {
            const res = matchScore(text, trigger);
            if (!res) continue;
            const triggerLength = canonicalize(trigger).split(/\s+/).length;
            // Keep the best score; on tie prefer the longest trigger so the
            // most specific intent wins, e.g. volumeDown's "baisse le volume"
            // over turnOffDevice's bare "baisse".
            if (
                best &&
                (res.score < best.confidence ||
                    (res.score === best.confidence &&
                        triggerLength <= best.triggerLength))
            ) {
                continue;
            }
            const match: ScoredMatch = {
                name: intentKey,
                confidence: res.score,
                triggerLength,
            };
            if (res.remaining) {
                match.freeText = res.remaining;
            }
            best = match;
        }
    }
    return best;
}

/**
 * Search `words` for a synonym of `synonymKey` and remove the *exact* matched
 * span (word-aligned, so earlier/other words are never corrupted).
 */
function extractSynonyms(
    words: string[],
    synonymKey: string,
    threshold: number,
    filterFillingsWords = true
): { name: string; remainingWords: string[] } | undefined {
    const synonyms = config.synonyms?.[synonymKey];
    if (!synonyms || !words.length) {
        return;
    }

    // Search view: optionally drop filling words, keeping a map to the
    // original indices so we can remove the exact matched span.
    const viewWords: string[] = [];
    const viewIdx: number[] = [];
    for (let i = 0; i < words.length; ++i) {
        if (filterFillingsWords && isFillingWord(words[i])) {
            continue;
        }
        viewWords.push(words[i]);
        viewIdx.push(i);
    }

    for (const syn of synonyms) {
        const synWords = syn.split(/\s+/);
        if (viewWords.length < synWords.length) {
            continue;
        }
        for (let j = 0; j + synWords.length <= viewWords.length; ++j) {
            const cand = viewWords.slice(j, j + synWords.length);
            if (compareTwoStrings(cand.join(' '), syn) > threshold) {
                const matched = new Set(viewIdx.slice(j, j + synWords.length));
                const remainingWords = words.filter(
                    (_, idx) => !matched.has(idx)
                );
                return { name: synonymKey, remainingWords };
            }
        }
    }
}

/**
 * Extract the first number (digit or French number word) from `words`.
 */
function extractNumber(
    words: string[]
): { value: string; remainingWords: string[] } | undefined {
    for (let i = 0; i < words.length; ++i) {
        const w = words[i];
        if (/^[0-9]+([.,][0-9]+)?$/.test(w)) {
            return {
                value: w.replace(',', '.'),
                remainingWords: words.filter((_, idx) => idx < i || idx > i),
            };
        }
        if (NUMBER_WORDS[w]) {
            return {
                value: NUMBER_WORDS[w],
                remainingWords: words.filter((_, idx) => idx < i || idx > i),
            };
        }
    }
}

export interface FindIntentRequestOptions {
    /** When true, the returned intent carries a 0..1 confidence score. */
    withConfidence?: boolean;
}

export function findIntent(
    text: string,
    options?: FindIntentRequestOptions
): Intent | undefined {
    const canonical = canonicalize(text);
    let prepped = stripPhrases(
        stripPhrases(canonical, LEAD_INS, true),
        TRAILING_POLITENESS,
        false
    );
    if (!prepped) {
        // The whole utterance is politeness only (e.g. "merci", "d'accord"):
        // keep it so intents like `thanks` / `confirm` can still match it.
        prepped = canonical;
    }

    const baseIntent = extractIntent(prepped);
    if (!baseIntent) {
        return;
    }

    const withConfidence = !!options?.withConfidence;

    const intentConfig = config.intents[baseIntent.name];
    if (
        baseIntent.freeText === undefined ||
        !config.slots ||
        !intentConfig.slots?.length
    ) {
        const r: Intent = { name: baseIntent.name };
        if (baseIntent.freeText !== undefined) {
            r.freeText = baseIntent.freeText;
        }
        if (withConfidence && baseIntent.confidence !== undefined) {
            r.confidence = baseIntent.confidence;
        }
        return r;
    }

    const intent: Intent = { name: baseIntent.name };
    if (baseIntent.freeText !== undefined) {
        intent.freeText = baseIntent.freeText;
    }
    if (withConfidence && baseIntent.confidence !== undefined) {
        intent.confidence = baseIntent.confidence;
    }

    let remainingWords = normalize(baseIntent.freeText ?? '').split(/\s+/);
    intent.slots = {};
    for (const slotKey of intentConfig.slots) {
        const slotConfig = config.slots[slotKey];
        if (!slotConfig) {
            continue;
        }
        if (slotConfig.type === 'number') {
            const num = extractNumber(remainingWords);
            if (num) {
                intent.slots[slotKey] = num.value;
                remainingWords = num.remainingWords;
            }
        } else if (slotConfig.type === 'synonym') {
            for (const synonymKey of slotConfig.keys) {
                const syn = extractSynonyms(
                    remainingWords,
                    synonymKey,
                    THRESHOLD,
                    slotConfig.filterFillingsWords !== false
                );
                if (syn) {
                    remainingWords = syn.remainingWords;
                    intent.slots[slotKey] = syn.name;
                    break;
                }
            }
        } else {
            if (remainingWords.length) {
                const joined = remainingWords.join(' ');
                const value =
                    slotConfig.filterFillingsWords === false
                        ? joined
                        : normalizeAndSplit(joined, true).join(' ');
                if (value) {
                    intent.slots[slotKey] = value;
                }
            }
        }
    }

    return intent;
}