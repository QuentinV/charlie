import { readFileSync } from 'fs';
import { join } from 'path';
import {
    UI_BUNDLE_SCHEMA,
    UI_LIMITS,
    bundleJsonSchema,
    sealBundle,
    stableStringify,
    validateBundle,
} from './schema';

const DIR = join(__dirname);
const FIXTURE = join(DIR, '__fixtures__', 'bundle.example.json');
const COMMITTED_SCHEMA = join(DIR, 'ui-bundle.schema.json');

const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

describe('ui bundle contract', () => {
    it('validates the example bundle', () => {
        const result = validateBundle(fixture());
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.bundle?.schema).toBe(UI_BUNDLE_SCHEMA);
    });

    it('serves every page the device needs for both panels', () => {
        const { bundle } = validateBundle(fixture());
        const targets = new Set(
            (bundle?.pages ?? []).flatMap((page: any) => page.targets)
        );
        expect(targets.has('main')).toBe(true);
        expect(targets.has('aux')).toBe(true);
    });

    it('keeps the committed json schema in sync with the zod source', () => {
        const generated = JSON.stringify(bundleJsonSchema(), null, 2) + '\n';
        const committed = readFileSync(COMMITTED_SCHEMA, 'utf8');
        expect(generated).toBe(committed);
    });

    it('rejects a bundle whose hash does not match its content', () => {
        const bundle = fixture();
        bundle.theme.bg = '#FFFFFF';
        const { ok, issues } = validateBundle(bundle);
        expect(ok).toBe(false);
        expect(issues.some((issue) => issue.path === 'hash')).toBe(true);
    });

    it('rejects a template bound to an undeclared variable', () => {
        const bundle = fixture();
        bundle.pages[0].root.children[0].text = '{{core.time.seconds}}';
        const { ok, issues } = validateBundle(sealBundle(bundle));
        expect(ok).toBe(false);
        expect(issues.some((issue) => issue.path.includes('clock'))).toBe(true);
    });

    it('rejects a navigate action that targets an unknown page', () => {
        const bundle = fixture();
        bundle.pages[0].root.children[2].children[1].on.tap[0].page = 'nope';
        const { ok, issues } = validateBundle(sealBundle(bundle));
        expect(ok).toBe(false);
        expect(issues.some((issue) => issue.path.includes('recipes'))).toBe(
            true
        );
    });

    it('rejects a remote variable without a usable ttl', () => {
        const bundle = fixture();
        bundle.vars['external.devices.Chambre.state'].ttl = 10;
        const { ok, issues } = validateBundle(sealBundle(bundle));
        expect(ok).toBe(false);
        expect(issues.some((issue) => issue.path.includes('ttl'))).toBe(true);
    });

    it('rejects an unknown widget type', () => {
        const bundle = fixture();
        bundle.pages[0].root.children[0].type = 'marquee';
        const { ok } = validateBundle(sealBundle(bundle));
        expect(ok).toBe(false);
    });

    it('rejects a bundle over the device size limit', () => {
        const bundle = fixture();
        // Schema-valid on its own (each label stays under 2048 chars) but the
        // page as a whole is well over the 192 KB the device accepts.
        const filler = Array.from({ length: 120 }, (_, index) => ({
            type: 'text',
            id: `filler:${index}`,
            text: 'x'.repeat(2000),
        }));
        bundle.pages[0].root.children.push(...filler);
        const { ok, issues } = validateBundle(sealBundle(bundle));
        expect(ok).toBe(false);
        expect(issues.some((issue) => issue.path === 'bundle')).toBe(true);
    });

    it('rejects a page nested deeper than the device limit', () => {
        const bundle = fixture();
        let node: any = { type: 'col' };
        const root = node;
        for (let i = 0; i < UI_LIMITS.depth; i++) {
            node.children = [{ type: 'col' }];
            node = node.children[0];
        }
        bundle.pages[0].root = root;
        const { ok } = validateBundle(sealBundle(bundle));
        expect(ok).toBe(false);
    });

    it('keeps the hash stable across key orderings', () => {
        const bundle = fixture();
        const reordered = {
            ...bundle,
            theme: Object.fromEntries(
                Object.entries(bundle.theme).reverse()
            ),
        };
        expect(stableStringify(reordered)).toBe(stableStringify(bundle));
        expect(sealBundle(reordered).hash).toBe(bundle.hash);
    });
});
