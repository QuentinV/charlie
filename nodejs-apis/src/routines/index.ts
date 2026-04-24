import { cs } from '../core/db';
import cron from 'node-cron';
import { Routine, TriggerKind } from '../types';
import { log } from '../manager/services/activities';
import { ask } from '../ai/flow';

const cache = {};

interface ExecRoutineResult {
    lastRun: Date;
}

export async function execRoutine(r: Routine): Promise<ExecRoutineResult> {
    const lastRun = new Date();
    for (let i = 0; i < r.actions.length; ++i) {
        try {
            const action = r.actions[i];
            await ask(action, { log: true });
        } catch (error) {
            log('ROUTINES', 'Action failed');
        }
    }
    await cs.routines.updateOne(
        { _id: r._id },
        {
            $set: {
                lastRun,
            },
        }
    );
    return { lastRun };
}

export function startRoutine(r: Routine) {
    if (!r?.actions?.length) return;
    r.triggers
        .filter((t) => t.type === TriggerKind.CRON)
        .map((trigger) => {
            log(
                'ROUTINES',
                `Starting cron ${trigger.obj.expression} for ${r.name}`
            );
            cron.schedule(trigger.obj.expression, async () => execRoutine(r), {
                noOverlap: true,
            });
        });
}

export async function setupRoutines() {
    const routines = await cs.routines
        .find({ 'triggers.type': TriggerKind.CRON, active: true })
        .toArray();

    routines.forEach((r: Routine) => startRoutine(r));
}

// '*/5 * * * *'
// Structure: (minute) (hour) (day of month) (month) (day of week)
