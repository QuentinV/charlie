import Polyglot from 'node-polyglot';
import fr from './fr.json';

const polyglot = new Polyglot({ phrases: fr });

export function t(key: string, params?: object) {
    return polyglot.t(key, params);
}
