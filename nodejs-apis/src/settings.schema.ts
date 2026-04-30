import { JSONSchema7 } from 'json-schema';

const schema: JSONSchema7 = {
    title: 'Feature Settings',
    type: 'object',
    properties: {
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
        'experimental.music.player.show': {
            type: 'boolean',
            title: 'Enable musics player',
            tags: ['Music', 'Experimental'],
        },
        'experimental.ai.ask.show': {
            type: 'boolean',
            title: 'Enable AI chat',
            tags: ['AI', 'Experimental'],
        },
    },
};

export default schema;
