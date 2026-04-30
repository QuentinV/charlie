import { JSONSchema7 } from 'json-schema';

const schema: JSONSchema7 = {
    title: 'Feature Settings',
    type: 'object',
    properties: {
        'routines.add.enabled': { type: 'boolean', title: 'Enable Routines' },
        'echos.menu.enabled': { type: 'boolean', title: 'Enable echos menu' },
        'experimental.devices.add.enabled': {
            type: 'boolean',
            title: '(Experimental) Enable add devices',
        },
        'experimental.devices.discovery.enabled': {
            type: 'boolean',
            title: '(Experimental) Enable discovery of devices',
        },
        'experimental.music.player.show': {
            type: 'boolean',
            title: '(Experimental) Enable musics player',
        },
        'experimental.ai.ask.show': {
            type: 'boolean',
            title: '(Experimental) Enable AI chat',
        },
    },
};

export default schema;
