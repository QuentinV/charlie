import { compareTwoStrings as cts } from 'string-similarity';

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
    'par',
    'à',
    'en',
];

export function isFillingWord(word: string) {
    return synFillingWords.includes(word);
}

export function normalizeAndSplit(text: string, filterFillingsWords?: boolean) {
    let res = normalize(text).split(/\s+/);
    if (filterFillingsWords) {
        res = res.filter((s) => !synFillingWords.includes(s));
    }
    return res;
}

export function normalize(str: string) {
    return (
        str
            .toLowerCase()
            // Handle accent
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            // replace(/(\p{L})\1{2,}/gu, "$1") // collapse 3+ repeated letters
            .replace(/[.,;:!?]/g, '')
            // Treat hyphens / apostrophes as plain separators so that
            // "est-ce que" / "peux-tu" / "non c'est" match their trigger
            // written with spaces ("est ce que" / "peux tu" / "non c'est").
            .replace(/[-–—'’]/g, ' ')
            // Collapse the extra whitespaces created above
            .replace(/\s+/g, ' ')
            .trim()
    );
}

export function compareTwoStrings(a: string, b: string): number {
    return cts(normalize(a), normalize(b));
}
