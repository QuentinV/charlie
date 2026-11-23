import { cs } from '../../core/db';
import {
    clearUiBundle,
    getUiBundle,
    getUiRevision,
    publishUiBundle,
    rollbackUiBundle,
} from './store';

jest.mock('../../core/db', () => ({
    cs: {
        echoUi: {
            findOne: jest.fn(),
            updateOne: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
}));
jest.mock('../logs', () => ({ logEcho: jest.fn() }));

const findOne = cs.echoUi.findOne as unknown as jest.Mock;
const updateOne = cs.echoUi.updateOne as unknown as jest.Mock;
const deleteOne = cs.echoUi.deleteOne as unknown as jest.Mock;

const MAC = 'aa:bb:cc:dd:ee:ff';

/** In-memory stand-in for the `echo_ui` collection. */
let docs: Record<string, any>;

function validBundle() {
    return {
        schema: 1,
        rev: 1,
        hash: '0'.repeat(64),
        theme: {
            bg: '#0E1216',
            surface: '#1A212A',
            text: '#F3F5F8',
            muted: '#93A0B0',
            accent: '#E6A94D',
        },
        vars: {},
        pages: [
            {
                id: 'home',
                targets: ['main'],
                root: {
                    type: 'screen',
                    children: [{ type: 'text', text: 'Bonjour' }],
                },
            },
        ],
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    docs = {};
    findOne.mockImplementation(async (filter: any) => docs[filter.mac] ?? null);
    updateOne.mockImplementation(async (filter: any, update: any) => {
        docs[filter.mac] = { ...(docs[filter.mac] ?? {}), ...update.$set };
        return { acknowledged: true };
    });
    deleteOne.mockImplementation(async (filter: any) => {
        delete docs[filter.mac];
        return { acknowledged: true };
    });
});

describe('ui bundle store', () => {
    it('publishes a valid bundle as revision 1 with a real hash', async () => {
        const result = await publishUiBundle(MAC, validBundle());
        expect(result.ok).toBe(true);
        expect(result.rev).toBe(1);
        expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(docs[MAC].bundle.hash).toBe(result.hash);
    });

    it('rejects a bundle that fails validation', async () => {
        const broken = validBundle();
        broken.pages[0].root = { type: 'nope' } as any;
        const result = await publishUiBundle(MAC, broken);
        expect(result.ok).toBe(false);
        expect(result.issues?.length).toBeGreaterThan(0);
        expect(docs[MAC]).toBeUndefined();
    });

    it('keeps the revision when the content did not change', async () => {
        const first = await publishUiBundle(MAC, validBundle());
        const second = await publishUiBundle(MAC, validBundle());
        expect(second.rev).toBe(first.rev);
        expect(second.hash).toBe(first.hash);
    });

    it('bumps the revision and keeps the previous one on change', async () => {
        const first = await publishUiBundle(MAC, validBundle());
        const changed = validBundle();
        changed.pages[0].root.children[0].text = 'Bonsoir';
        const second = await publishUiBundle(MAC, changed);

        expect(second.rev).toBe(2);
        expect(second.hash).not.toBe(first.hash);
        expect(docs[MAC].previous.rev).toBe(1);
        expect(docs[MAC].previous.hash).toBe(first.hash);
    });

    it('reports the current revision, and null when nothing was published', async () => {
        expect(await getUiRevision(MAC)).toBeNull();
        const published = await publishUiBundle(MAC, validBundle());
        const revision = await getUiRevision(MAC);
        expect(revision?.rev).toBe(published.rev);
        expect(revision?.hash).toBe(published.hash);
    });

    it('rolls back to the previous revision as a new revision', async () => {
        const first = await publishUiBundle(MAC, validBundle());
        const changed = validBundle();
        changed.pages[0].root.children[0].text = 'Bonsoir';
        const second = await publishUiBundle(MAC, changed);

        const rolled = await rollbackUiBundle(MAC);
        expect(rolled?.rev).toBe(3);
        expect(rolled?.hash).toBe(first.hash);
        expect(second.hash).not.toBe(first.hash);
    });

    it('returns null when there is nothing to roll back to', async () => {
        await publishUiBundle(MAC, validBundle());
        expect(await rollbackUiBundle(MAC)).toBeNull();
    });

    it('returns the stored document and clears it', async () => {
        await publishUiBundle(MAC, validBundle());
        const document = await getUiBundle(MAC);
        expect(document?.mac).toBe(MAC);
        expect(document?.bundle.schema).toBe(1);

        await clearUiBundle(MAC);
        expect(await getUiBundle(MAC)).toBeNull();
    });
});
