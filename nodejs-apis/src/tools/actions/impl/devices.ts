import { Device, DeviceTypes, PowerType, Room, Tools } from '../../../types';
import { cs } from '../../../core/db';
import Fuse from 'fuse.js';
import { changeDeviceState } from '../../../devices';
import { normalizeAndSplit } from './../../../ai/nlu/utils';
import { log } from '../../../manager/services/activities';

interface DeviceRequest {
    freeText: string;
    slots?: {
        deviceType?: string;
        room?: string;
        plurial?: 'plurial';
        predefinedRoom?: string;
    };
}

async function getRoom(q: string): Promise<Room | undefined> {
    if ((q || null) === null) {
        return;
    }

    log('devices-actions', `looking for room = ${q}`);
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

async function findDevices(req: DeviceRequest): Promise<Device[] | undefined> {
    DeviceTypes;
    if (req.slots?.predefinedRoom === 'house') {
        log('devices-actions', 'house requested, use all shutters devices');
        return cs.devices
            .find({ type: { $in: [DeviceTypes.shutter] } })
            .toArray();
    }

    const room = await getRoom(req.slots?.room);
    if (!req.freeText && room === null) {
        log('devices-actions', `no room found for ${req.slots?.room}`);
        return null;
    }

    const filter: any = {};
    if (room) {
        if (!room?.devices?.length) {
            log('devices-actions', `Room ${room.name} has no devices`);
            return null;
        }
        filter['_id'] = { $in: room.devices };
    }

    if (req.slots?.deviceType && req.slots?.deviceType !== 'house') {
        filter.type = req.slots.deviceType;
        log(
            'devices-actions',
            `filter by device type = ${req.slots.deviceType}`
        );
    }

    let devices = await cs.devices.find(filter).toArray();
    if (devices?.length) {
        if (req.slots?.deviceType === 'tv') {
            return [devices[0]];
        }

        if (req.slots?.plurial || req.slots?.deviceType === 'house') {
            log('devices-actions', 'pick all devices because plurial');
            return devices;
        }
        if (room && req.slots?.deviceType) {
            log(
                'devices-actions',
                'room found and devicetype provided so pick first device'
            );
            return devices?.[0] ? [devices?.[0]] : null;
        }
    }

    if (!req.freeText) {
        return null;
    }

    const normalizedText = normalizeAndSplit(req.freeText).join(' ');
    log(
        'devices-actions',
        `looking for device with type = ${req.slots?.deviceType} and normalized free text = ${normalizedText}`
    );

    // Run fuse on all devices by type if available to search by free text and hope to match possible name of device
    delete filter['_id'];
    devices = await cs.devices.find(filter).toArray();

    let fuse = new Fuse(devices, {
        keys: ['name'],
        threshold: 0.3,
    });

    const res = fuse.search(normalizedText)[0]?.item as Device;
    log('devices-actions', 'found', { data: { device: res } });
    if (!res && req.slots?.room) {
        const d = fuse.search(req.slots.room)[0]?.item as Device;
        return d ? [d] : null;
    }

    return res ? [res] : null;
}

async function changeDevice(
    req: DeviceRequest,
    power: PowerType
): Promise<boolean | string> {
    const devices = await findDevices(req);
    if (devices) {
        let ok = true;
        for (let i = 0; i < devices.length; ++i) {
            ok =
                ok &&
                !!(await changeDeviceState(devices[i]._id!, {
                    power,
                }));
        }
        return ok;
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
