import { DeviceCapabilities, ProvidersApis } from '../../types';

interface LoginInfo {
    user: string;
    password: string;
}

// MelCloud OperationMode values
const OPERATION_MODES = {
    heat: 1,
    dry: 2,
    cool: 3,
    fan: 7,
    auto: 8,
} as const;

type OperationModeKey = keyof typeof OPERATION_MODES;

// MelCloud FanSpeed values (1-5, 6 = auto)
const FAN_SPEEDS = {
    auto: 6,
    low: 1,
    medium: 2,
    high: 3,
    veryHigh: 4,
    max: 5,
} as const;

type FanSpeedKey = keyof typeof FAN_SPEEDS;

// EffectiveFlags bitmask: 1=Power, 2=OperationMode, 4=SetTemperature, 8=FanSpeed
const FLAG_POWER = 1;
const FLAG_OPERATION_MODE = 2;
const FLAG_SET_TEMPERATURE = 4;
const FLAG_FAN_SPEED = 8;

async function login({ user, password }: LoginInfo) {
    const res = await fetch(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Email: user,
                Password: password,
                Language: 0,
                AppVersion: '1.37.2.0',
                Persist: false,
            }),
        }
    );

    const data = await res.json();
    return data?.LoginData?.ContextKey;
}

async function getDevices({ user, password }: LoginInfo) {
    if (!user || !password) return [];

    const contextKey = await login({ user, password });
    const res = await fetch(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices',
        {
            headers: { 'X-MitsContextKey': contextKey },
        }
    );

    const json = await res.json();
    return json?.[0]?.Structure?.Floors?.flatMap((f) =>
        f.Areas?.flatMap((a) =>
            a?.Devices.map(({ Device: { Units, ...r } }) => ({
                MinTempCoolDry: r.MinTempCoolDry,
                MaxTempCoolDry: r.MaxTempCoolDry,
                MinTempHeat: r.MinTempHeat,
                MaxTempHeat: r.MaxTempHeat,
                MinTempAutomatic: r.MinTempAutomatic,
                MaxTempAutomatic: r.MaxTempAutomatic,
                UnitSupportsStandbyMode: r.UnitSupportsStandbyMode,
                Power: r.Power,
                RoomTemperature: r.RoomTemperature,
                OutdoorTemperature: r.OutdoorTemperature,
                SetTemperature: r.SetTemperature,
                ActualFanSpeed: r.ActualFanSpeed,
                FanSpeed: r.FanSpeed,
                OperationMode: r.OperationMode,
                DemandPercentage: r.DemandPercentage,
                DefaultCoolingSetTemperature: r.DefaultCoolingSetTemperature,
                DefaultHeatingSetTemperature: r.DefaultHeatingSetTemperature,
                RoomTemperatureLabel: r.RoomTemperatureLabel,
                HeatingEnergyConsumedRate1: r.HeatingEnergyConsumedRate1,
                HeatingEnergyConsumedRate2: r.HeatingEnergyConsumedRate2,
                CoolingEnergyConsumedRate1: r.CoolingEnergyConsumedRate1,
                CoolingEnergyConsumedRate2: r.CoolingEnergyConsumedRate2,
                AutoEnergyConsumedRate1: r.AutoEnergyConsumedRate1,
                AutoEnergyConsumedRate2: r.AutoEnergyConsumedRate2,
                DryEnergyConsumedRate1: r.DryEnergyConsumedRate1,
                DryEnergyConsumedRate2: r.DryEnergyConsumedRate2,
                FanEnergyConsumedRate1: r.FanEnergyConsumedRate1,
                FanEnergyConsumedRate2: r.FanEnergyConsumedRate2,
                OtherEnergyConsumedRate1: r.OtherEnergyConsumedRate1,
                OtherEnergyConsumedRate2: r.OtherEnergyConsumedRate2,
                CurrentEnergyConsumed: r.CurrentEnergyConsumed,
                CurrentEnergyMode: r.CurrentEnergyMode,
                CoolingDisabled: r.CoolingDisabled,
                DeviceID: r.DeviceID,
                MacAddress: r.MacAddress,
                SerialNumber: r.SerialNumber,
                LinkedDevice: r.LinkedDevice,
                WifiSignalStrength: r.WifiSignalStrength,
                WifiAdapterStatus: r.WifiAdapterStatus,
                LastTimeStamp: r.LastTimeStamp,
                Offline: r.Offline,
            }))
        )
    );
}

async function setDeviceState({
    deviceId,
    power,
    operationMode,
    temperature,
    fanSpeed,
    user,
    password,
}: {
    deviceId: string;
    power?: boolean;
    operationMode?: OperationModeKey;
    temperature?: number;
    fanSpeed?: FanSpeedKey;
    user: string;
    password: string;
}) {
    const contextKey = await login({ user, password });

    // Preserve any control field we are not explicitly changing. MELCloud
    // otherwise resets the *omitted* fields to factory defaults (e.g. a bare
    // power-on wipes OperationMode / SetTemperature / FanSpeed to auto / 0°C).
    if (
        operationMode === undefined ||
        temperature === undefined ||
        fanSpeed === undefined
    ) {
        try {
            const current = (await getDevices({ user, password })).find(
                (d) => d.DeviceID === deviceId
            );
            if (current) {
                if (
                    operationMode === undefined &&
                    current.OperationMode !== undefined
                )
                    operationMode = operationModeKey(current.OperationMode);
                if (
                    temperature === undefined &&
                    current.SetTemperature !== undefined
                )
                    temperature = current.SetTemperature;
                if (fanSpeed === undefined && current.FanSpeed !== undefined)
                    fanSpeed = fanSpeedKey(current.FanSpeed);
            }
        } catch {
            // Best-effort: fall back to sending only the explicit fields.
        }
    }

    const payload: any = {
        DeviceID: deviceId,
        EffectiveFlags: 0,
    };

    if (power !== undefined) {
        payload.Power = power ? 1 : 0;
        payload.EffectiveFlags |= FLAG_POWER;
    }
    if (operationMode) {
        payload.OperationMode = OPERATION_MODES[operationMode];
        payload.EffectiveFlags |= FLAG_OPERATION_MODE;
    }
    if (temperature !== undefined) {
        payload.SetTemperature = temperature;
        payload.EffectiveFlags |= FLAG_SET_TEMPERATURE;
    }
    if (fanSpeed) {
        payload.FanSpeed = FAN_SPEEDS[fanSpeed];
        payload.EffectiveFlags |= FLAG_FAN_SPEED;
    }

    const res = await fetch(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-MitsContextKey': contextKey,
            },
            body: JSON.stringify(payload),
        }
    );

    return true;
}

function operationModeKey(value: number): OperationModeKey {
    return (
        (Object.keys(OPERATION_MODES).find(
            (k) => OPERATION_MODES[k as OperationModeKey] === value
        ) as OperationModeKey) ?? 'auto'
    );
}

function fanSpeedKey(value: number): FanSpeedKey {
    return (
        (Object.keys(FAN_SPEEDS).find(
            (k) => FAN_SPEEDS[k as FanSpeedKey] === value
        ) as FanSpeedKey) ?? 'auto'
    );
}

const stateSchema: StatePropertySchema[] = [
    {
        key: 'targetTemperature',
        label: 'Température cible',
        type: 'range',
        unit: '°C',
        min: 16,
        max: 30,
        step: 0.5,
    },
    {
        key: 'operationMode',
        label: 'Mode',
        type: 'enum',
        options: [
            { value: 'heat', label: 'Chaud' },
            { value: 'cool', label: 'Froid' },
            { value: 'dry', label: 'Déshumidification' },
            { value: 'fan', label: 'Ventilateur' },
            { value: 'auto', label: 'Auto' },
        ],
    },
    {
        key: 'fanSpeed',
        label: 'Vitesse ventilation',
        type: 'enum',
        options: [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Faible' },
            { value: 'medium', label: 'Moyenne' },
            { value: 'high', label: 'Élevée' },
            { value: 'veryHigh', label: 'Très élevée' },
            { value: 'max', label: 'Max' },
        ],
    },
    {
        key: 'roomTemperature',
        label: 'Température ambiante',
        type: 'number',
        unit: '°C',
        readonly: true,
    },
    {
        key: 'outdoorTemperature',
        label: 'Température extérieure',
        type: 'number',
        unit: '°C',
        readonly: true,
    },
    {
        key: 'currentEnergyConsumed',
        label: 'Consommation actuelle',
        type: 'number',
        unit: 'kWh',
        readonly: true,
    },
    {
        key: 'wifiSignalStrength',
        label: 'Signal WiFi',
        type: 'number',
        unit: '%',
        readonly: true,
    },
];

const capabilities: DeviceCapabilities = {
    state: stateSchema,
    functions: [
        {
            name: 'setOperationMode',
            description:
                'Change the AC operation mode (heat/cool/dry/fan/auto)',
            inputSchema: [
                {
                    key: 'mode',
                    label: 'Mode',
                    type: 'enum',
                    options: stateSchema[1].options,
                },
            ],
        },
        {
            name: 'setFanSpeed',
            description: 'Change the AC fan speed',
            inputSchema: [
                {
                    key: 'speed',
                    label: 'Vitesse ventilation',
                    type: 'enum',
                    options: stateSchema[2].options,
                },
            ],
        },
        {
            name: 'setTemperature',
            description: 'Set the AC target temperature',
            inputSchema: [
                {
                    key: 'temperature',
                    label: 'Température cible',
                    type: 'range',
                    unit: '°C',
                    min: 16,
                    max: 30,
                    step: 0.5,
                },
            ],
        },
    ],
};

const apis: ProvidersApis = {
    api: {
        discover: async ({ user, password }) => getDevices({ user, password }),
        //getCapabilities: async () => capabilities,
        changeDeviceState: async (
            { provider: { user, password }, device: { externalId } },
            { power, level, properties }
        ) => {
            const operationMode = properties?.operationMode as
                | OperationModeKey
                | undefined;
            const fanSpeed = properties?.fanSpeed as FanSpeedKey | undefined;
            const temperature =
                (properties?.targetTemperature as number | undefined) ??
                (level as number | undefined);

            return setDeviceState({
                deviceId: externalId,
                power: power === 'on',
                operationMode,
                temperature,
                fanSpeed,
                user,
                password,
            });
        },
        getDeviceState: async ({
            provider: { user, password },
            device: { externalId },
        }) => {
            const device = (await getDevices({ user, password })).find(
                (d) => d.DeviceID === externalId
            );
            if (!device) return { power: 'off' };

            return {
                power: !!device.Power ? 'on' : 'off',
                level: device.SetTemperature,
                properties: {
                    targetTemperature: device.SetTemperature,
                    operationMode: operationModeKey(device.OperationMode),
                    fanSpeed: fanSpeedKey(device.FanSpeed),
                    roomTemperature: device.RoomTemperature,
                    outdoorTemperature: device.OutdoorTemperature,
                    currentEnergyConsumed: device.CurrentEnergyConsumed,
                    wifiSignalStrength: device.WifiSignalStrength,
                },
            };
        },
        callFunction: async (
            { provider: { user, password }, device: { externalId } },
            { name, params }
        ) => {
            const p = (params ?? {}) as Record<string, any>;
            switch (name) {
                case 'setOperationMode':
                    return setDeviceState({
                        deviceId: externalId,
                        operationMode: p.mode as OperationModeKey,
                        user,
                        password,
                    });
                case 'setFanSpeed':
                    return setDeviceState({
                        deviceId: externalId,
                        fanSpeed: p.speed as FanSpeedKey,
                        user,
                        password,
                    });
                case 'setTemperature':
                    return setDeviceState({
                        deviceId: externalId,
                        temperature: p.temperature as number,
                        user,
                        password,
                    });
                default:
                    return false;
            }
        },
    },
};

export default apis;
