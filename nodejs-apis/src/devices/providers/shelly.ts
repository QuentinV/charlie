import { ProvidersApis } from '../../types';

async function getDeviceState({ host }: { host: string }) {
    const res = await fetch(`http://${host}/rpc/Switch.GetStatus?id=0`);
    return res.json();
}

async function setDeviceState({
    host,
    state,
}: {
    host: string;
    state: boolean;
}) {
    await fetch(`http://${host}/rpc/Switch.Set`, {
        method: 'POST',
        body: JSON.stringify({
            id: 0,
            on: state,
        }),
        headers: {
            'Content-Type': 'application/json',
        },
    });
    return true;
}

const apis: ProvidersApis = {
    api: {
        changeDeviceState: async ({ provider: { host } }, { power }) =>
            setDeviceState({ host, state: power === 'on' }),
        getDeviceState: async ({ device, provider: { host } }) => {
            const state = await getDeviceState({ host });
            return {
                power: state?.output ? 'on' : 'off',
                additional: state,
            };
        },
    },
};

export default apis;
