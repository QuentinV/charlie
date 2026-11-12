/**
 * Live probe of the vision pipeline against the running router.
 *
 *   npx tsx src/vision/probe.ts <image> [--type recipe] [--raw]
 *
 * This is how a prompt or a schema change is re-validated (the shopping
 * restructurer has the same tool): the tests replay *captured* answers from
 * `__tests__/fixtures/`, this one produces new ones from the real model and
 * prints the timings. `--type` skips the classifier (one call), `--raw` prints
 * only the JSON answers, ready to paste into a fixture.
 *
 * It talks to the router directly and touches no database, so it runs against a
 * bare `docker compose up llm`.
 */
import fs from 'fs';
import path from 'path';
import { visionJson, visionModel } from '../ai/llm';
import {
    answerType,
    buildDetectPrompt,
    buildExtractPrompt,
    classifierSchema,
    parseJsonAnswer,
} from './logic';
import {
    classifierModules,
    fallbackModule,
    getVisionModule,
} from './modules';
import { VisionModule } from './modules/types';

const MIME: { [ext: string]: string } = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

function imageDataUrl(file: string): string {
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
    if (!file || !fs.existsSync(file)) {
        console.error('usage: npx tsx src/vision/probe.ts <image> [--type <id>] [--raw]');
        process.exit(1);
    }

    const image = imageDataUrl(file);
    const modules = classifierModules();
    const wanted = option('type');
    const rawOnly = flag('raw');
    console.log(
        `[probe] ${file} (${Math.round(fs.statSync(file).size / 1024)} kB) → model ${visionModel()}`
    );

    const forced = wanted ? getVisionModule(wanted) : undefined;
    let module: VisionModule<any> = forced ?? fallbackModule();

    if (!forced) {
        const started = Date.now();
        const answer = await visionJson(image, {
            prompt: buildDetectPrompt(modules),
            schema: classifierSchema(modules.map((m) => m.id)),
            schemaName: 'document_type',
            maxTokens: 16,
        });
        module =
            getVisionModule(
                answerType(parseJsonAnswer(answer), modules.map((m) => m.id))
            ) ?? fallbackModule();
        console.log(
            `[probe] classify ${Date.now() - started} ms → ${module.id} (raw: ${answer})`
        );
        if (rawOnly) console.log(answer);
    }

    const started = Date.now();
    const answer = await visionJson(image, {
        prompt: buildExtractPrompt(module),
        schema: module.schema,
        schemaName: module.id,
        ...(module.maxTokens ? { maxTokens: module.maxTokens } : {}),
    });
    const parsed = parseJsonAnswer(answer);
    const data = parsed === undefined ? null : module.parse(parsed);

    console.log(
        `[probe] extract ${module.id} ${Date.now() - started} ms → ${
            data ? 'parsed' : 'UNUSABLE ANSWER'
        }`
    );
    if (rawOnly) {
        console.log(answer);
    } else {
        console.log(`[probe] summary: ${data ? module.summarize?.(data) : '—'}`);
        console.log(JSON.stringify(data ?? parsed, null, 2));
    }
}

void main().catch((e) => {
    console.error('[probe] failed:', e?.message ?? e);
    process.exit(1);
});
