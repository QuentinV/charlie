import {
    Device,
    DeviceState,
    DeviceTypes,
    PowerType,
    Room,
    Tools,
} from '../../../types';
import { cs } from '../../../core/db';
import Fuse from 'fuse.js';
import { changeDeviceState, getDeviceState } from '../../../devices';
import { normalizeAndSplit } from './../../../ai/nlu/utils';
import { log } from '../../../manager/services/activities';

interface DeviceRequest {
    freeText: string;
    slots?: {
        number?: string;
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

function clampLevel(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

/** Devices targeted by a level (brightness/volume) request. */
async function findLevelTargets(
    req: DeviceRequest,
    defaultType: string
): Promise<Device[] | string> {
    const effective: DeviceRequest = {
        ...req,
        slots: {
            ...req.slots,
            deviceType: req.slots?.deviceType ?? defaultType,
        },
    };

    const found = await findDevices(effective);
    const devices = found?.length ? found : await findByType(effective);
    if (!devices?.length) {
        return "Je ne trouves pas l'appareil demandé.";
    }

    if (req.slots?.plurial) {
        return devices;
    }
    if (
        devices.length > 1 &&
        !req.slots?.room &&
        !req.slots?.predefinedRoom
    ) {
        return `Plusieurs appareils correspondent. Précise la pièce, par exemple: ${devices
            .slice(0, 3)
            .map((d) => d.name)
            .join(', ')}.`;
    }
    return [devices[0]];
}

/** Fallback when free text does not name a device: whole type (scoped to room). */
async function findByType(req: DeviceRequest): Promise<Device[]> {
    const filter: any = { type: req.slots?.deviceType };
    if (req.slots?.room) {
        const room = await getRoom(req.slots.room);
        if (room?.devices?.length) {
            filter['_id'] = { $in: room.devices };
        }
    }
    return cs.devices.find(filter).toArray();
}

async function applyLevel(
    req: DeviceRequest,
    defaultType: string,
    resolveLevel: (current: number | undefined) => number | undefined
): Promise<boolean | string> {
    const targets = await findLevelTargets(req, defaultType);
    if (typeof targets === 'string') {
        return targets;
    }

    for (const device of targets) {
        if (!device._id) continue;
        const state = await getDeviceState(device._id);
        const level = resolveLevel(state?.level);
        if (level === undefined) return false;
        const changed = await changeDeviceState(device._id, { level });
        if (!changed) {
            return `Impossible de modifier le niveau de ${device.name}.`;
        }
    }
    return true;
}

function describeDeviceState(device: Device, state?: DeviceState): string {
    if (!state?.power) {
        return `${device.name}: je ne connais pas son état.`;
    }
    const power =
        state.power === 'on'
            ? 'allumé'
            : state.power === 'pause'
              ? 'en pause'
              : 'éteint';
    let description = `${device.name} est ${power}`;
    if (state.level != null) {
        description += ` à ${state.level}%`;
    }
    return `${description}.`;
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
    deviceStateQuery: {
        exec: async (req: DeviceRequest) => {
            if (!req.slots || !Object.keys(req.slots).length) {
                // Nothing device related was recognized
                // (e.g. "est ce que tu peux ...").
                return false;
            }
            const devices = await findDevices(req);
            if (!devices?.length) {
                return "Je ne trouves pas l'appareil demandé.";
            }
            const descriptions: string[] = [];
            for (const device of devices) {
                const state = device._id
                    ? await getDeviceState(device._id)
                    : undefined;
                descriptions.push(describeDeviceState(device, state));
            }
            return descriptions.join(' ');
        },
    },
    setBrightness: {
        exec: async (req: DeviceRequest) => {
            const value = Number(req.slots?.number);
            if (!req.slots?.number || Number.isNaN(value)) return false;
            return applyLevel(req, 'light', () => clampLevel(value));
        },
    },
    brightnessUp: {
        exec: async (req: DeviceRequest) =>
            applyLevel(req, 'light', (current) =>
                clampLevel((current ?? 50) + 10)
            ),
    },
    brightnessDown: {
        exec: async (req: DeviceRequest) =>
            applyLevel(req, 'light', (current) =>
                clampLevel((current ?? 50) - 10)
            ),
    },
    setVolume: {
        exec: async (req: DeviceRequest) => {
            const value = Number(req.slots?.number);
            if (!req.slots?.number || Number.isNaN(value)) return false;
            return applyLevel(req, 'tv', () => clampLevel(value));
        },
    },
    volumeUp: {
        exec: async (req: DeviceRequest) =>
            applyLevel(req, 'tv', (current) =>
                clampLevel((current ?? 50) + 10)
            ),
    },
    volumeDown: {
        exec: async (req: DeviceRequest) =>
            applyLevel(req, 'tv', (current) =>
                clampLevel((current ?? 50) - 10)
            ),
    },
};

export default tools;
