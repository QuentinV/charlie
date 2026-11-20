/**
 * Where a reported vision event lands: the automations bus (so any VISION
 * trigger fires), the activity log and the panel's live timeline. This is the
 * one entry point the REST route calls — the feed never talks to Mongo.
 */
import { emitVisionEvent } from '../automations/events';
import { log } from '../manager/services/activities';
import { VisionEvent } from '../types';
import { appendEvent } from './eventLog';
import { onVisionEvent } from './kitchen';

export async function recordEvent(event: VisionEvent): Promise<void> {
    await log(
        'vision-feed',
        `[${event.kind}] ${event.classes.join(', ') || '-'}`,
        {
            context: {
                cameraId: event.cameraId,
                modes: event.modes,
                kind: event.kind,
                classes: event.classes,
            },
        }
    );

    emitVisionEvent(event);

    // The panel's live timeline: in memory, newest first (the activity log above
    // is the durable record — it survives a restart, this does not).
    appendEvent(event);

    // The fridge/pantry flow is optional and slow (a VLM call): it never blocks
    // the event path, and it handles its own failures.
    void onVisionEvent(event);
}
