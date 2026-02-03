import { Device, PowerType, Room, Tools } from '../../../types';
import { cs } from '../../../core/db';
import Fuse from 'fuse.js';
import { changeDeviceState } from '../../../devices';
import { normalizeAndSplit } from './../../../ai/nlu/utils';

interface DeviceRequest {
    freeText: string;
    slots?: {
        deviceType?: string;
        room?: string;
    };
}

async function getRoom(q: string): Promise<Room | undefined> {
    if ((q || null) === null) {
        return;
    }

    console.log('looking for room', q);
    const rooms = await cs.rooms.find({}).toArray();
    if (!rooms?.length) {
        return null;
    }

    const fuse = new Fuse(rooms, {
        keys: ['name'],
        threshold: 0.3,
    });

    return (fuse.search(q)[0]?.item as Room) ?? null;
}

async function findDevice(req: DeviceRequest): Promise<Device | undefined> {
    const room = await getRoom(req.slots?.room);
    if (!req.freeText && room === null) {
        console.log('no room found for ', room);
        return null;
    }

    const filter: any = {};
    if (room) {
        console.log(JSON.stringify(room));
        if (!room?.devices?.length) {
            console.log('the room', room, 'has no devices');
            return null;
        }
        filter['_id'] = { $in: room.devices };
    }

    if (req.slots?.deviceType) {
        filter.type = req.slots.deviceType;
        console.log('filter by device type', req.slots.deviceType);
    }

    let devices = await cs.devices.find(filter).toArray();
    if (devices?.length) {
        if (room && req.slots?.deviceType) {
            console.log(
                'room found and devicetype provided so pick first device'
            );
            return devices?.[0] ?? null;
        }
    }

    if (!req.freeText) {
        return null;
    }

    const normalizedText = normalizeAndSplit(req.freeText).join(' ');
    console.log(
        'looking for device with type',
        req.slots?.deviceType,
        ' and normalized free text ',
        normalizedText
    );

    // Run fuse on all devices by type if available to search by free text and hope to match possible name of device
    delete filter['_id'];
    devices = await cs.devices.find(filter).toArray();

    let fuse = new Fuse(devices, {
        keys: ['name'],
        threshold: 0.3,
    });

    const res = fuse.search(normalizedText)[0]?.item as Device;
    console.log('found', res);
    if (!res && req.slots?.room) {
        return fuse.search(req.slots.room)[0]?.item as Device;
    }

    return res;
}

async function changeDevice(
    req: DeviceRequest,
    power: PowerType
): Promise<boolean | string> {
    const device = await findDevice(req);
    if (device) {
        return !!changeDeviceState(device._id, {
            power,
        });
    }
    return "Je ne trouves pas l'appareil demandé.";
}

export const tools: Tools = {
    turnOnDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'on'),
    },
    turnOffDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'off'),
    },
    pauseDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'pause'),
    },
};

export default tools;
