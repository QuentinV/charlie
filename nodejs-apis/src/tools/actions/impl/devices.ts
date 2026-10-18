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
import { changeDeviceState, getDeviceCapabilities, getDeviceState } from '../../../devices';
import { normalizeAndSplit } from './../../../ai/nlu/utils';
import { log } from '../../../manager/services/activities';
import * as memory from '../../../ai/memory';

interface DeviceRequest {
    freeText: string;
    slots?: {
        number?: string;
        deviceType?: string;
        room?: string;
        plurial?: 'plurial';
        predefinedRoom?: string;
        deviceId?: string;
    };
    user?: string;
    sessionId?: string;
}

type VerbIntentType = 'onoff' | 'open' | 'close' | 'all';

const deviceTypesFallbackVerbIntent = {
    'all': [DeviceTypes.light, DeviceTypes.shutter, DeviceTypes.tv],
    'onoff': [DeviceTypes.light],
    'open': [DeviceTypes.shutter],
    'close': [DeviceTypes.shutter, DeviceTypes.tv]
}

/** Memory scope derived from the NLU request. */
function scopeOf(req: DeviceRequest): { user?: string; sessionId?: string } {
    return { user: req?.user, sessionId: req?.sessionId };
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

async function findDevices(req: DeviceRequest, verbIntent: VerbIntentType): Promise<Device[] | undefined> {
    if (req.slots?.deviceId) {
        const d = await cs.devices.findOne({ _id: req.slots.deviceId });
        if (d) {
            return [d];
        }
    }

    if (req.slots?.predefinedRoom === 'house') {
        const types = req.slots?.deviceType ? [req.slots.deviceType] : deviceTypesFallbackVerbIntent[verbIntent];
        log('devices-actions', `house requested, use all ${types.join(', ')} devices`);
        return cs.devices
            .find({ type: { $in: types } })
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
            `filter by device type = ${req.slots.deviceType})`
        );
    }

    let devices = await cs.devices.find(filter).toArray();
    if (devices?.length) {
        if (room && !req.slots?.deviceType) {
            const devs = devices.filter( d => deviceTypesFallbackVerbIntent[verbIntent].includes(d.type) );
            if (devs?.length) {
                log('devices-actions', `room found without device type so look for ${deviceTypesFallbackVerbIntent[verbIntent].join(', ')}`);
                return devs;
            }
        }

        if (req.slots?.deviceType === DeviceTypes.tv) {
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
    power: PowerType,
    verbIntent: VerbIntentType
): Promise<boolean | string> {
    const devices = await findDevices(req, verbIntent);
    if (devices?.length) {
        // Turning a device on may carry a remembered level (preference).
        const state: DeviceState = { power };
        if (power === 'on' && req.slots?.number != null) {
            const level = Number(req.slots.number);
            if (!Number.isNaN(level)) state.level = clampLevel(level);
        }

        let ok = true;
        for (const device of devices) {
            if (!device._id) continue;
            ok = ok && !!(await changeDeviceState(device._id, state));
        }
        if (ok) {
            memory.setActiveDevice(
                scopeOf(req),
                devices[0]._id,
                devices[0].name
            );
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

    const found = await findDevices(effective, 'onoff');
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
    const type = req.slots?.deviceType;
    if (!type) return [];
    const filter: any = { type };
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
    memory.setActiveDevice(scopeOf(req), targets[0]._id, targets[0].name);
    return true;
}

/**
 * Canonical capability property carrying the target temperature — the skin of
 * every climate device (`providers/homeassistant/domains.ts`), so this works
 * for any climate device without per-provider code.
 */
const TEMPERATURE_KEY = 'temperature';

/**
 * Apply a temperature to the devices matched by the request, clamped to the
 * range the device advertises through its capabilities.
 */
async function applyTemperature(
    req: DeviceRequest,
    resolve: (current: number | undefined) => number | undefined
): Promise<boolean | string> {
    const targets = await findLevelTargets(req, DeviceTypes.thermostat);
    if (typeof targets === 'string') return targets;

    for (const device of targets) {
        if (!device._id) continue;

        const capabilities = await getDeviceCapabilities(device._id);
        const field = capabilities?.state?.find(
            (f) => f.key === TEMPERATURE_KEY
        );
        if (!field) {
            return `${device.name} n'a pas de réglage de température.`;
        }

        const current = Number(device.state?.properties?.[TEMPERATURE_KEY]);
        const wanted = resolve(
            Number.isFinite(current) ? current : undefined
        );
        if (wanted === undefined) return false;

        const min = field.min ?? 16;
        const max = field.max ?? 30;
        const value = Math.min(max, Math.max(min, wanted));

        const changed = await changeDeviceState(device._id, {
            properties: { [TEMPERATURE_KEY]: value },
        });
        if (!changed) {
            return `Impossible de régler la température de ${device.name}.`;
        }
    }

    memory.setActiveDevice(scopeOf(req), targets[0]._id, targets[0].name);
    return true;
}

function describeDeviceState(device: Device, state?: DeviceState): string {
    // A measurement's value IS its state: report the reading with the gateway's
    // own unit instead of speaking about power (a sensor is never "on").
    if (device.type === DeviceTypes.sensor && state?.level != null) {
        const unit = state.properties?.unit_of_measurement;
        return `${device.name} : ${state.level}${unit ? ` ${unit}` : ''}.`;
    }
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
        // `level` is the device's canonical numeric value: a percentage for most
        // domains, the ambient temperature for a thermostat (see the provider's
        // `LEVEL_SOURCES`).
        description +=
            device.type === DeviceTypes.thermostat
                ? ` (${state.level} °C)`
                : ` à ${state.level}%`;
    }
    return `${description}.`;
}

export const tools: Tools = {
    turnOnDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'on', 'onoff'),
    },
    turnOffDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'off', 'onoff'),
    },    
    pauseDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'pause', 'all'),
    },
    openDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'on', 'open'),
    },
    closeDevice: {
        exec: async (req: DeviceRequest) => changeDevice(req, 'off', 'close'),
    },
    deviceStateQuery: {
        exec: async (req: DeviceRequest) => {
            if (!req.slots || !Object.keys(req.slots).length) {
                // Nothing device related was recognized
                // (e.g. "est ce que tu peux ...").
                return false;
            }
            const devices = await findDevices(req, 'all');
            if (!devices?.length) {
                return "Je ne trouves pas l'appareil demandé.";
            }
            memory.setActiveDevice(
                scopeOf(req),
                devices[0]._id,
                devices[0].name
            );
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
    setTemperature: {
        exec: async (req: DeviceRequest) => {
            const value = Number(req.slots?.number);
            if (!req.slots?.number || Number.isNaN(value)) return false;
            return applyTemperature(req, () => value);
        },
    },
    temperatureUp: {
        exec: (req: DeviceRequest) =>
            applyTemperature(req, (current) => (current ?? 20) + 1),
    },
    temperatureDown: {
        exec: (req: DeviceRequest) =>
            applyTemperature(req, (current) => (current ?? 20) - 1),
    },
};

export default tools;
