import { z } from 'zod';
import { executeCommand, searchLibrary } from '../../../musics/service';
import { Tools } from '../../../types';

export const tools: Tools = {
    'control-music': {
        description:
            'Play/Stop/Pause/Resume/Skip musics. Song id is required only for play command.',
        inputSchema: {
            command: z.enum([
                'play',
                'stop',
                'resume',
                'pause',
                'increaseVolume',
                'decreaseVolume',
                'skip',
            ]),
            songId: z.optional(z.string()),
        },
        exec: async ({ command, songId }: any) => {
            try {
                await executeCommand({ command, songId });
                return 'Done';
            } catch (e) {
                if ((e as any)?.message.indexOf('server error') !== -1) {
                    console.log('Server error', e);
                    return 'API error. Do not retry.';
                }
                return 'Unkown error. Do not retry.';
            }
        },
    },
    'search-music': {
        description: 'Search music by term and return id.',
        inputSchema: { term: z.string() },
        exec: async ({ term }) => {
            const songs = await searchLibrary({ q: term });
            const filteredSongs = songs
                .slice(0, 3)
                .map((it: any) => `- ${it.item_id}: ${it.name}`);
            return filteredSongs.length === 0
                ? 'Found no sounds'
                : (filteredSongs.length > 1
                      ? `Assistant should pick the most interesting song: `
                      : '') + filteredSongs.join('\n');
        },
    },
};

export default tools;
