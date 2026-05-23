import { useUnit } from 'effector-react';
import { settings } from './settings';

export function useSetting(key, defaultValue = false) {
    return useUnit(settings.$settings)[key] ?? defaultValue;
}

export function useSettings() {
    return useUnit(settings.$settings);
}

export function useSettingsSchema() {
    return useUnit(settings.$schema);
}
