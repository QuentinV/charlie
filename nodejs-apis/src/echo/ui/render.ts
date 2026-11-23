import { load, type CheerioAPI } from 'cheerio';

import {
    UI_BUNDLE_SCHEMA,
    UI_LIMITS,
    UiAction,
    UiBundle,
    UiBundleIssue,
    UiEventMap,
    UiNode,
    UiNodeType,
    UiPage,
    UiStyle,
    UiTheme,
    UiVar,
    collectTemplatePaths,
    sealBundle,
    validateBundle,
} from './schema';

/**
 * HTML -> `ui.bundle/1` compiler.
 *
 * The brain authors screens as HTML; the device never sees HTML. This module
 * turns that markup into the widget-tree bundle the ESP32 renders with LVGL:
 *
 *   * one `<section data-page="...">` per page, whose children are the root
 *     widget's children;
 *   * semantic elements (`<h1>`, `<p>`, `<button>`, `<img>`, `<hr>`, `<ul>`, ...)
 *     map to widget types, so ordinary markup stays readable;
 *   * `data-*` attributes carry style and events, mirroring the JSON contract;
 *   * `{{path}}` references inside text are preserved verbatim — the device
 *     resolves them, not the server.
 *
 * Layout runs on the device (LVGL flex), so the same page reflows onto both the
 * 800x1280 main panel and the 480x320 aux panel. Declaring `data-targets` on a
 * page narrows it to one panel; the default is both.
 *
 * Validation is the same `validateBundle()` the publish path uses, so a bundle
 * that compiles here is a bundle the device will accept. Undeclared variables
 * referenced by a template or an action are declared automatically (`core.*`
 * local, `external.*` remote with a default ttl) so authors do not have to
 * maintain a separate variable list.
 */

/* --------------------------------------------------------------- defaults */

/** Theme used when the markup does not declare one. */
export const UI_HTML_DEFAULT_THEME: UiTheme = {
    bg: '#0E1216',
    surface: '#1A212A',
    text: '#E6EDF3',
    muted: '#93A0B0',
    accent: '#E6A94D',
    radius: 12,
};

/** Default ttl for `external.*` variables auto-declared from templates. */
export const UI_HTML_DEFAULT_EXTERNAL_TTL = 5000;

export interface CompileHtmlOptions {
    /** Revision to stamp on the bundle. Defaults to 1. */
    rev?: number;
    /** Theme override; otherwise `<meta name="ui-theme">`, else the default. */
    theme?: UiTheme;
    /** Extra variable declarations merged over the ones read from the markup. */
    vars?: Record<string, UiVar>;
    /** Panel -> default page. Otherwise `<meta name="ui-defaults">`, else inferred. */
    defaults?: { main?: string; aux?: string };
    /** ISO timestamp; defaults to now. */
    generatedAt?: string;
    /** ttl given to auto-declared `external.*` variables. */
    externalTtl?: number;
}

export interface CompileHtmlResult {
    ok: boolean;
    bundle?: UiBundle;
    issues: UiBundleIssue[];
}

/** Thrown by `compileHtml()` when the markup does not produce a valid bundle. */
export class UiCompileError extends Error {
    readonly issues: UiBundleIssue[];

    constructor(message: string, issues: UiBundleIssue[] = []) {
        super(message);
        this.name = 'UiCompileError';
        this.issues = issues;
    }
}

/* ------------------------------------------------------------- action spec */

/** Turn a shorthand value into a typed scalar (`true`, `42`, `2.5`, else text). */
function coerceScalar(raw: string): string | number | boolean {
    const text = raw.trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
    if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
    return text;
}

/**
 * Parse one shorthand action, e.g. `navigate:home` or
 * `call:devices.toggle?{"name":"Chambre"}`.
 *
 * The shorthand exists so markup stays readable; anything that needs nesting
 * (`if`, `wait`) should be written as JSON in the attribute instead.
 */
function parseShorthandAction(spec: string): UiAction {
    const text = spec.trim();
    const colon = text.indexOf(':');
    const verb = (colon === -1 ? text : text.slice(0, colon)).trim();
    const arg = colon === -1 ? '' : text.slice(colon + 1).trim();

    switch (verb) {
        case 'navigate':
            return { do: 'navigate', page: arg };
        case 'back':
            return { do: 'back' };
        case 'reload':
            return { do: 'reload' };
        case 'setVar': {
            const eq = arg.indexOf('=');
            if (eq === -1) {
                throw new UiCompileError(`setVar needs "path=value", got "${spec}"`);
            }
            return {
                do: 'setVar',
                path: arg.slice(0, eq).trim(),
                value: coerceScalar(arg.slice(eq + 1)),
            };
        }
        case 'toggleVar':
            return { do: 'toggleVar', path: arg };
        case 'show':
            return { do: 'show', id: arg };
        case 'hide':
            return { do: 'hide', id: arg };
        case 'enable':
            return { do: 'enable', id: arg };
        case 'disable':
            return { do: 'disable', id: arg };
        case 'wait':
            return { do: 'wait', ms: Number(arg) || 0 };
        case 'call': {
            const q = arg.indexOf('?');
            const name = (q === -1 ? arg : arg.slice(0, q)).trim();
            if (q === -1) {
                return { do: 'call', action: name };
            }
            const params = JSON.parse(arg.slice(q + 1)) as Record<string, unknown>;
            return { do: 'call', action: name, params };
        }
        default:
            throw new UiCompileError(`unknown action shorthand "${verb}" in "${spec}"`);
    }
}

/**
 * Parse an action attribute.
 *
 * Accepts a JSON array/object, or one or more shorthand actions separated by
 * `;`. Returns an empty array for a blank attribute.
 */
export function parseActionSpec(raw: string): UiAction[] {
    const text = raw.trim();
    if (!text) {
        return [];
    }
    if (text.startsWith('[') || text.startsWith('{')) {
        const parsed = JSON.parse(text) as UiAction | UiAction[];
        return Array.isArray(parsed) ? parsed : [parsed];
    }
    return text
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map(parseShorthandAction);
}

/* ------------------------------------------------------------ attribute I/O */

/** The element type cheerio hands back; kept loose so the file stays portable. */
type HtmlElement = any;

function attr($: CheerioAPI, el: HtmlElement, name: string): string | undefined {
    const value = $(el).attr(name);
    return value === undefined ? undefined : value;
}

function attrNumber($: CheerioAPI, el: HtmlElement, name: string): number | undefined {
    const raw = attr($, el, name);
    if (raw === undefined || raw.trim() === '') {
        return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function attrBool($: CheerioAPI, el: HtmlElement, name: string): boolean {
    const raw = attr($, el, name);
    if (raw === undefined) {
        return false;
    }
    const text = raw.trim().toLowerCase();
    return text === '' || text === 'true' || text === '1' || text === name;
}

/** `40`, `"50%"`, `"content"` — everything the schema accepts as a size. */
function parseSize(raw: string | undefined): number | string | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const text = raw.trim();
    if (!text) {
        return undefined;
    }
    if (text.endsWith('%') || text === 'content') {
        return text;
    }
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
}

/** `12`, `"theme.radius"` — number or a theme token. */
function parseRadius(raw: string | undefined): number | string | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const text = raw.trim();
    if (!text) {
        return undefined;
    }
    const value = Number(text);
    return Number.isFinite(value) ? value : text;
}

/* ------------------------------------------------------------- type mapping */

const TEXT_TAGS = new Set([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'span',
    'small',
    'strong',
    'em',
    'b',
    'i',
    'label',
    'blockquote',
    'code',
    'pre',
]);

const HEADING_SIZE: Record<string, number> = {
    h1: 56,
    h2: 40,
    h3: 28,
    h4: 20,
    h5: 20,
    h6: 20,
};

const CLASS_TYPES: Record<string, UiNodeType> = {
    screen: 'screen',
    row: 'row',
    col: 'col',
    column: 'col',
    scroll: 'scroll',
    list: 'list',
    text: 'text',
    button: 'button',
    image: 'image',
    divider: 'divider',
    bar: 'bar',
    toggle: 'toggle',
};

const TAG_TYPES: Record<string, UiNodeType> = {
    main: 'screen',
    section: 'screen',
    nav: 'row',
    ul: 'list',
    ol: 'list',
    li: 'row',
    hr: 'divider',
    img: 'image',
    button: 'button',
    progress: 'bar',
    meter: 'bar',
    a: 'button',
};

/** Resolve the widget type for an element: `data-type`, then class, then tag. */
function resolveType($: CheerioAPI, el: HtmlElement): UiNodeType | undefined {
    const explicit = attr($, el, 'data-type');
    if (explicit) {
        const type = explicit.trim() as UiNodeType;
        if (Object.prototype.hasOwnProperty.call(CLASS_TYPES, type)) {
            return type;
        }
        return undefined;
    }

    const classAttr = attr($, el, 'class');
    if (classAttr) {
        for (const token of classAttr.split(/\s+/)) {
            const type = CLASS_TYPES[token];
            if (type) {
                return type;
            }
        }
    }

    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
    if (TEXT_TAGS.has(tag)) {
        return 'text';
    }
    if (TAG_TYPES[tag]) {
        return TAG_TYPES[tag];
    }
    if (tag === 'input') {
        const type = (attr($, el, 'type') ?? '').toLowerCase();
        return type === 'checkbox' ? 'toggle' : undefined;
    }
    if (tag === 'div' || tag === 'article' || tag === 'header' || tag === 'footer') {
        return 'col';
    }
    return undefined;
}

/* ------------------------------------------------------------ style compile */

/** Build the widget style from `data-*` attributes. Empty when nothing is set. */
function compileStyle($: CheerioAPI, el: HtmlElement, type: UiNodeType): UiStyle {
    const style: UiStyle = {};

    const flex = attr($, el, 'data-flex');
    if (flex === 'row' || flex === 'column') {
        style.flex = flex;
    } else if (type === 'row' || type === 'list' || type === 'screen' || type === 'col' || type === 'scroll') {
        style.flex = type === 'row' ? 'row' : 'column';
    }

    const gap = attrNumber($, el, 'data-gap');
    if (gap !== undefined) style.gap = gap;

    const pad = attrNumber($, el, 'data-pad');
    if (pad !== undefined) style.pad = pad;

    const padX = attrNumber($, el, 'data-pad-x');
    if (padX !== undefined) style.padX = padX;

    const padY = attrNumber($, el, 'data-pad-y');
    if (padY !== undefined) style.padY = padY;

    const grow = attrNumber($, el, 'data-grow');
    if (grow === 0 || grow === 1) style.grow = grow;

    const w = parseSize(attr($, el, 'data-w'));
    if (w !== undefined) style.w = w;

    const h = parseSize(attr($, el, 'data-h'));
    if (h !== undefined) style.h = h;

    const bg = attr($, el, 'data-bg');
    if (bg) style.bg = bg;

    const color = attr($, el, 'data-color');
    if (color) style.color = color;

    const radius = parseRadius(attr($, el, 'data-radius'));
    if (radius !== undefined) style.radius = radius;

    const align = attr($, el, 'data-align');
    if (align === 'left' || align === 'center' || align === 'right') style.align = align;

    const valign = attr($, el, 'data-valign');
    if (valign === 'top' || valign === 'middle' || valign === 'bottom') style.valign = valign;

    const scrollDir = attr($, el, 'data-scroll');
    if (scrollDir === 'v' || scrollDir === 'h' || scrollDir === 'none') style.scrollDir = scrollDir;

    const precision = attrNumber($, el, 'data-precision');
    if (precision !== undefined && precision >= 0 && precision <= 4) style.precision = precision;

    const opacity = attrNumber($, el, 'data-opacity');
    if (opacity !== undefined && opacity >= 0 && opacity <= 255) style.opacity = opacity;

    const borderWidth = attrNumber($, el, 'data-border');
    if (borderWidth !== undefined) {
        style.border = {
            w: borderWidth,
            color: attr($, el, 'data-border-color') ?? 'theme.muted',
        };
    }

    /* Font size: explicit `data-size`, else the heading's natural size. */
    const explicitSize = attrNumber($, el, 'data-size');
    if (explicitSize !== undefined && [12, 16, 20, 28, 40, 56].includes(explicitSize)) {
        style.size = explicitSize as UiStyle['size'];
    } else if (type === 'text') {
        const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
        const natural = HEADING_SIZE[tag];
        if (natural !== undefined) {
            style.size = natural as UiStyle['size'];
        }
    }

    return style;
}

/* ------------------------------------------------------------ event compile */

const GESTURE_ATTRS: Record<string, keyof NonNullable<UiEventMap['gesture']>> = {
    'data-on-gesture-swipeleft': 'swipeLeft',
    'data-on-gesture-swiperight': 'swipeRight',
    'data-on-gesture-swipeup': 'swipeUp',
    'data-on-gesture-swipedown': 'swipeDown',
    'data-on-gesture-forward': 'forward',
    'data-on-gesture-backward': 'backward',
};

/** Build the event map from `data-on-*` attributes. Undefined when nothing is set. */
function compileEvents($: CheerioAPI, el: HtmlElement): UiEventMap | undefined {
    const on: UiEventMap = {};

    const tap = attr($, el, 'data-on-tap');
    if (tap) on.tap = parseActionSpec(tap);

    const longPress = attr($, el, 'data-on-longpress');
    if (longPress) on.longPress = parseActionSpec(longPress);

    const enter = attr($, el, 'data-on-enter');
    if (enter) on.enter = parseActionSpec(enter);

    const leave = attr($, el, 'data-on-leave');
    if (leave) on.leave = parseActionSpec(leave);

    const interval = attr($, el, 'data-on-interval');
    if (interval) {
        on.interval = JSON.parse(interval) as NonNullable<UiEventMap['interval']>;
    }

    const varSpec = attr($, el, 'data-on-var');
    if (varSpec) {
        on.var = JSON.parse(varSpec) as NonNullable<UiEventMap['var']>;
    }

    const gestures: Record<string, UiAction[]> = {};
    for (const [attribute, gesture] of Object.entries(GESTURE_ATTRS)) {
        const raw = attr($, el, attribute);
        if (raw) {
            gestures[gesture] = parseActionSpec(raw);
        }
    }
    if (Object.keys(gestures).length > 0) {
        on.gesture = gestures as NonNullable<UiEventMap['gesture']>;
    }

    return Object.keys(on).length > 0 ? on : undefined;
}

/* ------------------------------------------------------------- node compile */

/** Widget types that may contain children. */
const CONTAINER_TYPES = new Set<UiNodeType>(['screen', 'row', 'col', 'scroll', 'list', 'button']);

interface NodeOptions {
    /** Force the widget type (used to make every page root a `screen`). */
    forceType?: UiNodeType;
    /** Skip `data-on-*` (page-level events belong to the page, not its root). */
    skipEvents?: boolean;
}

function compileNode(
    $: CheerioAPI,
    el: HtmlElement,
    depth: number,
    pageId: string,
    issues: UiBundleIssue[],
    options: NodeOptions = {}
): UiNode | null {
    if (depth > UI_LIMITS.depth) {
        issues.push({
            path: `${pageId}.root`,
            message: `nesting deeper than ${UI_LIMITS.depth} levels`,
        });
        return null;
    }

    const type = options.forceType ?? resolveType($, el);
    if (type === undefined) {
        return null;
    }

    const node: UiNode = { type };

    const id = attr($, el, 'id');
    if (id) {
        node.id = id;
    }

    const style = compileStyle($, el, type);
    if (Object.keys(style).length > 0) {
        node.style = style;
    }

    if (type === 'text') {
        const text = attr($, el, 'data-text') ?? $(el).text().trim();
        if (text) {
            node.text = text;
        }
    } else if (type === 'button') {
        const label = attr($, el, 'data-label') ?? $(el).text().trim();
        if (label) {
            node.label = label;
        }
    } else if (type === 'image') {
        const src = attr($, el, 'src') ?? attr($, el, 'data-src');
        if (src) {
            node.src = src;
        }
    } else if (type === 'bar' || type === 'toggle') {
        const value = attr($, el, 'data-value') ?? attr($, el, 'value');
        if (value !== undefined) {
            node.value = coerceScalar(value);
        }
    }

    if (attrBool($, el, 'data-hidden')) {
        node.hidden = true;
    }
    if (attrBool($, el, 'data-disabled')) {
        node.disabled = true;
    }

    if (!options.skipEvents) {
        const on = compileEvents($, el);
        if (on) {
            node.on = on;
        }
    }

    if (CONTAINER_TYPES.has(type)) {
        const children: UiNode[] = [];
        $(el)
            .children()
            .each((_index, child) => {
                const compiled = compileNode($, child, depth + 1, pageId, issues);
                if (compiled) {
                    children.push(compiled);
                }
            });
        if (children.length > 0) {
            node.children = children;
        }
    }

    return node;
}

/* ------------------------------------------------------------- page compile */

function compilePage($: CheerioAPI, el: HtmlElement, issues: UiBundleIssue[]): UiPage | null {
    const id = attr($, el, 'data-page')?.trim();
    if (!id) {
        issues.push({ path: 'pages', message: 'a [data-page] element is missing its id' });
        return null;
    }

    const targetsRaw = attr($, el, 'data-targets');
    const targets = targetsRaw
        ? targetsRaw
              .split(/[,\s]+/)
              .map((token) => token.trim())
              .filter((token): token is 'main' | 'aux' => token === 'main' || token === 'aux')
        : ['main' as const, 'aux' as const];

    const root = compileNode($, el, 1, id, issues, {
        forceType: 'screen',
        skipEvents: true,
    });
    if (root === null) {
        issues.push({ path: `${id}.root`, message: 'page has no renderable root widget' });
        return null;
    }

    const page: UiPage = {
        id,
        targets: targets.length > 0 ? targets : ['main', 'aux'],
        root,
    };

    const title = attr($, el, 'data-title');
    if (title) {
        page.title = title;
    }

    const on = compileEvents($, el);
    if (on) {
        page.on = on;
    }

    return page;
}

/* ------------------------------------------------------------- meta readers */

/** `<meta name="ui-theme" content='{"bg":"#101418",...}'>` */
function readThemeMeta($: CheerioAPI): Partial<UiTheme> | undefined {
    const raw = $('meta[name="ui-theme"]').attr('content');
    if (!raw) {
        return undefined;
    }
    try {
        return JSON.parse(raw) as Partial<UiTheme>;
    } catch {
        throw new UiCompileError('ui-theme meta is not valid JSON');
    }
}

/** Repeated `<meta name="ui-var" data-path="..." data-kind="..." data-type="..." data-ttl="...">` */
function readVarsMeta($: CheerioAPI): Record<string, UiVar> {
    const vars: Record<string, UiVar> = {};
    $('meta[name="ui-var"]').each((_index, el) => {
        const path = $(el).attr('data-path') ?? $(el).attr('content');
        if (!path) {
            return;
        }
        const kind = ($(el).attr('data-kind') ?? 'local') === 'remote' ? 'remote' : 'local';
        const type = $(el).attr('data-type');
        const ttl = Number($(el).attr('data-ttl'));
        const declared: UiVar = { kind };
        if (type === 'int' || type === 'float' || type === 'bool' || type === 'string') {
            declared.type = type;
        }
        if (Number.isFinite(ttl) && ttl > 0) {
            declared.ttl = ttl;
        }
        vars[path] = declared;
    });
    return vars;
}

/** `<meta name="ui-defaults" content='{"main":"home","aux":"status"}'>` */
function readDefaultsMeta($: CheerioAPI): { main?: string; aux?: string } | undefined {
    const raw = $('meta[name="ui-defaults"]').attr('content');
    if (!raw) {
        return undefined;
    }
    try {
        return JSON.parse(raw) as { main?: string; aux?: string };
    } catch {
        throw new UiCompileError('ui-defaults meta is not valid JSON');
    }
}

/* ------------------------------------------------------- variable discovery */

/** Every action reachable from an event map. */
function actionsOf(on: UiEventMap | undefined): UiAction[] {
    if (!on) {
        return [];
    }
    const list: UiAction[] = [];
    const push = (actions?: UiAction[]) => {
        if (actions) {
            list.push(...actions);
        }
    };
    push(on.tap);
    push(on.longPress);
    push(on.enter);
    push(on.leave);
    if (on.interval) {
        push(on.interval.actions);
    }
    if (on.var) {
        push(on.var.actions);
    }
    if (on.gesture) {
        for (const actions of Object.values(on.gesture)) {
            push(actions);
        }
    }
    return list;
}

function collectActionRefs(action: UiAction, out: Set<string>): void {
    switch (action.do) {
        case 'setVar':
        case 'toggleVar':
            out.add(action.path);
            break;
        case 'if':
            out.add(action.cond.path);
            for (const nested of action.then) {
                collectActionRefs(nested, out);
            }
            for (const nested of action.else ?? []) {
                collectActionRefs(nested, out);
            }
            break;
        default:
            break;
    }
}

function collectVarRefs(node: UiNode, out: Set<string>): void {
    if (node.text) {
        for (const path of collectTemplatePaths(node.text)) {
            out.add(path);
        }
    }
    if (node.label) {
        for (const path of collectTemplatePaths(node.label)) {
            out.add(path);
        }
    }
    if (typeof node.value === 'string') {
        for (const path of collectTemplatePaths(node.value)) {
            out.add(path);
        }
    }
    if (node.on?.var?.path) {
        out.add(node.on.var.path);
    }
    for (const action of actionsOf(node.on)) {
        collectActionRefs(action, out);
    }
    for (const child of node.children ?? []) {
        collectVarRefs(child, out);
    }
}

/* ------------------------------------------------------------- public API */

/**
 * Compile markup into a sealed, validated bundle.
 *
 * @throws UiCompileError when the markup cannot be parsed or the result fails
 *         validation. Use `compileHtmlResult()` to inspect the issues instead.
 */
export function compileHtml(html: string, options: CompileHtmlOptions = {}): UiBundle {
    const result = compileHtmlResult(html, options);
    if (!result.ok || !result.bundle) {
        const detail = result.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n');
        throw new UiCompileError(`bundle failed validation:\n${detail}`, result.issues);
    }
    return result.bundle;
}

/**
 * Compile markup into a bundle without throwing.
 *
 * `ok` is false when the markup has no pages or the sealed bundle fails
 * validation; `bundle` is still returned when validation only reported issues so
 * the caller can inspect or log it.
 */
export function compileHtmlResult(
    html: string,
    options: CompileHtmlOptions = {}
): CompileHtmlResult {
    const issues: UiBundleIssue[] = [];
    const $ = load(html);

    /* Pages are the outermost [data-page] elements; nested ones belong to a page. */
    const pageElements = $('[data-page]')
        .toArray()
        .filter((el) => $(el).parents('[data-page]').length === 0);

    const pages: UiPage[] = [];
    for (const el of pageElements) {
        const page = compilePage($, el, issues);
        if (page) {
            pages.push(page);
        }
    }

    if (pages.length === 0) {
        issues.push({
            path: 'pages',
            message: 'no <section data-page="..."> elements found',
        });
        return { ok: false, issues };
    }

    /* Theme: meta first, then the caller's override, then the built-in default. */
    const theme: UiTheme = {
        ...UI_HTML_DEFAULT_THEME,
        ...(readThemeMeta($) ?? {}),
        ...(options.theme ?? {}),
    };

    /* Declared variables, then auto-declare everything the markup references. */
    const vars: Record<string, UiVar> = { ...readVarsMeta($), ...(options.vars ?? {}) };

    const referenced = new Set<string>();
    for (const page of pages) {
        collectVarRefs(page.root, referenced);
        for (const action of actionsOf(page.on)) {
            collectActionRefs(action, referenced);
        }
        if (page.on?.var?.path) {
            referenced.add(page.on.var.path);
        }
    }

    for (const path of referenced) {
        if (vars[path]) {
            continue;
        }
        vars[path] = path.startsWith('external.')
            ? { kind: 'remote', ttl: options.externalTtl ?? UI_HTML_DEFAULT_EXTERNAL_TTL }
            : { kind: 'local' };
    }

    /* Defaults: explicit, then meta, then "first page for both panels". */
    let defaults = options.defaults ?? readDefaultsMeta($);
    if (!defaults) {
        const first = pages[0]?.id;
        const aux = pages.find((page) => page.targets.includes('aux'))?.id ?? first;
        defaults = { main: first, aux };
    }

    const bundle = sealBundle({
        schema: UI_BUNDLE_SCHEMA,
        rev: options.rev ?? 1,
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        defaults,
        theme,
        vars,
        pages,
    });

    const validation = validateBundle(bundle);
    return {
        ok: validation.ok,
        bundle: validation.bundle ?? bundle,
        issues: validation.issues,
    };
}
