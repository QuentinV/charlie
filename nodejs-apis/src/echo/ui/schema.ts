import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * Contract for the Echo screen bundles — `ui.bundle/1`.
 *
 * A bundle is the whole UI of one Echo device: the pages for the 10.1" DSI
 * panel and the 3.5" SPI panel, the theme, and the variable declarations the
 * device resolves on its own. Charlie compiles it (from HTML or JSON), stores
 * it keyed by MAC, and serves it over HTTP; the device pulls it, renders it
 * with LVGL and executes the actions locally. See `docs/P1_SCREEN_DOCS.md` in
 * the firmware repo for the wire format and the device-side limits.
 *
 * This file is the single source of truth for the format. The firmware mirrors
 * the enums and limits in `components/echo_screen/include/echo_screen_schema.h`
 * and consumes the generated JSON Schema committed as `ui-bundle.schema.json`.
 */

export const UI_BUNDLE_SCHEMA = 1;

/** Hard limits shared with the device. Keep in sync with echo_screen_schema.h. */
export const UI_LIMITS = {
    /** Bundle size the device accepts (A/B cached in its 6 MB SPIFFS partition). */
    bundleBytes: 192 * 1024,
    pages: 32,
    /** Widget nesting depth, `root` = 1. */
    depth: 8,
    /** Widgets per page, `root` included. */
    nodesPerPage: 256,
    vars: 64,
    /** Nested `if` actions. */
    actionDepth: 4,
    /** `{{path}}` segments in one template string. */
    templateSegments: 16,
} as const;

/* --------------------------------------------------------------- primitives */

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const THEME_TOKEN = /^theme\.[A-Za-z0-9_]+$/;
const VAR_PATH = /^(core|external)(\.[A-Za-z0-9_-]+)+$/;
const PAGE_ID = /^[a-z0-9_-]{1,32}$/;
const NODE_ID = /^[A-Za-z0-9_.:-]{1,48}$/;
const SIZE = /^(\d{1,3}%|content)$/;
const TEMPLATE = /\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g;

/** `#RRGGBB` or `#RRGGBBAA`. */
export const uiHexColor = z
    .string()
    .regex(HEX_COLOR, 'expected #RRGGBB or #RRGGBBAA');

/** A literal colour or a `theme.*` token. */
export const uiPaint = z.union([
    uiHexColor,
    z.string().regex(THEME_TOKEN, 'expected a theme.* token'),
]);

/** `core.*` (device-local) or `external.*` (resolved by Charlie). */
export const uiVarPath = z
    .string()
    .regex(VAR_PATH, 'expected core.* or external.*');

export const uiPageId = z.string().regex(PAGE_ID, 'expected [a-z0-9_-]{1,32}');

export const uiNodeId = z
    .string()
    .regex(NODE_ID, 'expected [A-Za-z0-9_.:-]{1,48}');

/** Pixels, `NN%` or `content`. */
export const uiSize = z.union([
    z.number().int().min(0).max(4096),
    z.string().regex(SIZE, 'expected pixels, NN% or content'),
]);

/** Font sizes bundled with the firmware (echo_font_*). */
export const uiFontSize = z.union([
    z.literal(12),
    z.literal(16),
    z.literal(20),
    z.literal(28),
    z.literal(40),
    z.literal(56),
]);

export const uiScalar = z.union([z.string(), z.number(), z.boolean()]);

/* -------------------------------------------------------------------- style */

/**
 * Widget style. Unknown keys are kept (and ignored by the device) so the
 * contract can grow without breaking older firmware — only unknown *widget
 * types* are rejected.
 */
export const uiStyle = z
    .object({
        flex: z.enum(['row', 'column']).optional(),
        gap: z.number().int().min(0).max(200).optional(),
        pad: z.number().int().min(0).max(200).optional(),
        padX: z.number().int().min(0).max(200).optional(),
        padY: z.number().int().min(0).max(200).optional(),
        grow: z.union([z.literal(0), z.literal(1)]).optional(),
        w: uiSize.optional(),
        h: uiSize.optional(),
        bg: uiPaint.optional(),
        color: uiPaint.optional(),
        radius: z
            .union([z.number().int().min(0).max(200), z.string()])
            .optional(),
        size: uiFontSize.optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
        valign: z.enum(['top', 'middle', 'bottom']).optional(),
        border: z
            .object({
                w: z.number().int().min(0).max(20),
                color: uiPaint,
            })
            .optional(),
        opacity: z.number().int().min(0).max(255).optional(),
        scrollDir: z.enum(['v', 'h', 'none']).optional(),
        precision: z.number().int().min(0).max(4).optional(),
    })
    .passthrough();

export type UiStyle = z.infer<typeof uiStyle>;

/* --------------------------------------------------------- actions & events */

export interface UiCondition {
    path: string;
    op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'exists';
    value?: string | number | boolean;
}

export type UiAction =
    | { do: 'navigate'; page: string }
    | { do: 'back' }
    | { do: 'setVar'; path: string; value: string | number | boolean }
    | { do: 'toggleVar'; path: string }
    | { do: 'show'; id: string }
    | { do: 'hide'; id: string }
    | { do: 'enable'; id: string }
    | { do: 'disable'; id: string }
    | { do: 'wait'; ms: number }
    | { do: 'if'; cond: UiCondition; then: UiAction[]; else?: UiAction[] }
    | { do: 'call'; action: string; params?: Record<string, unknown> }
    | { do: 'reload' };

/* The three recursive schemas below are declared as `ZodType<T>` through a cast:
 * zod's inferred object types carry optional/undefined nuances that do not
 * satisfy the interface exactly, and the casts keep the documented types while
 * the runtime schema stays the plain object. */
export const uiCondition = z.object({
    path: uiVarPath,
    op: z.enum(['==', '!=', '>', '<', '>=', '<=', 'contains', 'exists']),
    value: uiScalar.optional(),
}) as unknown as z.ZodType<UiCondition>;

export const uiAction = z.lazy(() =>
    z.discriminatedUnion('do', [
        z.object({ do: z.literal('navigate'), page: uiPageId }),
        z.object({ do: z.literal('back') }),
        z.object({ do: z.literal('setVar'), path: uiVarPath, value: uiScalar }),
        z.object({ do: z.literal('toggleVar'), path: uiVarPath }),
        z.object({ do: z.literal('show'), id: uiNodeId }),
        z.object({ do: z.literal('hide'), id: uiNodeId }),
        z.object({ do: z.literal('enable'), id: uiNodeId }),
        z.object({ do: z.literal('disable'), id: uiNodeId }),
        z.object({
            do: z.literal('wait'),
            ms: z.number().int().min(0).max(60000),
        }),
        z.object({
            do: z.literal('if'),
            cond: uiCondition,
            then: z.array(uiAction),
            else: z.array(uiAction).optional(),
        }),
        z.object({
            do: z.literal('call'),
            action: z.string().min(1).max(64),
            params: z.record(z.string(), z.unknown()).optional(),
        }),
        z.object({ do: z.literal('reload') }),
    ])
) as unknown as z.ZodType<UiAction>;

export const uiGestureName = z.enum([
    'swipeLeft',
    'swipeRight',
    'swipeUp',
    'swipeDown',
    'forward',
    'backward',
]);

export const uiEventMap = z
    .object({
        tap: z.array(uiAction).optional(),
        longPress: z.array(uiAction).optional(),
        enter: z.array(uiAction).optional(),
        leave: z.array(uiAction).optional(),
        interval: z
            .object({
                ms: z.number().int().min(100).max(600000),
                actions: z.array(uiAction),
            })
            .optional(),
        var: z
            .object({
                path: uiVarPath,
                when: uiCondition.optional(),
                actions: z.array(uiAction),
            })
            .optional(),
        gesture: z.record(uiGestureName, z.array(uiAction)).optional(),
    })
    .passthrough();

export type UiEventMap = z.infer<typeof uiEventMap>;

/* ------------------------------------------------------------------ widgets */

export const uiNodeType = z.enum([
    'screen',
    'row',
    'col',
    'scroll',
    'text',
    'button',
    'image',
    'divider',
    'bar',
    'toggle',
    'list',
]);

export type UiNodeType = z.infer<typeof uiNodeType>;

export interface UiNode {
    type: UiNodeType;
    id?: string;
    style?: UiStyle;
    text?: string;
    label?: string;
    value?: string | number | boolean;
    src?: string;
    hidden?: boolean;
    disabled?: boolean;
    on?: UiEventMap;
    children?: UiNode[];
}

export const uiNode = z.lazy(() =>
    z
        .object({
            type: uiNodeType,
            id: uiNodeId.optional(),
            style: uiStyle.optional(),
            text: z.string().max(2048).optional(),
            label: z.string().max(512).optional(),
            value: uiScalar.optional(),
            src: z.string().max(512).optional(),
            hidden: z.boolean().optional(),
            disabled: z.boolean().optional(),
            on: uiEventMap.optional(),
            children: z.array(uiNode).max(UI_LIMITS.nodesPerPage).optional(),
        })
        .passthrough()
) as unknown as z.ZodType<UiNode>;

/* --------------------------------------------------------------------- vars */

export const uiVar = z
    .object({
        kind: z.enum(['local', 'remote']),
        ttl: z.number().int().min(0).max(600000).optional(),
        type: z.enum(['string', 'int', 'float', 'bool']).optional(),
    })
    .superRefine((value, ctx) => {
        if (value.kind === 'remote' && (value.ttl ?? 0) < 500) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'remote variables need a ttl >= 500 ms',
                path: ['ttl'],
            });
        }
    });

export type UiVar = z.infer<typeof uiVar>;

/* -------------------------------------------------------------------- pages */

export const uiPage = z
    .object({
        id: uiPageId,
        targets: z.array(z.enum(['main', 'aux'])).min(1).max(2),
        title: z.string().max(64).optional(),
        on: uiEventMap.optional(),
        root: uiNode,
    })
    .passthrough();

export type UiPage = z.infer<typeof uiPage>;

export const uiTheme = z
    .object({
        bg: uiPaint,
        surface: uiPaint,
        text: uiPaint,
        muted: uiPaint,
        accent: uiPaint,
        radius: z
            .union([z.number().int().min(0).max(200), z.string()])
            .optional(),
    })
    .passthrough();

export type UiTheme = z.infer<typeof uiTheme>;

/* ------------------------------------------------------------------- bundle */

export const uiBundle = z
    .object({
        schema: z.literal(UI_BUNDLE_SCHEMA),
        rev: z.number().int().min(1),
        hash: z.string().regex(/^[0-9a-f]{64}$/, 'expected a sha256 hex digest'),
        generatedAt: z.string().datetime().optional(),
        defaults: z
            .object({ main: uiPageId.optional(), aux: uiPageId.optional() })
            .optional(),
        theme: uiTheme,
        vars: z.record(uiVarPath, uiVar),
        pages: z.array(uiPage).min(1).max(UI_LIMITS.pages),
    })
    .passthrough();

export type UiBundle = z.infer<typeof uiBundle>;

/* -------------------------------------------------------------- validation */

/** One human-readable problem found while validating a bundle. */
export interface UiBundleIssue {
    path: string;
    message: string;
}

export interface UiBundleValidation {
    ok: boolean;
    bundle?: UiBundle;
    issues: UiBundleIssue[];
}

/** Deterministic JSON: object keys sorted, so the hash never depends on order. */
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort();
    return `{${entries
        .map(
            (key) =>
                `${JSON.stringify(key)}:${stableStringify(
                    (value as Record<string, unknown>)[key]
                )}`
        )
        .join(',')}}`;
}

/** sha256 of the bundle without its `hash` field. */
export function computeBundleHash(bundle: Omit<UiBundle, 'hash'> & { hash?: string }): string {
    const { hash: _ignored, ...rest } = bundle as UiBundle;
    return createHash('sha256').update(stableStringify(rest)).digest('hex');
}

/** Returns a copy of the bundle with `hash` set from its content. */
export function sealBundle(bundle: Omit<UiBundle, 'hash'> & { hash?: string }): UiBundle {
    const withoutHash = { ...bundle } as UiBundle;
    delete (withoutHash as Partial<UiBundle>).hash;
    return { ...withoutHash, hash: computeBundleHash(withoutHash) } as UiBundle;
}

/** Every `{{path}}` referenced by a template string. */
export function collectTemplatePaths(template: string): string[] {
    const found: string[] = [];
    TEMPLATE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TEMPLATE.exec(template)) !== null) {
        found.push(match[1]);
    }
    return found;
}

interface NodeVisit {
    node: UiNode;
    depth: number;
    parent?: UiNode;
}

function walkNodes(root: UiNode, visit: (v: NodeVisit) => void): void {
    const stack: NodeVisit[] = [{ node: root, depth: 1 }];
    while (stack.length > 0) {
        const current = stack.pop() as NodeVisit;
        visit(current);
        const children = current.node.children ?? [];
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({
                node: children[i],
                depth: current.depth + 1,
                parent: current.node,
            });
        }
    }
}

function eachAction(actions: UiAction[] | undefined, visit: (a: UiAction) => void): void {
    for (const action of actions ?? []) {
        visit(action);
        if (action.do === 'if') {
            eachAction(action.then, visit);
            eachAction(action.else, visit);
        }
    }
}

function eachEventAction(event: UiEventMap | undefined, visit: (a: UiAction) => void): void {
    if (!event) return;
    eachAction(event.tap, visit);
    eachAction(event.longPress, visit);
    eachAction(event.enter, visit);
    eachAction(event.leave, visit);
    eachAction(event.interval?.actions, visit);
    eachAction(event.var?.actions, visit);
    for (const actions of Object.values(event.gesture ?? {})) {
        eachAction(actions, visit);
    }
}

function actionDepth(actions: UiAction[] | undefined): number {
    let deepest = 0;
    for (const action of actions ?? []) {
        if (action.do === 'if') {
            deepest = Math.max(
                deepest,
                1 + actionDepth(action.then),
                1 + actionDepth(action.else)
            );
        } else {
            deepest = Math.max(deepest, 1);
        }
    }
    return deepest;
}

/** Style keys whose value is a colour or a `theme.*` token. */
const PAINT_KEYS = ['bg', 'color'] as const;

/**
 * Validate a bundle against the schema **and** the cross-references the device
 * relies on (theme tokens, page ids, widget ids, declared variables, limits).
 *
 * The device applies the same checks in `echo_screen_bundle.cpp`; publishing a
 * bundle that fails here would only be rejected on the panel, so callers should
 * refuse to store one.
 */
export function validateBundle(input: unknown): UiBundleValidation {
    const parsed = uiBundle.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        };
    }

    const bundle = parsed.data;
    const issues: UiBundleIssue[] = [];
    const add = (path: string, message: string) => issues.push({ path, message });

    const themeTokens = new Set(Object.keys(bundle.theme));
    const varPaths = new Set(Object.keys(bundle.vars));
    const pageIds = new Set<string>();

    for (const page of bundle.pages) {
        if (pageIds.has(page.id)) {
            add(`pages.${page.id}`, 'duplicate page id');
        }
        pageIds.add(page.id);
    }

    for (const [target, pageId] of Object.entries(bundle.defaults ?? {})) {
        if (pageId && !pageIds.has(pageId)) {
            add(`defaults.${target}`, `unknown page "${pageId}"`);
        }
    }

    const checkPaint = (path: string, value: unknown) => {
        if (typeof value !== 'string' || !value.startsWith('theme.')) return;
        const token = value.slice('theme.'.length);
        if (!themeTokens.has(token)) {
            add(path, `unknown theme token "${value}"`);
        }
    };

    const checkVar = (path: string, value: string | undefined) => {
        if (!value) return;
        for (const ref of collectTemplatePaths(value)) {
            if (!varPaths.has(ref)) {
                add(path, `variable "${ref}" is not declared in vars`);
            }
        }
    };

    for (const page of bundle.pages) {
        const pagePath = `pages.${page.id}`;
        const ids = new Set<string>();
        let count = 0;
        let deepest = 0;

        walkNodes(page.root, ({ node, depth }) => {
            count += 1;
            deepest = Math.max(deepest, depth);

            if (node.id) {
                if (ids.has(node.id)) {
                    add(`${pagePath}.${node.id}`, 'duplicate widget id');
                }
                ids.add(node.id);
            }

            const style = node.style ?? {};
            for (const key of PAINT_KEYS) {
                checkPaint(`${pagePath}.${node.id ?? node.type}.${key}`, style[key]);
            }
            if (style.border) {
                checkPaint(
                    `${pagePath}.${node.id ?? node.type}.border`,
                    style.border.color
                );
            }
            checkVar(`${pagePath}.${node.id ?? node.type}.text`, node.text);
            checkVar(`${pagePath}.${node.id ?? node.type}.label`, node.label);
            if (typeof node.value === 'string') {
                checkVar(`${pagePath}.${node.id ?? node.type}.value`, node.value);
            }

            eachEventAction(node.on, (action) => {
                const where = `${pagePath}.${node.id ?? node.type}.on`;
                if (action.do === 'navigate' && !pageIds.has(action.page)) {
                    add(where, `navigate to unknown page "${action.page}"`);
                }
                if (action.do === 'setVar' && !varPaths.has(action.path)) {
                    add(where, `setVar on undeclared variable "${action.path}"`);
                }
                if (action.do === 'if' && !varPaths.has(action.cond.path)) {
                    add(where, `condition on undeclared variable "${action.cond.path}"`);
                }
            });
        });

        eachEventAction(page.on, (action) => {
            if (action.do === 'navigate' && !pageIds.has(action.page)) {
                add(`${pagePath}.on`, `navigate to unknown page "${action.page}"`);
            }
        });

        if (count > UI_LIMITS.nodesPerPage) {
            add(pagePath, `${count} widgets, limit is ${UI_LIMITS.nodesPerPage}`);
        }
        if (deepest > UI_LIMITS.depth) {
            add(pagePath, `nesting depth ${deepest}, limit is ${UI_LIMITS.depth}`);
        }

        const deepestAction = Math.max(
            actionDepth(page.on?.tap),
            actionDepth(page.on?.interval?.actions)
        );
        if (deepestAction > UI_LIMITS.actionDepth) {
            add(
                pagePath,
                `action nesting ${deepestAction}, limit is ${UI_LIMITS.actionDepth}`
            );
        }
    }

    if (Object.keys(bundle.vars).length > UI_LIMITS.vars) {
        add('vars', `more than ${UI_LIMITS.vars} variables`);
    }

    const bytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
    if (bytes > UI_LIMITS.bundleBytes) {
        add('bundle', `${bytes} bytes, limit is ${UI_LIMITS.bundleBytes}`);
    }

    if (bundle.hash !== computeBundleHash(bundle)) {
        add('hash', 'does not match the bundle content');
    }

    return issues.length === 0
        ? { ok: true, bundle, issues }
        : { ok: false, bundle, issues };
}

/** Paths the device must pull from Charlie (`kind: "remote"`), in stable order. */
export function remoteVarPaths(bundle: UiBundle): string[] {
    return Object.keys(bundle.vars)
        .filter((path) => bundle.vars[path].kind === 'remote')
        .sort();
}

/** Paths the device resolves locally (`kind: "local"`), in stable order. */
export function localVarPaths(bundle: UiBundle): string[] {
    return Object.keys(bundle.vars)
        .filter((path) => bundle.vars[path].kind === 'local')
        .sort();
}

/* ------------------------------------------------------------ json schema */

/**
 * JSON Schema of the bundle, generated from the zod schema above.
 *
 * Committed as `ui-bundle.schema.json` next to this file and copied into the
 * firmware repo (`docs/ui-bundle.schema.json`) so both sides can diff it. The
 * `schema.test.ts` guard fails when the committed copy drifts.
 */
export function bundleJsonSchema(): Record<string, unknown> {
    // Imported lazily: the generator is only needed by the publish path and the
    // drift test, not by the device-facing validation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zodToJsonSchema } = require('zod-to-json-schema');
    return zodToJsonSchema(uiBundle, {
        name: 'UiBundle',
        $refStrategy: 'root',
    }) as Record<string, unknown>;
}
