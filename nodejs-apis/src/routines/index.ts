import { cs } from '../core/db';
import cron from 'node-cron';
import { Routine, TriggerKind } from '../types';
import { log } from '../manager/services/activities';
import { ask } from '../ai/flow';
import { sendPushNotifcation } from '../core/notifications';
import { formatDateTime } from '../core/formatDate';

const cache: { [key: string]: any[] } = {};

interface ExecRoutineResult {
    lastRun: Date;
}

export async function stopRoutine(rid: string) {
    log('ROUTINES', `Stop routine ${rid}`);
    cache[rid]?.forEach((c: any) => c?.stop?.());
}

export async function execRoutine(r: Routine): Promise<ExecRoutineResult> {
    const lastRun = new Date();
    sendPushNotifcation({
        title: 'Routines',
        body: `${r.name} has started at ${formatDateTime(lastRun)}`,
    });
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
    sendPushNotifcation({
        title: 'Routines',
        body: `${r.name} has ended ${formatDateTime(new Date())}`,
    });
    return { lastRun };
}

export async function toggleStatusRoutine(r: Routine): Promise<boolean> {
    if (!r._id) return false;

    const active = !r.active;

    await cs.routines.updateOne(
        { _id: r._id },
        {
            $set: { active },
        }
    );

    if (active) {
        startRoutine(r);
    } else {
        stopRoutine(r._id);
    }

    return active;
}

export function restartRoutine(r: Routine) {
    if (!r?.active || !r._id) return;
    stopRoutine(r._id);
    startRoutine(r);
}

export function startRoutine(r: Routine) {
    if (!r?._id || !r?.actions?.length) return;
    cache[r._id!] = [];
    r.triggers
        .filter((t) => t.type === TriggerKind.CRON)
        .map((trigger) => {
            log(
                'ROUTINES',
                `Starting cron ${trigger.obj.expression} for ${r.name}`
            );
            cache[r._id!].push(
                cron.schedule(
                    trigger.obj.expression,
                    async () => execRoutine(r),
                    {
                        noOverlap: true,
                        timezone: 'Europe/Paris',
                    }
                )
            );
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
