import { cs } from '../core/db';
import { initAll } from '../init';
import cron from 'node-cron';
import { Routine, TriggerKind } from '../types';
import { log } from '../manager/services/activities';
import { ask } from '../ai/flow';

(async () => {
    await initAll();

    const routines = await cs.routines
        .find({ 'triggers.type': TriggerKind.CRON, active: true })
        .toArray();

    routines.forEach((r: Routine) => {
        if (!r?.actions?.length) return;
        r.triggers
            .filter((t) => t.type === TriggerKind.CRON)
            .map((trigger) => {
                log(
                    'ROUTINES',
                    `Starting cron ${trigger.obj.expression} for ${r.name}`
                );
                cron.schedule(
                    trigger.obj.expression,
                    async () => {
                        try {
                            for (let i = 0; i < r.actions.length; ++i) {
                                const action = r.actions[i];
                                await ask(action, { log: false });
                            }
                        } catch (error) {
                            log('ROUTINES', 'Task failed');
                            console.error('Task failed:', error);
                        }
                    },
                    { noOverlap: true }
                );
            });
    });
})();

// '*/5 * * * *'
// Structure: (minute) (hour) (day of month) (month) (day of week)
