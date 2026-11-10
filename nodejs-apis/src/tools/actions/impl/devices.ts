import {
    Device,
    DeviceCapabilities,
    DeviceState,
    DeviceTypes,
    PowerType,
    Room,
    StatePropertySchema,
    Tools,
} from '../../../types';
import { cs } from '../../../core/db';
import Fuse from 'fuse.js';
import { changeDeviceState, getDeviceCapabilities, getDeviceState } from '../../../devices';
import { normalizeAndSplit } from './../../../ai/nlu/utils';
import {
    applyDelta,
    isRelativeLevel,
    nuanceDelta,
    signedLevel,
} from './devices.logic';
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
        /** Degree of a move: `slightly` ("un peu") / `strongly` ("beaucoup"). */
        nuance?: string;
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

async function findDevices(req: DeviceRequest, verbIntent: VerbIntentType): Promise<Device[] | undefined | null> {
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

/**
 * Target level for a partial move: the device's current level shifted by `delta`.
 * `undefined` when the device cannot take a level (`capabilities.state` has no
 * `level` field) or when its current level is unknown — the caller then performs
 * the plain full move.
 */
async function partialLevel(
    deviceId: string,
    delta: number
): Promise<number | undefined> {
    const capabilities = await getDeviceCapabilities(deviceId);
    const hasLevel = capabilities?.state?.some(
        (field) => field.key === 'level'
    );
    if (!hasLevel) return undefined;

    const current = (await getDeviceState(deviceId))?.level;
    if (current == null) return undefined;

    return applyDelta(current, delta);
}

/**
 * State to send for one device.
 *
 * A plain full move (`{ power }`), optionally carrying a remembered absolute
 * level when powering on with an explicit number ("allume à 50"). A nuance
 * request ("un peu" / "beaucoup") instead moves by a SIGNED delta applied to the
 * device's current level, for ANY device that advertises a writable level: a
 * device without one (e.g. a toggle-only gate) keeps the plain full move.
 */
async function deviceMoveState(
    device: Device,
    power: PowerType,
    req: DeviceRequest,
    delta: number | undefined
): Promise<DeviceState> {
    if (delta !== undefined && device._id) {
        const level = await partialLevel(device._id, delta);
        if (level !== undefined) {
            log(
                'devices-actions',
                `partial move ${signedLevel(delta)} on ${device.name}: level ${level}`
            );
            return { power, level };
        }
    }

    const state: DeviceState = { power };
    const rawNumber = req.slots?.number;
    if (power === 'on' && rawNumber != null && !isRelativeLevel(rawNumber)) {
        const level = Number(rawNumber);
        if (!Number.isNaN(level)) state.level = clampToField(level);
    }
    return state;
}

async function changeDevice(
    req: DeviceRequest,
    power: PowerType,
    verbIntent: VerbIntentType
): Promise<boolean | string> {
    const devices = await findDevices(req, verbIntent);
    if (devices?.length) {
        const delta = nuanceDelta(power, req.slots?.nuance);
        let ok = true;
        for (const device of devices) {
            if (!device._id) continue;
            const state = await deviceMoveState(device, power, req, delta);
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

/**
 * First advertised field that is both numeric and writable: the control a "set
 * the number" request drives. A slider domain advertises `level`; a climate
 * device advertises its canonical setpoint (`temperature`) first. `undefined`
 * when the device exposes no numeric control (a sensor, or a custom device whose
 * schema is telemetry-only).
 */
function primaryControl(
    capabilities?: DeviceCapabilities
): StatePropertySchema | undefined {
    return capabilities?.state?.find(
        (field) =>
            field.readonly !== true &&
            (field.type === 'number' || field.type === 'range')
    );
}

/**
 * Clamp a control value to the range its schema advertises, rounded to its step.
 * Falls back to the 0..100 level scale when the device advertises no field.
 */
function clampToField(value: number, field?: StatePropertySchema): number {
    const min = field?.min ?? 0;
    const max = field?.max ?? 100;
    const clamped = Math.min(max, Math.max(min, value));
    const step = field?.step;
    return step ? Math.round(clamped / step) * step : Math.round(clamped);
}

/** Devices targeted by a numeric-control (brightness/volume/temperature) request. */
async function findControlTargets(
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

/**
 * Apply a numeric control to the devices matched by the request.
 *
 * The control is DISCOVERED from the device's capabilities — `level` for a
 * slider domain, the canonical setpoint (`temperature`) for a climate device —
 * never hardcoded, and the provider maps whichever key it is to a service. The
 * value is clamped to the advertised range. A device with no advertised numeric
 * control (a custom device whose schema is telemetry-only) keeps the `level`
 * convention.
 */
async function applyControl(
    req: DeviceRequest,
    defaultType: string,
    resolve: (current: number | undefined) => number | undefined
): Promise<boolean | string> {
    const targets = await findControlTargets(req, defaultType);
    if (typeof targets === 'string') {
        return targets;
    }

    for (const device of targets) {
        if (!device._id) continue;

        const capabilities = await getDeviceCapabilities(device._id);
        const field = primaryControl(capabilities);
        const key = field?.key ?? 'level';

        const state = await getDeviceState(device._id);
        const current =
            key === 'level' ? state?.level : Number(state?.properties?.[key]);
        const wanted = resolve(
            current != null && Number.isFinite(current) ? current : undefined
        );
        if (wanted === undefined) return false;

        const value = clampToField(wanted, field);
        const changed = await changeDeviceState(
            device._id,
            key === 'level'
                ? { level: value }
                : { properties: { [key]: value } }
        );
        if (!changed) {
            return `Impossible de modifier ${device.name}.`;
        }
    }

    memory.setActiveDevice(scopeOf(req), targets[0]._id, targets[0].name);
    return true;
}

/**
 * Unit of the number a state answer shows: read from the device's advertised
 * schema (the `level` field for a slider domain, else the primary control's
 * unit) instead of being guessed from the device type.
 */
async function levelUnit(device: Device): Promise<string | undefined> {
    if (!device._id) return undefined;
    const capabilities = await getDeviceCapabilities(device._id);
    return (
        capabilities?.state?.find((field) => field.key === 'level')?.unit ??
        primaryControl(capabilities)?.unit
    );
}

async function describeDeviceState(
    device: Device,
    state?: DeviceState
): Promise<string> {
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
        // `level` is the device's canonical numeric value (see the provider's
        // `LEVEL_SOURCES`); its unit comes from the advertised schema, so a
        // thermostat reports °C and a light a percentage with no per-type code.
        const unit = await levelUnit(device);
        description +=
            unit && unit !== '%'
                ? ` (${state.level} ${unit})`
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
                descriptions.push(await describeDeviceState(device, state));
            }
            return descriptions.join(' ');
        },
    },
    setBrightness: {
        exec: async (req: DeviceRequest) => {
            const value = Number(req.slots?.number);
            if (!req.slots?.number || Number.isNaN(value)) return false;
            return applyControl(req, DeviceTypes.light, () => value);
        },
    },
    brightnessUp: {
        exec: (req: DeviceRequest) =>
            applyControl(req, DeviceTypes.light, (current) => (current ?? 50) + 10),
    },
    brightnessDown: {
        exec: (req: DeviceRequest) =>
            applyControl(req, DeviceTypes.light, (current) => (current ?? 50) - 10),
    },
    setVolume: {
        exec: async (req: DeviceRequest) => {
            const value = Number(req.slots?.number);
            if (!req.slots?.number || Number.isNaN(value)) return false;
            return applyControl(req, DeviceTypes.tv, () => value);
        },
    },
    volumeUp: {
        exec: (req: DeviceRequest) =>
            applyControl(req, DeviceTypes.tv, (current) => (current ?? 50) + 10),
    },
    volumeDown: {
        exec: (req: DeviceRequest) =>
            applyControl(req, DeviceTypes.tv, (current) => (current ?? 50) - 10),
    },
    setTemperature: {
        exec: async (req: DeviceRequest) => {
            const value = Number(req.slots?.number);
            if (!req.slots?.number || Number.isNaN(value)) return false;
            return applyControl(req, DeviceTypes.thermostat, () => value);
        },
    },
    temperatureUp: {
        exec: (req: DeviceRequest) =>
            applyControl(
                req,
                DeviceTypes.thermostat,
                (current) => (current ?? 20) + 1
            ),
    },
    temperatureDown: {
        exec: (req: DeviceRequest) =>
            applyControl(
                req,
                DeviceTypes.thermostat,
                (current) => (current ?? 20) - 1
            ),
    },
};

export default tools;
