import { ProvidersApis } from '../../types';

async function getDevices({ host }: { host: string }) {
    const res = await fetch(`http://${host}/devices/states`);
    return res.json();
}

async function setDeviceState({
    host,
    device,
    state,
}: {
    host: string;
    device: string;
    state: boolean;
}) {
    await fetch(`http://${host}/devices/states`, {
        method: 'POST',
        body: JSON.stringify({
            state,
            device,
        }),
        headers: {
            'Content-Type': 'application/json',
        },
    });
    return true;
}

const apis: ProvidersApis = {
    api: {
        discover: async ({ host }) => getDevices({ host }),
        changeDeviceState: async (
            { device: { externalId }, provider: { host } },
            { power }
        ) =>
            setDeviceState({ host, device: externalId, state: power === 'on' }),
        getDeviceState: async ({
            device: { externalId },
            provider: { host },
        }) => {
            const devices = await getDevices({ host });
            return {
                power: devices[externalId]?.state ? 'on' : 'off',
            };
        },
    },
};

export default apis;
