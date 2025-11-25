import { ProvidersApis } from '../../types';

interface LoginInfo {
    user: string;
    password: string;
}

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
    return (await res.json())?.[0]?.Structure?.Floors?.flatMap((f) =>
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

async function setDevicePower({
    deviceId,
    powerOn,
    temperature,
    user,
    password,
}: {
    deviceId: string;
    powerOn: boolean;
    temperature?: number;
    user: string;
    password: string;
}) {
    const contextKey = await login({ user, password });

    const payload: any = {
        DeviceID: deviceId,
        Power: powerOn ? 1 : 0,
        OperationMode: 1, // 1 = Heat, 3 = Cool, 8 = Auto
    };

    if (temperature) {
        payload.SetTemperature = temperature;
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

    const result = await res.json();
    console.log(
        `Device ${deviceId} power set to ${powerOn ? 'On' : 'Off'}`,
        result
    );

    return true;
}

const apis: ProvidersApis = {
    api: {
        discover: async ({ user, password }) => getDevices({ user, password }),
        changeDeviceState: async (
            { provider: { user, password }, device: { externalId } },
            { power }
        ) =>
            setDevicePower({
                deviceId: externalId,
                powerOn: power === 'on',
                user,
                password,
            }),
        getDeviceState: async ({
            provider: { user, password },
            device: { externalId },
        }) => {
            const device = (await getDevices({ user, password })).find(
                (d) => d.DeviceID === externalId
            );
            return {
                power: !!device.Power ? 'on' : 'off',
                level: device.RoomTemperature,
                additional: device,
            };
        },
    },
};

export default apis;
