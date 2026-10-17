/**
 * Home Assistant capability builder.
 *
 * Turns an HA entity (attributes + `get_services` catalogue) into charlie
 * capabilities:
 *   - `buildStateSchema` → the property schema advertised to the frontend,
 *   - `buildFunctions`   → callable functions derived from the catalogue,
 *   - `serviceCallFor`   → the service call applying a property write.
 *
 * Canonical property keys are HA's own attribute names, so no translation layer
 * exists. The per-domain semantics (which property maps to which service) live
 * in `domains.ts`; this file only knows how to apply them, and is used by the
 * Home Assistant provider — the only gateway whose devices are HA domains.
 */
import {
    CONTROL_BY_DOMAIN,
    FUNCTION_BLOCKLIST,
    FUNCTION_DOMAINS,
    LEVEL_FIELDS,
    LevelField,
    PARAM_OPTION_SOURCES,
    POWER_FEATURES,
    PropertyProfile,
    PropertyWrite,
    SUPPORTED_FEATURES,
    propertiesFor,
} from './domains';
import {
    FunctionInputField,
    PropertyValue,
    ProviderFunctionDef,
    StatePropertySchema,
} from '../../../types';

const firstDefined = (attrs: Record<string, any> = {}, names?: string[]) => {
    for (const name of names ?? []) {
        const value = attrs?.[name];
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
};

const asStringArray = (value: any): string[] =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];

const toNumber = (value: any, fallback?: number): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

/** The property a canonical key refers to (keys are HA attribute names). */
export function propertyFor(
    domain: string,
    key: string
): PropertyProfile | undefined {
    return propertiesFor(domain).find((property) => property.key === key);
}


// ===== Feature gating =====

/**
 * Whether a service can run on an entity, per the catalogue's own
 * `target.entity.supported_features` gate. Missing data and unknown feature
 * names fail open (never hide a capability we can't judge).
 */
export function serviceAllowed(
    service: any,
    supportedFeatures?: number
): boolean {
    const gates: string[] = service?.target?.entity?.supported_features ?? [];
    if (!Array.isArray(gates) || !gates.length || supportedFeatures == null) {
        return true;
    }
    return gates.some((gate) => {
        const bit = SUPPORTED_FEATURES[gate];
        return bit == null || (supportedFeatures & bit) !== 0;
    });
}

/** Same, for a single field of a service (`fields[].filter.supported_features`). */
export function fieldAllowed(
    service: any,
    field: string,
    supportedFeatures?: number
): boolean {
    const fields = service?.fields ?? {};
    if (!Object.keys(fields).length) return true;

    const definition = fields[field];
    if (!definition) return false;

    const gates: string[] = definition?.filter?.supported_features ?? [];
    if (!Array.isArray(gates) || !gates.length || supportedFeatures == null) {
        return true;
    }
    return gates.some((gate) => {
        const bit = SUPPORTED_FEATURES[gate];
        return bit == null || (supportedFeatures & bit) !== 0;
    });
}

/**
 * Whether an entity can power itself: the catalogue's own feature gate when the
 * service is known, else the domain's well-known TURN_ON bit. Domains HA does
 * not gate (lights, switches, covers…) always pass — so do unknown domains and
 * missing metadata: never hide a capability we cannot judge.
 */
export function canPower(
    domain: string,
    supportedFeatures?: number,
    services?: Record<string, any>
): boolean {
    const service = services?.[domain]?.turn_on;
    if (service) return serviceAllowed(service, supportedFeatures);

    const feature = POWER_FEATURES[domain];
    if (!feature || supportedFeatures == null) return true;
    const bit = SUPPORTED_FEATURES[feature];
    return bit == null ? true : (supportedFeatures & bit) !== 0;
}

/** The service+field a property write targets. */
export function writeTarget(
    write: PropertyWrite | undefined
): { service: string; field: string } | undefined {
    return write ? { service: write.service, field: write.field } : undefined;
}

/** Whether the catalogue advertises that read/write path for this entity. */
export function writeAvailable(
    domain: string,
    write: PropertyWrite | undefined,
    services?: Record<string, any>,
    supportedFeatures?: number
): boolean {
    const target = writeTarget(write);
    if (!target) return false;
    if (!services) return true; // no catalogue → fail open

    const service = services[domain]?.[target.service];
    if (!service) return false;

    return (
        serviceAllowed(service, supportedFeatures) &&
        fieldAllowed(service, target.field, supportedFeatures)
    );
}

/** Control profile advertised to the frontend (`CUSTOM_CONTROLS` key). */
export function controlProfileFor(domain: string): string | undefined {
    return CONTROL_BY_DOMAIN[domain];
}

// ===== Schema =====

function enumOptions(
    property: PropertyProfile,
    attrs: Record<string, any>
): { value: string; label: string }[] {
    const labels = property.labels ?? {};
    const excluded = property.optionExclude ?? [];

    const fromEntity = asStringArray(firstDefined(attrs, property.options)).filter(
        (value) => !excluded.includes(value)
    );

    // Static enums (no `options` attribute declared, e.g. hvac_action) fall
    // back to the profile's own vocabulary; value-driven ones don't.
    const values = fromEntity.length
        ? fromEntity
        : property.options?.length
          ? []
          : Object.keys(labels);

    return values.map((value) => ({ value, label: labels[value] ?? value }));
}

function schemaField(
    property: PropertyProfile,
    ctx: {
        domain: string;
        attrs: Record<string, any>;
        services?: Record<string, any>;
        supportedFeatures?: number;
    }
): StatePropertySchema | null {
    const base = {
        key: property.key,
        label: property.label,
        ...(property.unit ? { unit: property.unit } : {}),
    };

    if (property.readonly) {
        const options = enumOptions(property, ctx.attrs);
        const value = firstDefined(ctx.attrs, [property.key]);
        // Nothing reported -> the readout would be a permanent '-': emit it only
        // when the gateway has a value (or `always` declares it stable).
        if (!property.always && value === undefined) {
            return null;
        }
        return {
            ...base,
            type: property.type,
            readonly: true,
            ...(options.length ? { options } : {}),
        };
    }

    if (
        !writeAvailable(
            ctx.domain,
            property.write,
            ctx.services,
            ctx.supportedFeatures
        )
    ) {
        return null;
    }

    if (property.type === 'enum') {
        const options = enumOptions(property, ctx.attrs);
        if (!options.length) return null;
        return { ...base, type: 'enum', options };
    }

    // Non-enum writables need their source value to exist (unless the profile
    // marks them `always`) so we don't advertise e.g. a range control for a
    // gateway that reports no such attribute.
    if (
        !property.always &&
        firstDefined(ctx.attrs, [property.key]) === undefined
    ) {
        return null;
    }

    const [minAttr, maxAttr, stepAttr] = property.range ?? [];
    const min = toNumber(
        firstDefined(ctx.attrs, minAttr ? [minAttr] : undefined),
        property.defaults?.min
    );
    const max = toNumber(
        firstDefined(ctx.attrs, maxAttr ? [maxAttr] : undefined),
        property.defaults?.max
    );
    const step = toNumber(
        firstDefined(ctx.attrs, stepAttr ? [stepAttr] : undefined),
        property.defaults?.step
    );

    return {
        ...base,
        type: property.type,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
    };
}

/**
 * Whether the gateway proves a domain's `level` exists: it reports the
 * attribute carrying it, sets the HA feature bit that writes it, or lists a
 * colour mode other than the excluded ones. Missing metadata fails open, like
 * every other gate — never hide a level we cannot judge.
 */
function levelAllowed(
    level: LevelField,
    attrs: Record<string, any>,
    supportedFeatures?: number
): boolean {
    const { attributes, features, modes } = level;
    if (!attributes && !features && !modes) return true;

    if (
        attributes?.some(
            (name) => attrs?.[name] !== undefined && attrs?.[name] !== null
        )
    ) {
        return true;
    }

    if (
        features &&
        supportedFeatures != null &&
        features.some((feature) => {
            const bit = SUPPORTED_FEATURES[feature];
            return bit != null && (supportedFeatures & bit) !== 0;
        })
    ) {
        return true;
    }

    if (modes) {
        const list = asStringArray(attrs?.[modes.attribute]);
        if (list.some((value) => !modes.exclude.includes(value))) return true;
    }

    return supportedFeatures === undefined && !Object.keys(attrs ?? {}).length;
}

/**
 * Property schema for a device: the profile properties (when the domain has a
 * profile), then the domain's `level` field — when the gateway proves it.
 */
export function buildStateSchema({
    domain,
    attrs = {},
    services,
    supportedFeatures,
}: {
    domain: string;
    attrs?: Record<string, any>;
    services?: Record<string, any>;
    supportedFeatures?: number;
}): StatePropertySchema[] {
    const ctx = { domain, attrs, services, supportedFeatures };
    const schema: StatePropertySchema[] = [];

    for (const property of propertiesFor(domain)) {
        const field = schemaField(property, ctx);
        if (field) schema.push(field);
    }

    const level = LEVEL_FIELDS[domain];
    if (level && levelAllowed(level, attrs, supportedFeatures)) {
        // The evidence keys are provider metadata, never part of the wire
        // schema: only the advertised field itself is published.
        const field: Record<string, any> = { ...level };
        delete field.attributes;
        delete field.features;
        delete field.modes;
        schema.push(field as StatePropertySchema);
    }

    return schema;
}

// ===== Functions =====

function describeField(field: any): string {
    const selector = field?.selector ?? {};
    if (selector.number) {
        return `number ${selector.number.min ?? 0}..${selector.number.max ?? 100}`;
    }
    if (selector.boolean) return 'boolean';
    return 'string';
}

const humanize = (key: string): string =>
    key
        .replace(/[_.]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();

/**
 * Describe one service field for BOTH consumers: the legacy `params` strings
 * (LLM tool schemas) and an `inputSchema` the frontend renders as a control.
 * Options come from the selector itself or from an entity attribute declared in
 * `PARAM_OPTION_SOURCES` (e.g. media_player sources); a field HA leaves free —
 * `remote.send_command.command` — stays a free field, like in HA's own UI.
 */
function describeParams(
    domain: string,
    service: string,
    serviceDef: any,
    attrs: Record<string, any> = {}
): { params?: Record<string, string>; inputSchema?: FunctionInputField[] } {
    const entries = Object.entries(serviceDef?.fields ?? {});
    if (!entries.length) return {};

    const params: Record<string, string> = {};
    const inputSchema: FunctionInputField[] = [];
    const optionHints = PARAM_OPTION_SOURCES[domain]?.[service] ?? {};

    for (const [name, field] of entries) {
        const definition: any = field;
        params[name] = describeField(definition);

        const selector = definition?.selector ?? {};
        const type = selector.number
            ? 'number'
            : selector.boolean
              ? 'boolean'
              : 'string';

        // Options: the selector's own list, or an entity attribute (the hint
        // wins over the selector's `state.attribute`). Everything else stays a
        // free field — Charlie ships no vocabulary of its own.
        const explicit = selector.select?.options ?? selector.state?.options;
        const attribute = optionHints[name] ?? selector.state?.attribute;
        const rawOptions =
            explicit ?? (attribute ? attrs?.[attribute] : undefined);

        inputSchema.push({
            key: name,
            label: humanize(name),
            type,
            ...(Array.isArray(rawOptions) && rawOptions.length
                ? {
                      options: rawOptions.map((value: any) =>
                          typeof value === 'object'
                              ? {
                                    value: String(value.value ?? value),
                                    label: String(value.label ?? value.value ?? value),
                                }
                              : { value: String(value), label: humanize(String(value)) }
                      ),
                  }
                : {}),
            ...(selector.number && selector.number.unit_of_measurement
                ? { unit: selector.number.unit_of_measurement }
                : {}),
            ...(definition?.required ? { required: true } : {}),
        });
    }

    return { params, inputSchema };
}

/**
 * One entity contributing functions to a device: the device's own entity first,
 * then the sibling entities HA groups in the same physical device.
 */
export interface FunctionSource {
    domain: string;
    supportedFeatures?: number;
    /** Entity attributes — option lists resolve from them (e.g. `source_list`). */
    attrs?: Record<string, any>;
}

/**
 * Callable functions across sibling entities: each source contributes the
 * services its own domain advertises (feature-gated, fields described).
 *
 * Function names carry their domain (`remote.send_command`), which is how the
 * caller routes the call back to the entity that owns the service.
 */
export function buildFunctionsFor(
    sources: FunctionSource[],
    services?: Record<string, any>
): ProviderFunctionDef[] {
    if (!services) return [];

    const functions: ProviderFunctionDef[] = [];
    const seen = new Set<string>();

    for (const source of sources) {
        const { domain } = source;
        if (!FUNCTION_DOMAINS.has(domain)) continue;

        for (const [name, service] of Object.entries(services[domain] ?? {})) {
            const fullName = `${domain}.${name}`;
            if (seen.has(fullName) || FUNCTION_BLOCKLIST.has(fullName)) continue;
            if (!serviceAllowed(service, source.supportedFeatures)) continue;

            seen.add(fullName);
            functions.push({
                name: fullName,
                ...describeParams(domain, name, service, source.attrs),
            });
        }
    }

    return functions;
}

/**
 * Callable functions of a single entity (the common case): the services the
 * catalogue advertises for its domain, feature-gated, described from fields.
 */
export function buildFunctions(
    domain: string,
    services?: Record<string, any>,
    supportedFeatures?: number,
    attrs: Record<string, any> = {}
): ProviderFunctionDef[] {
    return buildFunctionsFor([{ domain, supportedFeatures, attrs }], services);
}

// ===== Writes =====

export interface ServiceCall {
    domain: string;
    service: string;
    data: Record<string, any>;
}

/**
 * Translate one canonical property into the service call applying it. Unknown /
 * read-only keys return `null` so a panel echoing the whole properties bag can
 * never write back state.
 */
export function serviceCallFor(
    domain: string,
    key: string,
    value: PropertyValue
): ServiceCall | null {
    const property = propertyFor(domain, key);
    if (!property?.write) return null;

    const cast = property.write.cast ?? 'string';
    const payload =
        cast === 'number'
            ? Number(value)
            : cast === 'boolean'
              ? Boolean(value)
              : String(value);

    return {
        domain,
        service: property.write.service,
        data: { [property.write.field]: payload },
    };
}


