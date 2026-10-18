import { JSONSchema7 } from 'json-schema';

const schema: JSONSchema7 = {
    title: 'Feature Settings',
    type: 'object',
    properties: {
        'flow.agentic.enabled': {
            type: 'boolean',
            title: 'Enable agentic fallback flow',
            tags: ['Flow', 'AI'],
        },
        'routines.enabled': {
            type: 'boolean',
            title: 'Enable Routines',
            tags: ['Routines', 'restart'],
        },
        'echos.menu.enabled': {
            type: 'boolean',
            title: 'Enable menu',
            tags: ['Echo'],
        },
        'echos.listen': {
            type: 'boolean',
            title: 'Turn on server to listen for echo device',
            tags: ['Echo', 'restart'],
        },
        'mqtt.enabled': {
            type: 'boolean',
            title: 'Turn on mqtt server',
            tags: ['mqtt', 'restart'],
        },
        'devices.providers.rotateIp.enabled': {
            type: 'boolean',
            title: 'Enable devices provider ip rotation',
            tags: ['Devices', 'restart'],
        },
        'experimental.devices.add.enabled': {
            type: 'boolean',
            title: 'Enable add devices',
            tags: ['Devices', 'Experimental'],
        },
        'experimental.devices.discovery.enabled': {
            type: 'boolean',
            title: 'Enable discovery of devices',
            tags: ['Devices', 'Experimental'],
        },
        'devices.providers.homeassistant.enabled': {
            type: 'boolean',
            title: 'Enable Home Assistant provider (background device layer)',
            tags: ['Devices', 'restart'],
        },
        'devices.providers.homeassistant.history': {
            type: 'boolean',
            title: 'Log Home Assistant device state history',
            tags: ['Devices'],
        },
        'devices.providers.homeassistant.community.enabled': {
            type: 'boolean',
            title: 'Enable Home Assistant community integrations (HACS-compatible)',
            tags: ['Devices', 'Experimental'],
        },
        'devices.providers.homeassistant.community.githubToken': {
            type: 'string',
            title: 'GitHub token used to browse community integrations (optional)',
            tags: ['Devices', 'Experimental'],
        },
        'musics.show': {
            type: 'boolean',
            title: 'Enable music assistant iframe',
            tags: ['Music'],
        },
        'music.assistant.url': {
            type: 'string',
            title: 'URL music assistant',
            tags: ['Music'],
        },
        'music.assistant.apikey': {
            type: 'string',
            title: 'Music assistant api key',
            tags: ['Music'],
        },
        'music.assitant.playername': {
            type: 'string',
            title: 'Music assistant default playername',
            tags: ['Music'],
        },
        'music.sendspin.url': {
            type: 'string',
            title: 'Sendspin agent url',
            tags: ['Music'],
        },
        'experimental.ai.ask.show': {
            type: 'boolean',
            title: 'Enable AI chat',
            tags: ['AI', 'Experimental'],
        },
        'weather.latitude': {
            type: 'number',
            title: 'Home latitude used for weather questions',
            tags: ['Weather'],
        },
        'weather.longitude': {
            type: 'number',
            title: 'Home longitude used for weather questions',
            tags: ['Weather'],
        },
        'memory.maxFacts': {
            type: 'number',
            title: 'Maximum number of facts kept per user',
            tags: ['AI', 'Memory'],
        },
        'memory.maxTopics': {
            type: 'number',
            title: 'Maximum number of topics kept per user',
            tags: ['AI', 'Memory'],
        },
        'memory.promptMaxChars': {
            type: 'number',
            title: 'Maximum characters of memory injected in the LLM prompt',
            tags: ['AI', 'Memory'],
        },
        'memory.contextTtlMs': {
            type: 'number',
            title: 'Conversation context time-to-live (ms)',
            tags: ['AI', 'Memory'],
        },
    },
};

export default schema;
