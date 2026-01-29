import { Device, PowerType, Room, Tools } from '../../../types';
import { t } from '../langs';
import { cs } from '../../../core/db';
import Fuse from 'fuse.js';
import { changeDeviceState } from '../../../devices';

interface DeviceRequest {
    device?: string;
    room?: string;
    device_name?: string;
}

interface DeviceValueRequest extends DeviceRequest {
    value: string;
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

async function findDevice({
    device: deviceType,
    room: roomSearch,
    device_name,
}: DeviceRequest): Promise<Device | undefined> {
    const room = await getRoom(roomSearch);
    if (room === null) {
        console.log('no room found for ', roomSearch);
        return null;
    }

    const filter: any = {};
    if (room) {
        console.log(JSON.stringify(room));
        if (!room?.devices?.length) {
            console.log('the room', roomSearch, 'has no devices');
            return null;
        }
        filter['_id'] = { $in: room.devices };
    }

    if (deviceType) {
        filter.type = deviceType;
        console.log('filter by device type', deviceType);
    }

    const devices = await cs.devices.find(filter).toArray();
    if (!devices?.length) {
        console.log('no device found');
        return null;
    }

    if (!device_name) {
        console.log('no device name provided so pick first one');
        return devices[0];
    }

    const fuse = new Fuse(devices, {
        keys: ['name'],
        threshold: 0.3,
    });

    return fuse.search(device_name)[0]?.item as Device;
}

async function changeDevice(
    req: DeviceRequest,
    power: PowerType
): Promise<boolean> {
    const device = await findDevice(req);
    const res = await changeDeviceState(device._id, {
        power,
    });
    return !!res;
}

export const tools: Tools = {
    turn_on_device: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'on'),
    },
    turn_off_device: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'off'),
    },
    //set_device_value: {
    //    exec: async () => '',
    //},
    //increase_device_value: {
    //    exec: async () => '',
    //},
    //decrease_device_value: {
    //    exec: async () => '',
    //},
    //query_device_state: {
    //    exec: async () => '',
    //},
    open_device: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'on'),
    },
    close_device: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'off'),
    },
    pause_device: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'pause'),
    },
    turn_on_group: {
        exec: async () => '',
    },
    turn_off_group: {
        exec: async () => '',
    },
};

export default tools;
