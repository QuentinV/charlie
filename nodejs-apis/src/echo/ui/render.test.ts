import {
    UI_HTML_DEFAULT_THEME,
    UiCompileError,
    compileHtml,
    compileHtmlResult,
    parseActionSpec,
} from './render';
import { computeBundleHash } from './schema';

/* A deliberately small document: one page, one screen, a text and a button. */
const SIMPLE = `
<section data-page="home" data-title="Home">
  <h1>Bonsoir</h1>
  <button data-on-tap="navigate:recipes">Recettes</button>
</section>
<section data-page="recipes" data-targets="main">
  <p>Pas encore de recettes.</p>
</section>
`;

describe('html bundle compiler', () => {
    it('compiles a page per <section data-page>', () => {
        const bundle = compileHtml(SIMPLE, { generatedAt: '2026-01-01T00:00:00.000Z' });
        expect(bundle.schema).toBe(1);
        expect(bundle.pages.map((page) => page.id)).toEqual(['home', 'recipes']);
        expect(bundle.pages[0].title).toBe('Home');
    });

    it('maps semantic elements onto widget types', () => {
        const bundle = compileHtml(SIMPLE);
        const home = bundle.pages[0];
        expect(home.root.type).toBe('screen');
        expect(home.root.children?.[0].type).toBe('text');
        expect(home.root.children?.[0].text).toBe('Bonsoir');
        expect(home.root.children?.[0].style?.size).toBe(56);
        expect(home.root.children?.[1].type).toBe('button');
        expect(home.root.children?.[1].label).toBe('Recettes');
    });

    it('defaults a page to both panels unless data-targets says otherwise', () => {
        const bundle = compileHtml(SIMPLE);
        expect(bundle.pages[0].targets).toEqual(['main', 'aux']);
        expect(bundle.pages[1].targets).toEqual(['main']);
        expect(bundle.defaults?.main).toBe('home');
        expect(bundle.defaults?.aux).toBe('home');
    });

    it('seals the bundle so its hash matches its content', () => {
        const bundle = compileHtml(SIMPLE);
        expect(bundle.hash).toBe(computeBundleHash(bundle));
    });

    it('declares template variables automatically, local and remote', () => {
        const bundle = compileHtml(`
            <section data-page="home">
                <p>{{core.sensors.temperature}} C</p>
                <p>{{external.devices.Chambre.state}}</p>
            </section>
        `);
        expect(bundle.vars['core.sensors.temperature']).toEqual({ kind: 'local' });
        expect(bundle.vars['external.devices.Chambre.state']).toMatchObject({
            kind: 'remote',
            ttl: 5000,
        });
    });

    it('keeps a declared variable instead of replacing it', () => {
        const bundle = compileHtml(`
            <meta name="ui-var" data-path="external.devices.Chambre.state" data-kind="remote" data-ttl="1500">
            <section data-page="home"><p>{{external.devices.Chambre.state}}</p></section>
        `);
        expect(bundle.vars['external.devices.Chambre.state']).toEqual({
            kind: 'remote',
            ttl: 1500,
        });
    });

    it('reads the theme and defaults from <meta> tags', () => {
        const bundle = compileHtml(`
            <meta name="ui-theme" content='{"bg":"#101418","surface":"#1A212A","text":"#F3F5F8","muted":"#93A0B0","accent":"#E6A94D","radius":8}'>
            <meta name="ui-defaults" content='{"main":"home","aux":"home"}'>
            <section data-page="home"><p>Salut</p></section>
        `);
        expect(bundle.theme.bg).toBe('#101418');
        expect(bundle.theme.radius).toBe(8);
        expect(bundle.defaults).toEqual({ main: 'home', aux: 'home' });
    });

    it('falls back to the built-in theme when the markup declares none', () => {
        const bundle = compileHtml(SIMPLE);
        expect(bundle.theme).toEqual(UI_HTML_DEFAULT_THEME);
    });

    it('rejects markup without any page', () => {
        const result = compileHtmlResult('<div>nothing here</div>');
        expect(result.ok).toBe(false);
        expect(result.issues[0].message).toContain('data-page');
    });

    it('throws UiCompileError when the bundle cannot be validated', () => {
        expect(() => compileHtml('<div>nothing here</div>')).toThrow(UiCompileError);
    });

    it('rejects a navigate action that targets an unknown page', () => {
        const result = compileHtmlResult(`
            <section data-page="home">
                <button data-on-tap="navigate:nowhere">Go</button>
            </section>
        `);
        expect(result.ok).toBe(false);
        expect(result.issues.some((issue) => issue.message.includes('unknown page'))).toBe(true);
    });

    it('rejects a duplicate widget id', () => {
        const result = compileHtmlResult(`
            <section data-page="home">
                <div class="col">
                    <p id="dup">a</p>
                    <p id="dup">b</p>
                </div>
            </section>
        `);
        expect(result.ok).toBe(false);
        expect(result.issues.some((issue) => issue.message.includes('duplicate widget id'))).toBe(true);
    });
});

describe('action shorthand', () => {
    it('parses navigate, back and reload', () => {
        expect(parseActionSpec('navigate:recipes')).toEqual([
            { do: 'navigate', page: 'recipes' },
        ]);
        expect(parseActionSpec('back')).toEqual([{ do: 'back' }]);
        expect(parseActionSpec('reload')).toEqual([{ do: 'reload' }]);
    });

    it('parses setVar, toggle and visibility verbs', () => {
        expect(parseActionSpec('setVar:core.lights.on=true')).toEqual([
            { do: 'setVar', path: 'core.lights.on', value: true },
        ]);
        expect(parseActionSpec('toggleVar:core.lights.on')).toEqual([
            { do: 'toggleVar', path: 'core.lights.on' },
        ]);
        expect(parseActionSpec('show:panel')).toEqual([{ do: 'show', id: 'panel' }]);
        expect(parseActionSpec('hide:panel')).toEqual([{ do: 'hide', id: 'panel' }]);
    });

    it('splits several shorthand actions on ";"', () => {
        expect(parseActionSpec('navigate:home;reload')).toEqual([
            { do: 'navigate', page: 'home' },
            { do: 'reload' },
        ]);
    });

    it('parses a call action with JSON params', () => {
        expect(parseActionSpec('call:devices.toggle?{"name":"Chambre"}')).toEqual([
            { do: 'call', action: 'devices.toggle', params: { name: 'Chambre' } },
        ]);
    });

    it('parses a JSON array of actions', () => {
        expect(
            parseActionSpec('[{"do":"navigate","page":"home"},{"do":"reload"}]')
        ).toEqual([{ do: 'navigate', page: 'home' }, { do: 'reload' }]);
    });

    it('rejects an unknown verb', () => {
        expect(() => parseActionSpec('explode')).toThrow(UiCompileError);
    });
});
