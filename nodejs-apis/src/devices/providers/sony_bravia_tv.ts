import Bravia from 'bravia';
import { ProviderFunctionDef, ProvidersApis } from '../../types';
import { NotFoundError } from '../../errors';

interface ExtendedProviderFunctionDef extends ProviderFunctionDef {
    domain: string;
    version: string;
    description?: string;
}

const functions: ExtendedProviderFunctionDef[] = [
    {
        name: 'getPowerStatus',
        returns: { status: 'string' },
        domain: 'system',
        version: '1.0',
    },
    { name: 'requestReboot', domain: 'system', version: '1.0' },
    {
        name: 'getApplicationList',
        returns: [
            { title: 'string', uri: 'string', icon: 'string', data: 'string' },
        ],
        description: 'to be used to retrieve uri to set active app',
        domain: 'appControl',
        version: '1.0',
    },
    {
        name: 'getApplicationStatusList',
        returns: [{ name: 'string', status: 'string' }],
        domain: 'appControl',
        version: '1.0',
    },
    {
        name: 'setActiveApp',
        params: [{ uri: 'string', data: 'string' }],
        description: 'always use getApplicationStatusList to get uri',
        domain: 'appControl',
        version: '1.0',
    },
    { name: 'terminateApps', domain: 'appControl', version: '1.0' },
    {
        name: 'getTextForm',
        params: [{ encKey: 'string' }],
        returns: [{ text: 'string' }],
        version: '1.1',
        domain: 'appControl',
    },
    {
        name: 'setTextForm',
        params: [{ encKey: 'string', text: 'string' }],
        version: '1.1',
        domain: 'appControl',
    },
    {
        name: 'getVolumeInformation',
        returns: [
            {
                target: 'string',
                volume: 'int',
                mute: 'bool',
                maxVolume: 'int',
                minVolume: 'int',
            },
        ],
        domain: 'audio',
        version: '1.0',
    },
    {
        name: 'setAudioMute',
        params: [{ status: 'bool' }],
        returns: ['int'],
        domain: 'audio',
        version: '1.0',
    },
    {
        name: 'setAudioVolume',
        params: [{ target: 'string', volume: 'string' }],
        returns: ['int'],
        domain: 'audio',
        version: '1.0',
    },
];

function getClient({ host, password }: { host?: string; password?: string }) {
    return new Bravia(host, '80', password);
}

const apis: ProvidersApis = {
    api: {
        discover: async () => Bravia.discover(5000),
        changeDeviceState: async ({ provider }, { power }) => {
            console.log('tv change device state', power);
            try {
                await getClient(provider).system.invoke(
                    'setPowerStatus',
                    '1.0',
                    {
                        status: power === 'on',
                    }
                );
                return true;
            } catch (e) {
                console.log(e);
                return false;
            }
        },
        getDeviceState: async ({ provider }) => {
            const res = await getClient(provider).system.invoke(
                'getPowerStatus',
                '1.0'
            );
            return {
                power: res?.status === 'active' ? 'on' : 'off',
            };
        },
        getFunctions: async () => functions,
        callFunction: async ({ provider }, { name, params }) => {
            const f = functions.find((f) => f.name === name);
            if (!f) throw new NotFoundError();
            try {
                const res = await getClient(provider)[f.domain].invoke(
                    f.name,
                    f.version,
                    params
                );
                return res;
            } catch (e) {
                console.log(e);
            }
        },
    },
};

export default apis;
