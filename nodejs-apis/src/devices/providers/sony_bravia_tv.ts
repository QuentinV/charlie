import Bravia from 'bravia';
import {
    DeviceCapabilities,
    ProviderFunctionDef,
    ProvidersApis,
    DiscoveryResult,
} from '../../types';
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
        inputSchema: [
            { key: 'uri', label: 'URI', type: 'string' },
            { key: 'data', label: 'Data', type: 'string' },
        ],
        description: 'always use getApplicationStatusList to get uri',
        domain: 'appControl',
        version: '1.0',
    },
    { name: 'terminateApps', domain: 'appControl', version: '1.0' },
    {
        name: 'getPlayingContentInfo',
        returns: [{ title: 'string', uri: 'string', programTitle: 'string' }],
        description: 'Current playing content (app / channel) title',
        domain: 'avContent',
        version: '1.0',
    },
    {
        name: 'getSourceList',
        returns: [
            {
                title: 'string',
                uri: 'string',
                connection: 'string',
                status: 'string',
            },
        ],
        description: 'List available inputs (AV sources)',
        domain: 'avContent',
        version: '1.0',
    },
    {
        name: 'setPlayContent',
        inputSchema: [
            { key: 'uri', label: 'URI', type: 'string' },
            { key: 'title', label: 'Titre', type: 'string' },
        ],
        description: 'Switch the active input to the given source URI',
        domain: 'avContent',
        version: '1.0',
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
        name: 'getTextForm',
        inputSchema: [{ key: 'encKey', label: 'EncKey', type: 'string' }],
        returns: [{ text: 'string' }],
        version: '1.1',
        domain: 'appControl',
    },
    {
        name: 'setTextForm',
        inputSchema: [
            { key: 'encKey', label: 'EncKey', type: 'string' },
            { key: 'text', label: 'Texte', type: 'string' },
        ],
        version: '1.1',
        domain: 'appControl',
    },
    {
        name: 'setAudioMute',
        inputSchema: [{ key: 'status', label: 'Muet', type: 'boolean' }],
        returns: ['int'],
        domain: 'audio',
        version: '1.0',
    },
    {
        name: 'setAudioVolume',
        inputSchema: [
            { key: 'target', label: 'Cible', type: 'string' },
            { key: 'volume', label: 'Volume', type: 'string' },
        ],
        returns: ['int'],
        domain: 'audio',
        version: '1.0',
    },
    {
        name: 'pressKey',
        inputSchema: [{ key: 'key', label: 'Touche', type: 'string' }],
        returns: ['string'],
        description: 'Envoyer une touche de télécommande (IRCC)',
        domain: 'system',
        version: '1.0',
    },
];

const capabilities: DeviceCapabilities = {
    state: [
        {
            key: 'volume',
            label: 'Volume',
            type: 'range',
            min: 0,
            max: 100,
            step: 1,
            readonly: true,
        },
        {
            key: 'mute',
            label: 'Muet',
            type: 'boolean',
            readonly: true,
        },
    ],
    functions,
};

function getClient({ host, password }: { host?: string; password?: string }) {
    return new Bravia(host, '80', password);
}

const apis: ProvidersApis = {
    api: {
        publicDiscover: async (): Promise<DiscoveryResult> => {
            const result = await Bravia.discover(5000);
            return {
                devices: ((result as any[]) ?? []).map((tv) => ({
                    name: tv.friendlyName ?? tv.id,
                    type: 'tv',
                    host: tv.host,
                    mac: tv.mac,
                })),
            };
        },
        changeDeviceState: async ({ provider }, { power }) => {
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
            let volume;
            let mute;
            try {
                const vol = await getClient(provider).audio.invoke(
                    'getVolumeInformation',
                    '1.0'
                );
                const first =
                    Array.isArray(vol) ? vol[0] : vol?.result?.[0] ?? vol;
                volume = first?.volume;
                mute = first?.mute === true;
            } catch (e) {
                console.log(e);
            }
            return {
                power: res?.status === 'active' ? 'on' : 'off',
                properties:
                    volume === undefined && mute === undefined
                        ? undefined
                        : { ...(volume !== undefined && { volume }), ...(mute !== undefined && { mute }) },
            };
        },
        getCapabilities: async () => capabilities,
        callFunction: async ({ provider }, { name, params }) => {
            const f = functions.find((ff) => ff.name === name);
            if (!f) throw new NotFoundError();
            try {
                // IRCC remote keys are sent through the SOAP IRCC helper rather
                // than a REST method.
                if (f.name === 'pressKey') {
                    await getClient(provider).send([(params as any)?.key]);
                    return true;
                }
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