import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

/** localStorage key holding the chosen UI language. */
export const LANG_STORAGE_KEY = 'charlie.lang';

/** Languages shipped with the UI. French is the historical default. */
export const SUPPORTED_LANGS = ['fr', 'en'];

const DEFAULT_LANG = 'fr';

const readStoredLang = () => {
    try {
        const value = window.localStorage.getItem(LANG_STORAGE_KEY);
        return SUPPORTED_LANGS.includes(value) ? value : null;
    } catch {
        // Storage disabled (private mode): fall back to the browser language.
        return null;
    }
};

const detectLang = () => {
    const stored = readStoredLang();
    if (stored) return stored;
    const browser = (navigator?.language ?? '').slice(0, 2).toLowerCase();
    return SUPPORTED_LANGS.includes(browser) ? browser : DEFAULT_LANG;
};

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        fr: { translation: fr },
    },
    lng: detectLang(),
    fallbackLng: DEFAULT_LANG,
    supportedLngs: SUPPORTED_LANGS,
    // Settings come from the backend schema with dotted keys
    // (e.g. `settings.flow.agentic.enabled.title`), so translation keys are
    // flat literal strings: no dotted-path nesting and no namespaces.
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
});

const applyHtmlLang = (lng) => {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lng;
    }
};

applyHtmlLang(i18n.language);

i18n.on('languageChanged', (lng) => {
    applyHtmlLang(lng);
    try {
        window.localStorage.setItem(LANG_STORAGE_KEY, lng);
    } catch {
        // Storage disabled: the choice lasts until reload.
    }
});

export const changeLanguage = (lng) => i18n.changeLanguage(lng);

/**
 * Translates a standard, provider-agnostic state value (on/off, an HVAC mode…)
 * to the active language. Custom user values (a device name, a room name, a
 * user-defined property) must NOT go through this: they are rendered as-is.
 */
export const translateStandardValue = (t, value) => {
    if (value === null || value === undefined || value === '') return value;
    const key = `values.${String(value).toLowerCase()}`;
    return t(key, { defaultValue: value });
};

export default i18n;
