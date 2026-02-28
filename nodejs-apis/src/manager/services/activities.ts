import { cs } from '../../core/db';
import { v7 as uuid } from 'uuid';
import { Activity } from '../../types';

export async function log(from: string, message: string, activity?: Activity) {
    console.log(
        `[${from}] ${message}`,
        activity?.context ? JSON.stringify(activity.context) : '',
        activity?.data ? JSON.stringify(activity.data) : ''
    );
    const a = {
        ...(activity ?? {}),
        message,
        from,
        _id: uuid(),
        type: 'log',
        modified: new Date(),
    };
    await cs.activities.insertOne(a);
}

export async function recordActivity(activity: Activity) {
    activity._id = uuid();
    await cs.activities.insertOne(activity);
}
