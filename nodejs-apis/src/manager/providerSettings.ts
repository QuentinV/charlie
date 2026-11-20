import { PropertyValue, Provider } from '../types';

/**
 * Provider-row settings, pure and generic: a provider module declares its
 * fields (`ProvidersApis.settings`), the Providers page dialog renders them and
 * these two helpers move the values in and out of the document.
 *
 * `host` is **reserved**: it stays `Provider.host` (the endpoint/address a
 * codesource already owns — for a camera, the stream URL or the webcam index)
 * and is never duplicated into `properties`. Every other key lives in
 * `properties`, the same flat vocabulary as `DeviceState.properties`.
 */

/** The values a provider's settings dialog renders. */
export function providerSettingsValues(
    provider?: Provider | null
): Record<string, PropertyValue> {
    return {
        ...(provider?.properties ?? {}),
        host: provider?.host ?? '',
    };
}

/**
 * Merge what the dialog sent back into a provider row. An emptied value is
 * **dropped** rather than stored as `''`, so an unset setting reads as unset;
 * keys the codesource does not know are kept (a provider may own extras).
 */
export function providerSettingsUpdate(
    values: Record<string, PropertyValue>,
    prev?: Provider | null
): { host?: string; properties: Record<string, PropertyValue> } {
    const properties: Record<string, PropertyValue> = {
        ...(prev?.properties ?? {}),
    };

    for (const [key, value] of Object.entries(values ?? {})) {
        if (key === 'host') continue;
        // An emptied setting is *unset*: `''`/whitespace/null all mean "no
        // value", never a stored empty string.
        if (
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim())
        ) {
            delete properties[key];
        } else {
            properties[key] =
                typeof value === 'string' ? value.trim() : value;
        }
    }

    const host = String(values?.host ?? '').trim() || undefined;
    return { host, properties };
}