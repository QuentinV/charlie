import { logEcho } from '../logs';

/**
 * Server-side actions the device can invoke with a `call` action.
 *
 * Everything else in a bundle runs on the device (navigation, visibility,
 * variable writes) because the round trip to Charlie would be too slow for a
 * touch. Only the actions that need the brain end up here, as an explicit
 * `{"do":"call","action":"devices.toggle","params":{...}}` in the bundle, which
 * the device posts to `POST /echo/:id/ui/actions`.
 *
 * The registry is plain name -> handler so a provider can register its own
 * actions at boot without the device knowing anything about them.
 */

export interface UiActionContext {
    /** Canonical MAC of the device that fired the action. */
    mac: string;
    /** Live ip when the device is connected. */
    ip?: string;
    /** Revision of the bundle the device had on screen. */
    rev?: number;
}

export interface UiActionResult {
    ok: boolean;
    result?: unknown;
    error?: string;
}

export type UiActionHandler = (
    params: any,
    ctx: UiActionContext
) => Promise<unknown> | unknown;

const handlers = new Map<string, UiActionHandler>();

/** Register (or replace) an action handler. */
export function registerUiAction(name: string, handler: UiActionHandler): void {
    handlers.set(name, handler);
}

/** Names currently registered, for diagnostics and tests. */
export function listUiActions(): string[] {
    return Array.from(handlers.keys()).sort();
}

/** Run one action. Unknown names fail cleanly so the device can keep going. */
export async function runUiAction(
    name: string,
    params: any,
    ctx: UiActionContext
): Promise<UiActionResult> {
    const handler = handlers.get(name);
    if (!handler) {
        return { ok: false, error: `unknown action "${name}"` };
    }
    try {
        const result = await handler(params ?? {}, ctx);
        return { ok: true, result };
    } catch (e: any) {
        logEcho(ctx.ip ?? '', `[ui] action ${name} failed: ${e?.message ?? e}`);
        return { ok: false, error: String(e?.message ?? e) };
    }
}

/* ------------------------------------------------------------- defaults */

/**
 * Lifecycle hooks a bundle may call on `enter` / `leave`. They only log today;
 * they exist so a bundle can announce page changes without the device having to
 * push anything over the WebSocket.
 */
registerUiAction('ui.enter', (params, ctx) => {
    logEcho(ctx.ip ?? '', `[ui] ${ctx.mac} entered ${params?.page ?? '?'}`);
    return { page: params?.page ?? null };
});

registerUiAction('ui.leave', (params, ctx) => {
    logEcho(ctx.ip ?? '', `[ui] ${ctx.mac} left ${params?.page ?? '?'}`);
    return { page: params?.page ?? null };
});
