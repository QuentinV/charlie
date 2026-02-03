import { Device, PowerType, Room, Tools } from '../../../types';
import { cs } from '../../../core/db';
import Fuse from 'fuse.js';
import { changeDeviceState } from '../../../devices';

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

    const devices = await cs.devices.find(filter).toArray();
    if (devices?.length) {
        console.log('no device name provided so pick first one');
        return devices?.[0] ?? null;
    }

    if (!req.freeText) {
        return null;
    }

    const fuse = new Fuse(devices, {
        keys: ['name'],
        threshold: 0.3,
    });

    console.log('found', fuse.search(req.freeText)[0]?.item);
    return fuse.search(req.freeText)[0]?.item as Device;
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
