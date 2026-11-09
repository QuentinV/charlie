/**
 * Live probe for a prompt change (not a test): calls the running small model
 * with the exported compose prompt + schema and prints the raw JSON per
 * sentence. Run with `npx tsx src/automations/probe.ts` while the LLM router is
 * up (LLM_HOST, default llm:9308).
 */
import { writeFileSync } from 'node:fs';
import { req, shoppingModel, shoppingHost } from '../ai/llm';
import { COMPOSE_PROMPT, AUTOMATION_SCHEMA } from './compose';

const DEVICES = [
    '- Lumière du salon (light) · états: power, level',
    '- Volet salon (shutter) · états: power, level',
    '- Salon clim (clim) · états: power, level',
    '- Météo (sensor) · états: power, level, day_night',
].join('\n');

const SENTENCES = [
    "quand la lumière du salon s'allume, préviens-moi",
    'ouvre le volet du salon à 9h tous les jours',
    'quand le soleil se lève, ouvre les volets',
    'à 7h30, allume la cuisine',
    "préviens-moi quand la lumière du salon s'allume et qu'il fait nuit",
];

(async () => {
    const out: string[] = [];
    for (const sentence of SENTENCES) {
        out.push(`\nSENTENCE: ${sentence}`);
        try {
            const res = await req(
                {
                    messages: [
                        { role: 'system', content: COMPOSE_PROMPT },
                        {
                            role: 'user',
                            content: `Appareils disponibles :\n${DEVICES}\n\nDemande :\n${sentence}`,
                        },
                    ],
                    tools: [],
                    model: shoppingModel(),
                    temperature: 0,
                    max_tokens: 512,
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: 'automation_draft',
                            schema: AUTOMATION_SCHEMA,
                        },
                    },
                },
                shoppingHost()
            );
            out.push(res.choices?.[0]?.message?.content ?? '(no content)');
        } catch (e: any) {
            out.push(`PROBE ERROR: ${e?.message ?? e}`);
        }
    }
    // Written to a file so the capture is deterministic (UTF-8, no shell pipes).
    writeFileSync('probe.out', out.join('\n'), 'utf8');
    console.log('probe written to probe.out');
    process.exit(0);
})();
