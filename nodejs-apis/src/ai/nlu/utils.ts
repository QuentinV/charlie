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
];

export function normalizeAndSplit(text: string, filterFillingsWords?: boolean) {
    let res = text.split(/\s+/);
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
            .trim()
    );
}

export function compareTwoStrings(a: string, b: string): number {
    return cts(normalize(a), normalize(b));
}
